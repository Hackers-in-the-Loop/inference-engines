#!/usr/bin/env node
// Inference Engines launcher: `npm run launcher -- <command>`.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parseArgs } from 'node:util';
import YAML from 'yaml';
import { activeComponents, findRecipe, loadCatalog, REPO_ROOT, STEP_ORDER, type StepName } from './manifest.ts';
import { down, prepare, status, up, type RunOptions } from './run.ts';
import { isAcknowledged, restrictionText, stateRoot } from './disclosure.ts';
import { driftReport, readLock, sourceSpec, checkoutScript } from './source.ts';
import { holdLock, releaseLock, slug } from './nodes.ts';
import { defaultInventoryPath, loadInventory } from './inventory.ts';
import { probeInventory } from './probe.ts';
import { bench, listSuites } from './bench.ts';

const USAGE = `usage: npm run launcher -- <command> [options]

  list [--hardware H] [--purpose P] [--all]   recipes, with status and license flags
  show <id>                                   manifest, attribution and terms
  check <id> [run options]                    resolve nodes, print the run plan; changes nothing
  up <id> [run options] [--detach]            setup → fetch → build → deploy → serve → health
  down <id>                                   stop a running recipe and release its devices
  status                                      running recipes
  validate [<id>]                             schema, unique names, acknowledgment rules
  upstream <id>                               adapter recipes: has upstream changed since the pin?
  bench <id> --suite <name> [--tier smoke|card] [--out dir]
  suites                                      benchmark suites
  inventory [--probe]                         show the local inventory, or probe this host

run options: --profile P  --param k=v  --port N  --on <host|label>  --inventory FILE
             --source <path|url> --commit <sha>   (development override; not evidence)
             --only step,step  --yes  --accept <component>  --timeout S  --otel  --quiet`;

function runOptions(v: Record<string, unknown>): RunOptions {
  const params: Record<string, string> = {};
  for (const kv of (v.param as string[] | undefined) ?? []) {
    const i = kv.indexOf('=');
    if (i < 1) throw new Error(`--param expects key=value, got "${kv}"`);
    params[kv.slice(0, i)] = kv.slice(i + 1);
  }
  const only = v.only ? (String(v.only).split(',') as StepName[]) : undefined;
  for (const s of only ?? []) if (!STEP_ORDER.includes(s)) throw new Error(`unknown step "${s}"`);
  return {
    profile: v.profile as string | undefined, params, port: v.port ? Number(v.port) : undefined,
    inventory: v.inventory as string | undefined, on: v.on as string[] | undefined, variant: v.variant as string | undefined,
    source: v.source as string | undefined, commit: v.commit as string | undefined,
    yes: Boolean(v.yes), accept: (v.accept as string[] | undefined) ?? [], detach: Boolean(v.detach), only,
    timeoutS: v.timeout ? Number(v.timeout) : 900, otel: Boolean(v.otel), quiet: Boolean(v.quiet),
    interactive: Boolean(process.stdin.isTTY && process.stderr.isTTY),
  };
}

const OPTIONS = {
  profile: { type: 'string' }, param: { type: 'string', multiple: true }, port: { type: 'string' },
  inventory: { type: 'string' }, on: { type: 'string', multiple: true }, variant: { type: 'string' },
  source: { type: 'string' }, commit: { type: 'string' }, only: { type: 'string' },
  yes: { type: 'boolean', short: 'y' }, accept: { type: 'string', multiple: true }, detach: { type: 'boolean' },
  timeout: { type: 'string' }, otel: { type: 'boolean' }, quiet: { type: 'boolean' },
  hardware: { type: 'string' }, purpose: { type: 'string' }, all: { type: 'boolean' },
  suite: { type: 'string' }, tier: { type: 'string' }, out: { type: 'string' }, limit: { type: 'string' },
  probe: { type: 'boolean' }, help: { type: 'boolean', short: 'h' },
} as const;

async function main(argv: string[]): Promise<number> {
  const { values: v, positionals } = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true });
  const [cmd, id] = positionals;
  if (!cmd || v.help) { console.log(USAGE); return cmd ? 0 : 1; }
  const needId = () => { if (!id) throw new Error(`${cmd} needs a recipe id; see \`list\``); return findRecipe(id); };

  switch (cmd) {
    case 'list': {
      const { recipes, problems } = loadCatalog();
      const rows = recipes.filter(({ recipe: r, file }) =>
        (v.all || r.status !== 'deprecated') &&
        (!v.hardware || relative(join(REPO_ROOT, 'hardware'), file).startsWith(String(v.hardware))) &&
        (!v.purpose || r.purpose.includes(String(v.purpose))));
      for (const { recipe: r } of rows) {
        const flags = (r.attribution.components ?? []).filter((c) => c.acknowledge === 'required').map((c) => `ack:${c.name}`);
        console.log(`${r.id.padEnd(48)} ${r.status.padEnd(11)} ${r.runtime.isolation.padEnd(9)} ${[r.attribution.source.license].flat().join('+')}${flags.length ? '  ' + flags.join(' ') : ''}`);
      }
      if (!rows.length) console.log('no recipes');
      if (problems.length) console.error(`\n${problems.length} problem(s); run \`validate\``);
      return 0;
    }
    case 'show': {
      const { recipe: r, file } = needId();
      console.log(`# ${relative(process.cwd(), file)}\n`);
      console.log(YAML.stringify({ id: r.id, title: r.title, status: r.status, purpose: r.purpose, attribution: r.attribution, runtime: r.runtime, endpoint: r.endpoint }));
      for (const c of activeComponents(r).concat((r.attribution.components ?? []).filter((c) => c.profiles)).filter((c) => c.acknowledge === 'required')) {
        console.log(`acknowledgment required${c.profiles ? ` (profiles: ${c.profiles.join(', ')})` : ''}:\n${restrictionText(c)}\n  ${isAcknowledged(r.id, c) ? 'already acknowledged on this machine' : 'not yet acknowledged'}\n`);
      }
      return 0;
    }
    case 'check': {
      const loaded = needId();
      const p = prepare(loaded, runOptions(v));
      console.log(p.plan + '\n');
      let ok = true;
      for (const t of loaded.recipe.toolchain ?? []) {
        if (!t.check) { console.log(`  toolchain ${t.name} ${t.version ?? ''}: no check command; verify manually`); continue; }
        try {
          const out = execFileSync('bash', ['-c', t.check], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim().split('\n')[0];
          console.log(`  toolchain ${t.name}: ok (${out})`);
        } catch {
          ok = false;
          console.log(`  toolchain ${t.name} ${t.version ?? ''}: MISSING (${t.check})`);
        }
      }
      for (const pl of p.placements) for (const d of pl.devices) if (d.lock) {
        try { releaseLock(await holdLock(pl, d.lock)); console.log(`  device ${d.label ?? d.kind}: free`); }
        catch (e) { ok = false; console.log(`  device ${d.label ?? d.kind}: ${(e as Error).message}`); }
      }
      for (const c of p.components.filter((x) => x.acknowledge === 'required')) {
        console.log(`  ${c.name}: ${isAcknowledged(loaded.recipe.id, c) ? 'acknowledged' : 'needs acknowledgment at `up`'}`);
      }
      return ok ? 0 : 2;
    }
    case 'up': {
      const state = await up(needId(), runOptions(v));
      if (state) console.log(state.url);
      return 0;
    }
    case 'down': {
      if (!id) throw new Error('down needs a recipe id');
      let loaded;
      try { loaded = findRecipe(id); } catch { loaded = undefined; }
      await down(loaded?.recipe.id ?? id, loaded);
      return 0;
    }
    case 'status':
      console.log(await status());
      return 0;
    case 'validate': {
      const { recipes, problems } = loadCatalog();
      const scoped = id ? problems.filter((p) => recipes.some((l) => l.file === p.file && (l.recipe.id === id || l.recipe.aliases?.includes(id)))) : problems;
      for (const l of recipes) {
        if (id && l.recipe.id !== id) continue;
        if (l.recipe.attribution.source.integration === 'adapter' && !existsSync(join(l.dir, 'adapter', 'upstream.lock')) && l.recipe.status !== 'unverified') {
          scoped.push({ file: l.file, message: 'adapter recipes need adapter/upstream.lock once they leave unverified' });
        }
      }
      for (const p of scoped) console.error(`${relative(process.cwd(), p.file)}: ${p.message}`);
      console.log(`${id ? 1 : recipes.length} recipe(s), ${scoped.length} problem(s)`);
      return scoped.length ? 1 : 0;
    }
    case 'upstream': {
      const { recipe: r, dir } = needId();
      if (r.attribution.source.integration !== 'adapter') { console.log(`${r.id} is native; drift checks apply to adapter recipes`); return 0; }
      const lockFile = join(dir, 'adapter', 'upstream.lock');
      if (!existsSync(lockFile)) throw new Error(`${r.id} has no adapter/upstream.lock yet`);
      const spec = sourceSpec(r.attribution.source, {});
      const clone = join(stateRoot(), 'upstream', slug(r.id));
      execFileSync('bash', ['-c', checkoutScript(spec, clone)], { stdio: ['ignore', 'ignore', 'inherit'] });
      const rep = driftReport(clone, spec.commit, readLock(lockFile));
      console.log(`${r.id}\n  pinned  ${rep.pinned}\n  latest  ${rep.latest} (${rep.branch}, ${rep.commitsBehind} commit(s) ahead of the pin)`);
      if (!rep.changed.length) console.log('  adapter files unchanged upstream');
      for (const c of rep.changed) console.log(`  ${c.state.padEnd(8)} ${c.path}`);
      return rep.changed.length ? 3 : 0;
    }
    case 'suites':
      for (const s of listSuites()) console.log(`${s.name.padEnd(18)} ${s.status.padEnd(11)} ${s.applies_to.join(', ').padEnd(24)} ${s.description}`);
      return 0;
    case 'bench': {
      if (!v.suite) throw new Error('bench needs --suite; see `suites`');
      const out = await bench(needId(), { ...runOptions(v), suite: String(v.suite), tier: (v.tier as 'smoke' | 'card') ?? 'smoke', out: v.out as string | undefined, limit: v.limit ? Number(v.limit) : undefined });
      console.log(out);
      return 0;
    }
    case 'inventory': {
      if (v.probe) { console.log(probeInventory()); return 0; }
      const path = (v.inventory as string | undefined) ?? defaultInventoryPath();
      console.log(`# ${path}\n` + YAML.stringify(loadInventory(path)));
      return 0;
    }
    default:
      console.error(`unknown command "${cmd}"\n\n${USAGE}`);
      return 1;
  }
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err: Error) => { console.error(`error: ${err.message}`); process.exit(1); },
);
