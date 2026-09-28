// Running commands on placed nodes (local or SSH), the IE_* environment, and device locks.
import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { createWriteStream, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Recipe, Scalar } from './manifest.ts';
import type { Placement } from './inventory.ts';
import { shellQuote } from './source.ts';

export const isLocal = (p: Placement) => p.host.address === 'local';

export function workRoot(p: Placement): string {
  return p.host.work_dir ?? (isLocal(p) ? join(process.env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'inference-engines') : '.cache/inference-engines');
}
export const slug = (id: string) => id.replace(/\//g, '__');

export interface NodeDirs { work: string; src: string; adapter?: string }
export function nodeDirs(r: Recipe, p: Placement): NodeDirs {
  const work = join(workRoot(p), slug(r.id));
  return {
    work,
    src: join(work, 'src'),
    adapter: r.attribution.source.integration === 'adapter' ? join(work, 'adapter') : undefined,
  };
}

/** Address other nodes use to reach this one: attrs.ADDR, else the SSH host part, else loopback. */
export function nodeAddr(p: Placement): string {
  if (p.host.attrs?.ADDR) return p.host.attrs.ADDR;
  if (isLocal(p)) return '127.0.0.1';
  return p.host.address.replace(/^.*@/, '');
}

export interface EnvInput {
  recipe: Recipe; recipeDir: string; placements: Placement[]; me: Placement;
  params: Record<string, Scalar>; httpPort: number; otlp?: string;
}

const envName = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '_');

export function stepEnv(i: EnvInput): Record<string, string> {
  const dirs = nodeDirs(i.recipe, i.me);
  const env: Record<string, string> = {
    IE_RECIPE_ID: i.recipe.id,
    IE_RECIPE_DIR: i.recipeDir,
    IE_WORK_DIR: dirs.work,
    IE_SRC_DIR: dirs.src,
    IE_HTTP_PORT: String(i.httpPort),
    IE_NODE_RANK: String(i.me.rank),
    IE_NODE_COUNT: String(i.placements.length),
    IE_ROLE: i.me.role,
  };
  if (dirs.adapter) env.IE_ADAPTER_DIR = dirs.adapter;
  if (i.otlp) env.IE_OTEL_EXPORTER_OTLP_ENDPOINT = i.otlp;
  for (const [k, v] of Object.entries(i.params)) env[`IE_PARAM_${envName(k)}`] = String(v);
  for (const p of i.placements) env[`IE_NODE_${p.rank}_ADDR`] = nodeAddr(p);
  const indices = i.me.devices.map((d) => d.index).filter((x) => x !== undefined);
  if (indices.length) {
    env.IE_DEVICES = indices.join(',');
    const kind = i.me.devices[0].kind;
    const vendor = String(i.me.devices[0].vendor ?? 'nvidia').toLowerCase();
    if (kind === 'gpu') env[vendor === 'amd' ? 'HIP_VISIBLE_DEVICES' : 'CUDA_VISIBLE_DEVICES'] = env.IE_DEVICES;
  }
  for (const d of i.me.devices) for (const [role, port] of Object.entries(d.ports ?? {})) env[`IE_PORT_${envName(role)}`] = port;
  for (const [k, v] of Object.entries(i.me.host.attrs ?? {})) env[`IE_INV_${envName(k)}`] = v;
  for (const [k, template] of Object.entries(i.recipe.env_map ?? {})) env[k] = expand(template, env);
  return env;
}

/** Expand ${VAR} from env; unknown variables are an error so typos surface. */
export function expand(template: string, env: Record<string, string>): string {
  return template.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, name: string) => {
    if (!(name in env)) throw new Error(`env_map: \${${name}} is not set for this node`);
    return env[name];
  });
}

/** Spawn a shell command on a node. Remote commands run through ssh with the env inlined. */
export function spawnOn(p: Placement, cwd: string, command: string, env: Record<string, string>, opts: SpawnOptions = {}): ChildProcess {
  if (isLocal(p)) {
    return spawn('bash', ['-c', command], { cwd, env: { ...process.env, ...env }, ...opts });
  }
  return spawn('ssh', ['-o', 'BatchMode=yes', p.host.address, remoteCommand(cwd, command, env)], { ...opts });
}

/** The command line ssh runs on a remote node: cwd, inlined env, then bash -c. */
export function remoteCommand(cwd: string, command: string, env: Record<string, string>): string {
  const assigns = Object.entries(env).map(([k, v]) => `${k}=${shellQuote(v)}`).join(' ');
  return `mkdir -p ${shellQuote(cwd)} && cd ${shellQuote(cwd)} && env ${assigns} bash -c ${shellQuote(command)}`;
}

export interface StepResult { code: number | null; ms: number; stdout: string }

/** Run to completion, teeing output to a log file (and the terminal when `echo`). */
export function runOn(p: Placement, cwd: string, command: string, env: Record<string, string>, log: string, echo = true): Promise<StepResult> {
  const started = Date.now();
  const out = createWriteStream(log, { flags: 'a' });
  const child = spawnOn(p, cwd, command, env, { stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  child.stdout?.on('data', (b: Buffer) => { stdout = (stdout + b.toString()).slice(-65536); });
  for (const s of [child.stdout, child.stderr]) {
    s?.on('data', (b: Buffer) => { out.write(b); if (echo) process.stderr.write(b); });
  }
  return new Promise((resolve) => child.on('close', (code) => { out.end(); resolve({ code, ms: Date.now() - started, stdout }); }));
}

/**
 * Hold a device lock using flock(1) on the same file other tools use (e.g. the
 * Needle board pool). Rejects if busy. The holder runs in its own process group;
 * kill the group to release. Attached holders wait on stdin, so the lock also
 * releases if the launcher dies; detached holders live until `down`.
 */
export function holdLock(p: Placement, lockFile: string, detached = false): Promise<ChildProcess> {
  const wait = detached ? 'exec sleep infinity' : 'exec cat >/dev/null';
  const cmd = `mkdir -p "$(dirname ${shellQuote(lockFile)})" && exec flock -n -E 75 ${shellQuote(lockFile)} -c ${shellQuote(`echo held; ${wait}`)}`;
  const child = spawnOn(p, '/', cmd, {}, { stdio: [detached ? 'ignore' : 'pipe', 'pipe', 'ignore'], detached: true });
  return new Promise((resolve, reject) => {
    let done = false;
    child.stdout?.on('data', (b: Buffer) => {
      if (!done && b.toString().includes('held')) { done = true; child.stdout?.destroy(); resolve(child); }
    });
    child.on('exit', (code) => {
      if (!done) { done = true; reject(new Error(code === 75 ? `device busy: ${lockFile} is held by another run` : `could not lock ${lockFile} (exit ${code})`)); }
    });
  });
}

export function releaseLock(holder: ChildProcess | number): void {
  const pid = typeof holder === 'number' ? holder : holder.pid;
  if (!pid) return;
  try { process.kill(-pid, 'SIGTERM'); } catch { /* already gone */ }
}

export function ensureDir(path: string): string {
  mkdirSync(path, { recursive: true });
  return path;
}
