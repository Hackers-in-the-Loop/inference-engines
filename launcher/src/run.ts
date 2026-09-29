// up / down / status: prepare nodes, run steps, supervise serve, record the run.
import { execFileSync, type ChildProcess } from 'node:child_process';
import { closeSync, createWriteStream, existsSync, openSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { activeComponents, REPO_ROOT, resolveParams, STEP_ORDER, type LoadedRecipe, type Scalar, type StepName } from './manifest.ts';
import { loadInventory, resolvePlacement, type Placement } from './inventory.ts';
import { checkoutScript, git, shellQuote, sourceSpec, verifyLock, type SourceSpec } from './source.ts';
import { ensureDir, holdLock, isLocal, nodeAddr, nodeDirs, releaseLock, runOn, slug, spawnOn, stepEnv } from './nodes.ts';
import { confirmPlan, DEFAULT_UP_STEPS, renderPlan, stateRoot } from './disclosure.ts';
import { startCollector, stopCollector } from './telemetry.ts';

export interface RunOptions {
  profile?: string; params: Record<string, string>; port?: number; inventory?: string; on?: string[];
  variant?: string; source?: string; commit?: string; yes: boolean; accept: string[];
  detach: boolean; only?: StepName[]; timeoutS: number; otel: boolean; interactive: boolean; quiet?: boolean;
}

export interface Prepared {
  loaded: LoadedRecipe; placements: Placement[]; params: Record<string, Scalar>;
  source: SourceSpec; httpPort: number; steps: StepName[]; plan: string;
  components: ReturnType<typeof activeComponents>;
}

export function prepare(loaded: LoadedRecipe, o: RunOptions): Prepared {
  const r = loaded.recipe;
  if (r.attribution.source.relationship === 'reference') throw new Error(`${r.id} is listed for reference only; the launcher does not run it`);
  const inv = loadInventory(o.inventory);
  const variant = o.variant ?? (o.profile && r.hardware.topology.variants?.[o.profile] ? o.profile : undefined);
  const placements = resolvePlacement(r, inv, { variant, prefer: o.on });
  const params = resolveParams(r, o.profile, o.params);
  const source = sourceSpec(r.attribution.source, { source: o.source, commit: o.commit });
  const httpPort = o.port ?? r.endpoint.port ?? 8000;
  const steps = (o.only ?? DEFAULT_UP_STEPS).filter((s) => r.steps[s]);
  const components = activeComponents(r, o.profile);
  const plan = renderPlan({ recipe: r, placements, params, profile: o.profile, components, httpPort, source, steps });
  return { loaded, placements, params, source, httpPort, steps, plan, components };
}

const roleSteps = (p: Prepared, pl: Placement): StepName[] => {
  const listed = p.loaded.recipe.roles?.[pl.role];
  return listed ?? [...STEP_ORDER];
};

// --- run state ------------------------------------------------------------

export interface ServeProc { rank: number; host: string; address: string; pidFile: string; pid?: number }
export interface RunState {
  id: string; runDir: string; startedAt: string; httpPort: number; url: string;
  serve: ServeProc[]; lockHolders: number[]; collector?: { pid?: number; container?: string };
}
const stateFile = (id: string) => join(stateRoot(), 'active', `${slug(id)}.json`);
export function readState(id: string): RunState | undefined {
  return existsSync(stateFile(id)) ? (JSON.parse(readFileSync(stateFile(id), 'utf8')) as RunState) : undefined;
}
export function activeStates(): RunState[] {
  const dir = join(stateRoot(), 'active');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as RunState);
}

function repoRevision(): { commit: string; dirty: boolean } {
  try {
    return { commit: git(REPO_ROOT, 'rev-parse', 'HEAD'), dirty: git(REPO_ROOT, 'status', '--porcelain', '--untracked-files=no').length > 0 };
  } catch {
    return { commit: 'unknown', dirty: true };
  }
}

// --- up -----------------------------------------------------------------

export async function up(loaded: LoadedRecipe, o: RunOptions): Promise<RunState | undefined> {
  const r = loaded.recipe;
  if (readState(r.id)) throw new Error(`${r.id} is already running; \`down ${r.id}\` first`);
  const p = prepare(loaded, o);
  const acks = await confirmPlan(p.plan, r, p.components, { yes: o.yes, accept: o.accept, interactive: o.interactive });

  const runDir = ensureDir(join(stateRoot(), 'runs', slug(r.id), new Date().toISOString().replace(/[:.]/g, '-')));
  const logs = ensureDir(join(runDir, 'logs'));
  const record: Record<string, unknown> = {
    recipe: r.id, status: r.status, catalog: repoRevision(), source: p.source, profile: o.profile ?? null,
    params: p.params, http_port: p.httpPort, plan: p.plan, acknowledgments: acks,
    placements: p.placements.map((x) => ({ rank: x.rank, role: x.role, host: x.host.name, devices: x.devices.map((d) => d.label ?? d.kind) })),
    started_at: new Date().toISOString(), steps: [] as unknown[],
  };
  const save = () => writeFileSync(join(runDir, 'run.json'), JSON.stringify(record, null, 2) + '\n');
  save();
  const log = (msg: string) => process.stderr.write(`[ie] ${msg}\n`);
  log(`run record: ${runDir}`);

  // Device locks are held for the whole run, shared with other tools using the same files.
  const holders: ChildProcess[] = [];
  const release = () => { for (const h of holders) releaseLock(h); };
  try {
    for (const pl of p.placements) for (const d of pl.devices) if (d.lock) holders.push(await holdLock(pl, d.lock, o.detach));
    if (holders.length) log(`holding ${holders.length} device lock(s)`);

    const envs = new Map(p.placements.map((pl) => [pl.rank, stepEnv({ recipe: r, recipeDir: loaded.dir, placements: p.placements, me: pl, params: p.params, httpPort: p.httpPort, otlp: process.env.OTEL_EXPORTER_OTLP_ENDPOINT })]));

    // Checkout the pinned source (and copy the adapter) on every node.
    await Promise.all(p.placements.map(async (pl) => {
      const dirs = nodeDirs(r, pl);
      const res = await runOn(pl, '/', checkoutScript(p.source, dirs.src), {}, join(logs, `${pl.rank}-checkout.log`), !o.quiet);
      if (res.code !== 0) throw new Error(`checkout failed on ${pl.host.name}; see ${join(logs, `${pl.rank}-checkout.log`)}`);
      (record.steps as unknown[]).push({ rank: pl.rank, step: 'checkout', code: 0, ms: res.ms, head: res.stdout.trim().split('\n').pop() });
      if (dirs.adapter) await installAdapter(loaded.dir, pl, dirs.adapter, dirs.src, logs);
    }));
    save();

    for (const step of p.steps.filter((s) => s !== 'serve' && s !== 'health')) {
      await Promise.all(p.placements.filter((pl) => roleSteps(p, pl).includes(step)).map(async (pl) => {
        const logFile = join(logs, `${pl.rank}-${step}.log`);
        log(`${step} on ${pl.host.name} (rank ${pl.rank})`);
        const res = await runOn(pl, nodeDirs(r, pl).src, r.steps[step] as string, envs.get(pl.rank)!, logFile, !o.quiet);
        (record.steps as unknown[]).push({ rank: pl.rank, step, code: res.code, ms: res.ms });
        save();
        if (res.code !== 0) throw new Error(`${step} failed on ${pl.host.name} (exit ${res.code}); see ${logFile}`);
      }));
    }

    if (!p.steps.includes('serve')) {
      record.finished_at = new Date().toISOString();
      save();
      release();
      // Nothing is left running; the state only points at the run record.
      return { id: r.id, runDir, startedAt: record.started_at as string, httpPort: p.httpPort, url: '', serve: [], lockHolders: [] };
    }

    // Serve: workers first, then the head. Each runs in its own process group with a pid file.
    const serve: ServeProc[] = [];
    const children: ChildProcess[] = [];
    const ordered = [...p.placements].sort((a, b) => b.rank - a.rank);
    for (const pl of ordered) {
      if (!roleSteps(p, pl).includes('serve')) continue;
      const dirs = nodeDirs(r, pl);
      const pidFile = join(dirs.work, `serve.${pl.rank}.pid`);
      const wrapped = `mkdir -p ${shellQuote(dirs.work)}; echo $$ > ${shellQuote(pidFile)}; exec bash -c ${shellQuote(r.steps.serve as string)}`;
      const cmd = isLocal(pl) ? wrapped : `setsid bash -c ${shellQuote(wrapped)}`;
      const logPath = join(logs, `${pl.rank}-serve.log`);
      let child: ChildProcess;
      if (o.detach) {
        // Detached serves write straight to the log so they outlive the launcher.
        const fd = openSync(logPath, 'a');
        child = spawnOn(pl, dirs.src, cmd, envs.get(pl.rank)!, { stdio: ['ignore', fd, fd], detached: true });
        closeSync(fd);
      } else {
        const out = createWriteStream(logPath, { flags: 'a' });
        child = spawnOn(pl, dirs.src, cmd, envs.get(pl.rank)!, { stdio: ['ignore', 'pipe', 'pipe'], detached: true });
        for (const s of [child.stdout, child.stderr]) s?.on('data', (b: Buffer) => { out.write(b); if (!o.quiet) process.stderr.write(b); });
      }
      children.push(child);
      serve.push({ rank: pl.rank, host: pl.host.name, address: pl.host.address, pidFile, pid: isLocal(pl) ? child.pid : undefined });
      log(`serve started on ${pl.host.name} (rank ${pl.rank})`);
      if (pl.rank > 0) await sleep(5000);
    }

    const head = p.placements[0];
    const url = `http://${nodeAddr(head)}:${p.httpPort}`;
    const state: RunState = { id: r.id, runDir, startedAt: record.started_at as string, httpPort: p.httpPort, url, serve, lockHolders: holders.map((h) => h.pid as number) };
    writeFileSync(join(ensureDir(join(stateRoot(), 'active')), `${slug(r.id)}.json`), JSON.stringify(state, null, 2) + '\n');

    const headChild = children[children.length - 1];
    let exited: number | null | undefined;
    headChild.on('exit', (code) => { exited = code; });
    const ready = await waitHealthy(p, envs.get(0)!, url, o.timeoutS, () => exited !== undefined, join(logs, '0-health.log'));
    if (!ready) {
      await down(r.id, loaded, { quiet: true });
      throw new Error(exited !== undefined ? `serve exited (code ${exited}) before becoming healthy; see ${join(logs, '0-serve.log')}` : `not healthy within ${o.timeoutS}s; see ${logs}`);
    }
    record.ready_at = new Date().toISOString();
    save();
    if (o.otel) {
      state.collector = startCollector(r, url, runDir);
      writeFileSync(stateFile(r.id), JSON.stringify(state, null, 2) + '\n');
    }
    log(`ready: ${url}`);

    if (o.detach) {
      for (const c of [...children, ...holders]) { c.stdout?.destroy(); c.stderr?.destroy(); c.unref(); }
      return state;
    }
    await new Promise<void>((resolve) => {
      const stop = () => resolve();
      process.once('SIGINT', stop);
      process.once('SIGTERM', stop);
      headChild.once('exit', stop);
    });
    log('stopping');
    await down(r.id, loaded, { quiet: true });
    return undefined;
  } catch (err) {
    record.error = (err as Error).message;
    save();
    release();
    if (readState(r.id)) await down(r.id, loaded, { quiet: true }).catch(() => undefined);
    throw err;
  }
}

async function installAdapter(recipeDir: string, pl: Placement, adapterDir: string, srcDir: string, logs: string) {
  const from = join(recipeDir, 'adapter');
  if (!existsSync(join(from, 'upstream.lock'))) throw new Error('adapter recipes need adapter/upstream.lock');
  const copy = isLocal(pl)
    ? `rm -rf ${shellQuote(adapterDir)} && cp -r ${shellQuote(from)} ${shellQuote(adapterDir)}`
    : `tar -C ${shellQuote(recipeDir)} -cf - adapter | ssh -o BatchMode=yes ${shellQuote(pl.host.address)} ${shellQuote(`rm -rf ${adapterDir} && mkdir -p ${adapterDir} && tar -C ${adapterDir} --strip-components=1 -xf -`)}`;
  execFileSync('bash', ['-c', copy], { stdio: 'inherit' });
  // Refuse to run an adapter against files it was not written for.
  if (isLocal(pl)) {
    const bad = verifyLock(join(from, 'upstream.lock'), srcDir);
    if (bad.length) throw new Error(`upstream changed; adapter needs review:\n${bad.map((b) => `  ${b.path}: ${b.actual === 'missing' ? 'missing' : 'hash differs'}`).join('\n')}`);
  } else {
    const res = await runOn(pl, srcDir, `sha256sum --quiet -c ${shellQuote(join(adapterDir, 'upstream.lock'))}`, {}, join(logs, `${pl.rank}-lock.log`), false);
    if (res.code !== 0) throw new Error(`upstream changed on ${pl.host.name}; adapter needs review:\n${res.stdout}`);
  }
}

async function waitHealthy(p: Prepared, env: Record<string, string>, url: string, timeoutS: number, dead: () => boolean, logFile: string): Promise<boolean> {
  const r = p.loaded.recipe;
  const head = p.placements[0];
  const deadline = Date.now() + timeoutS * 1000;
  const path = r.endpoint.protocol === 'openai' ? '/v1/models' : '/health';
  while (Date.now() < deadline) {
    if (dead()) return false;
    if (r.steps.health) {
      const res = await runOn(head, nodeDirs(r, head).src, r.steps.health, env, logFile, false);
      if (res.code === 0) return true;
    } else {
      try {
        const res = await fetch(url + path, { signal: AbortSignal.timeout(3000) });
        if (res.ok) return true;
      } catch { /* not up yet */ }
    }
    await sleep(2000);
  }
  return false;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// --- down / status --------------------------------------------------------

export async function down(id: string, loaded?: LoadedRecipe, o: { quiet?: boolean } = {}): Promise<void> {
  const state = readState(id);
  if (!state) throw new Error(`${id} is not running (no state file)`);
  const r = loaded?.recipe;
  const log = (m: string) => { if (!o.quiet) process.stderr.write(`[ie] ${m}\n`); };
  if (state.collector) stopCollector(state.collector);
  // A recipe-defined stop step runs first (head, then workers); then process groups are signalled.
  if (r?.steps.stop && !r.steps.stop.startsWith('builtin:')) {
    const inv = loadInventory();
    for (const s of state.serve) {
      const host = inv.hosts.find((h) => h.name === s.host);
      if (!host) continue;
      const pl: Placement = { rank: s.rank, role: s.rank === 0 ? 'head' : 'worker', host, devices: [] };
      const dirs = nodeDirs(r, pl);
      await runOn(pl, dirs.src, r.steps.stop, { IE_WORK_DIR: dirs.work, IE_SRC_DIR: dirs.src, IE_HTTP_PORT: String(state.httpPort), ...(dirs.adapter ? { IE_ADAPTER_DIR: dirs.adapter } : {}) }, join(state.runDir, 'logs', `${s.rank}-stop.log`), !o.quiet);
    }
  }
  for (const s of state.serve) {
    const kill = (sig: string) => `if [ -f ${shellQuote(s.pidFile)} ]; then kill -${sig} -- -$(cat ${shellQuote(s.pidFile)}) 2>/dev/null; fi`;
    const sh = (cmd: string) => (s.address === 'local' ? execFileSync('bash', ['-c', cmd]) : execFileSync('ssh', ['-o', 'BatchMode=yes', s.address, cmd]));
    try { sh(kill('TERM')); } catch { /* already gone */ }
    for (let i = 0; i < 20; i++) {
      const alive = (() => { try { sh(`kill -0 -- -$(cat ${shellQuote(s.pidFile)}) 2>/dev/null`); return true; } catch { return false; } })();
      if (!alive) break;
      await sleep(500);
      if (i === 19) { try { sh(kill('KILL')); } catch { /* gone */ } }
    }
    try { sh(`rm -f ${shellQuote(s.pidFile)}`); } catch { /* ignore */ }
    log(`stopped serve on ${s.host}`);
  }
  for (const pid of state.lockHolders) releaseLock(pid);
  const runJson = join(state.runDir, 'run.json');
  if (existsSync(runJson)) {
    const rec = JSON.parse(readFileSync(runJson, 'utf8'));
    rec.stopped_at = new Date().toISOString();
    writeFileSync(runJson, JSON.stringify(rec, null, 2) + '\n');
  }
  rmSync(stateFile(id));
}

export async function status(): Promise<string> {
  const states = activeStates();
  if (!states.length) return 'nothing running';
  const lines: string[] = [];
  for (const s of states) {
    let healthy = false;
    try { healthy = (await fetch(s.url + '/v1/models', { signal: AbortSignal.timeout(2000) })).ok || (await fetch(s.url + '/health', { signal: AbortSignal.timeout(2000) })).ok; } catch { /* down */ }
    lines.push(`${s.id}  ${healthy ? 'healthy' : 'NOT RESPONDING'}  ${s.url}  since ${s.startedAt}  record ${relative(process.cwd(), s.runDir) || s.runDir}`);
  }
  return lines.join('\n');
}

