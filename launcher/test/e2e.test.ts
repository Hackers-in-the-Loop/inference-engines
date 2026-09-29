// End to end on this machine: a local git "upstream", a fake OpenAI engine, a
// device lock, detached up, status, bench and down.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parseManifest } from '../src/manifest.ts';
import { down, readState, up, type RunOptions } from '../src/run.ts';
import { bench } from '../src/bench.ts';
import { sha256File } from '../src/source.ts';
import { baseRecipe, freePort, isolate, makeUpstream, writeInventory, writeRecipe, WORKLOAD } from './helpers.ts';

const quietly = async <T>(fn: () => Promise<T>): Promise<T> => {
  const w = process.stderr.write;
  process.stderr.write = () => true;
  try { return await fn(); } finally { process.stderr.write = w; }
};

const lockBusy = (lock: string) => {
  try { execFileSync('flock', ['-n', lock, 'true']); return false; } catch { return true; }
};

function setup(over: Record<string, unknown> = {}, files: Record<string, string> = {}) {
  const root = isolate();
  const upstream = makeUpstream(root);
  const recipe = baseRecipe({
    attribution: { ...(baseRecipe().attribution as object), source: { repo: upstream.repo, commit: upstream.commit, license: 'MIT', relationship: 'linked', integration: 'native' } },
    ...over,
  });
  const file = writeRecipe(root, recipe, { 'workload.yaml': WORKLOAD, ...files });
  const lock = join(root, 'locks', 'board1.lock');
  const inventory = writeInventory(root, { hosts: [{ name: 'bench', address: 'local', devices: [{ kind: 'mcu', label: 'board1', chip: 'fake', ports: { serial: '/dev/null' }, lock }] }] });
  const { recipe: parsed, problems } = parseManifest(file);
  assert.deepEqual(problems, []);
  return { root, upstream, lock, inventory, loaded: { recipe: parsed!, file, dir: join(file, '..') } };
}

const opts = async (inventory: string, extra: Partial<RunOptions> = {}): Promise<RunOptions> => ({
  params: {}, inventory, yes: true, accept: [], detach: true, timeoutS: 30, otel: false, interactive: false, quiet: true,
  port: await freePort(), ...extra,
});

test('native recipe: up --detach holds the device lock, serves, benches, and down releases', async () => {
  const s = setup();
  const o = await opts(s.inventory);
  const state = await quietly(() => up(s.loaded, o));
  assert.ok(state);
  try {
    assert.equal(lockBusy(s.lock), true, 'device lock held while running');
    const models = await (await fetch(`${state.url}/v1/models`)).json();
    assert.equal(models.data[0].id, 'fake');
    const record = JSON.parse(readFileSync(join(state.runDir, 'run.json'), 'utf8'));
    assert.equal(record.source.commit, s.upstream.commit);
    assert.deepEqual(record.steps.map((x: { step: string }) => x.step), ['checkout', 'setup']);
    assert.ok(existsSync(join(process.env.XDG_CACHE_HOME!, 'inference-engines', 'fake__cpu__test', 'src', '.setup-done')));

    const toolDir = await quietly(() => bench(s.loaded, { ...o, suite: 'tool-calls', tier: 'smoke', out: join(s.root, 'out-tools') }));
    const tools = JSON.parse(readFileSync(join(toolDir, 'summary.json'), 'utf8'));
    assert.equal(tools.requests, 3);
    assert.equal(tools.exact_calls, 2);
    const cfg = JSON.parse(readFileSync(join(toolDir, 'run-config.json'), 'utf8'));
    assert.equal(cfg.source.commit, s.upstream.commit);
    assert.equal(readFileSync(join(toolDir, 'raw.jsonl'), 'utf8').trim().split('\n').length, 3);

    const perfDir = await quietly(() => bench(s.loaded, { ...o, suite: 'perf', tier: 'smoke', out: join(s.root, 'out-perf') }));
    const perf = JSON.parse(readFileSync(join(perfDir, 'summary.json'), 'utf8'));
    assert.equal(perf.succeeded, 3);
    assert.ok(perf.ttft_ms.mean > 0);
    assert.equal(perf.engine.decode_tokens, 15);
    assert.equal(Math.round(perf.engine.decode_tok_s_pooled), 100);
  } finally {
    await quietly(() => down(s.loaded.recipe.id, s.loaded, { quiet: true }));
  }
  assert.equal(readState(s.loaded.recipe.id), undefined);
  assert.equal(lockBusy(s.lock), false, 'device lock released');
  await assert.rejects(fetch(`${state.url}/v1/models`));
});

test('a busy device is refused before anything runs', async () => {
  const s = setup();
  mkdirSync(dirname(s.lock), { recursive: true });
  const holder = spawn('flock', ['-n', s.lock, 'sleep', '30'], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 300));
  try {
    assert.equal(lockBusy(s.lock), true);
    await assert.rejects(quietly(async () => up(s.loaded, await opts(s.inventory))), /device busy/);
    assert.equal(readState(s.loaded.recipe.id), undefined);
  } finally {
    holder.kill();
  }
});

test('bench starts and stops the recipe when it is not already running', async () => {
  const s = setup();
  const o = await opts(s.inventory);
  const dir = await quietly(() => bench(s.loaded, { ...o, suite: 'tool-calls', tier: 'smoke', out: join(s.root, 'out') }));
  assert.equal(JSON.parse(readFileSync(join(dir, 'summary.json'), 'utf8')).exact_calls, 2);
  assert.equal(readState(s.loaded.recipe.id), undefined);
  assert.equal(lockBusy(s.lock), false);
});

test('adapter recipe: runs through adapter scripts, refuses a changed upstream', async () => {
  const root0 = isolate();
  const up0 = makeUpstream(root0);
  const lockText = `${sha256File(join(up0.repo, 'start.sh'))}  start.sh\n`;
  const serve = '#!/bin/sh\n# Adapter: map our port onto upstream\'s variable, then run their script.\nexport PORT="$IE_HTTP_PORT"\nexec sh "$IE_SRC_DIR/start.sh"\n';
  const s = setup({
    attribution: { ...(baseRecipe().attribution as object), source: { repo: up0.repo, commit: up0.commit, license: 'AGPL-3.0-or-later', relationship: 'linked', integration: 'adapter' } },
    steps: { serve: 'sh "$IE_ADAPTER_DIR/serve.sh"' },
  }, { 'adapter/upstream.lock': lockText, 'adapter/serve.sh': serve });
  const o = await opts(s.inventory);
  const state = await quietly(() => up(s.loaded, o));
  assert.ok(state);
  assert.equal((await fetch(`${state.url}/v1/models`)).status, 200);
  await quietly(() => down(s.loaded.recipe.id, s.loaded, { quiet: true }));

  // Tamper with the pinned upstream file in the node's checkout: the next up must refuse.
  const src = join(process.env.XDG_CACHE_HOME!, 'inference-engines', 'fake__cpu__test', 'src');
  writeFileSync(join(src, 'start.sh'), 'echo changed\n');
  execFileSync('git', ['-C', src, '-c', 'user.email=t@e', '-c', 'user.name=t', 'commit', '-qam', 'local change']);
  const changed = { ...s.loaded, recipe: { ...s.loaded.recipe, attribution: { ...s.loaded.recipe.attribution, source: { ...s.loaded.recipe.attribution.source, commit: execFileSync('git', ['-C', src, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() } } } };
  await assert.rejects(quietly(async () => up(changed, await opts(s.inventory))), /upstream changed; adapter needs review/);
  assert.equal(lockBusy(s.lock), false);
});

test('serve that dies before health fails the run and releases the device', async () => {
  const s = setup({ steps: { serve: 'echo boom; exit 3' } });
  await assert.rejects(quietly(async () => up(s.loaded, await opts(s.inventory))), /serve exited \(code 3\)/);
  assert.equal(readState(s.loaded.recipe.id), undefined);
  assert.equal(lockBusy(s.lock), false);
});

test('perf falls back to non-streaming when the endpoint refuses streams', async () => {
  const s = setup({ steps: { serve: 'FAKE_NO_STREAM=1 exec python3 fake_engine.py' } });
  const o = await opts(s.inventory);
  const dir = await quietly(() => bench(s.loaded, { ...o, suite: 'perf', tier: 'smoke', out: join(s.root, 'out') }));
  const perf = JSON.parse(readFileSync(join(dir, 'summary.json'), 'utf8'));
  assert.equal(perf.streamed, false);
  assert.equal(perf.succeeded, 3);
  assert.equal(perf.ttft_ms, null);
  assert.equal(perf.engine.decode_tokens, 15);
});

test('fidelity runs the engine check without serving, and gets an absolute IE_OUT', async () => {
  const s = setup({ benchmarks: { ...(baseRecipe().benchmarks as object), fidelity: 'case "$IE_OUT" in /*) ;; *) exit 9;; esac; echo \'{"passed": true}\' > "$IE_OUT/harness-summary.json"' } });
  const o = await opts(s.inventory);
  const rel = join('launcher', 'test', '.tmp-fidelity-out');
  const dir = await quietly(() => bench(s.loaded, { ...o, suite: 'fidelity', tier: 'smoke', out: rel }));
  try {
    assert.ok(dir.startsWith('/'));
    assert.deepEqual(JSON.parse(readFileSync(join(dir, 'summary.json'), 'utf8')), { passed: true });
    assert.equal(readState(s.loaded.recipe.id), undefined);
    assert.equal(lockBusy(s.lock), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('command suites without a pip harness get the recipe context (taste wiring)', async () => {
  const s = setup();
  const taste = join(s.root, 'taste-benchmark');
  mkdirSync(join(taste, 'scripts'), { recursive: true });
  // A stand-in for taste-benchmark's runner: record the arguments and environment it was given.
  writeFileSync(join(taste, 'scripts', 'run-benchmark.sh'), `#!/bin/sh
python3 - "$@" <<'PY'
import json, os, sys
json.dump({"args": sys.argv[1:], "recipe": json.load(open(os.environ["IE_RECIPE_JSON"]))}, open(os.path.join(os.environ["IE_OUT"], "harness-summary.json"), "w"))
PY
`, { mode: 0o755 });
  process.env.TASTE_BENCHMARK_DIR = taste;
  const o = await opts(s.inventory);
  try {
    const dir = await quietly(() => bench(s.loaded, { ...o, suite: 'taste', tier: 'smoke', out: join(s.root, 'out') }));
    const got = JSON.parse(readFileSync(join(dir, 'harness-summary.json'), 'utf8'));
    const arg = (flag: string) => got.args[got.args.indexOf(flag) + 1];
    assert.equal(arg('--provider'), 'openai');
    assert.match(arg('--base-url'), /^http:\/\/127\.0\.0\.1:\d+\/v1$/);
    assert.equal(arg('--model'), 'fake');
    assert.equal(arg('--engine'), 'HACK-cpu-test');
    assert.equal(arg('--model-id'), 'fake');
    assert.equal(arg('--tasks'), 'simple,detailed,makebetter');
    assert.equal(got.recipe.id, 'fake/cpu/test');
    assert.equal(got.recipe.commit, s.upstream.commit);
  } finally {
    delete process.env.TASTE_BENCHMARK_DIR;
  }
});
