// Benchmark runner: suites in benchmarks/suites/<name>/suite.yaml, run against a
// recipe's endpoint. Built-in runners cover perf and exact tool calls; external
// harnesses run from a pinned Python environment.
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import YAML from 'yaml';
import { REPO_ROOT, type LoadedRecipe } from './manifest.ts';
import { down, prepare, readState, up, type RunOptions } from './run.ts';
import { ensureDir, nodeDirs, runOn, slug, stepEnv } from './nodes.ts';
import { stateRoot } from './disclosure.ts';

export interface Suite {
  name: string; status: 'ready' | 'defined' | 'placeholder'; description: string; applies_to: string[];
  runner: 'builtin:perf' | 'builtin:tool-calls' | 'command' | 'recipe-command' | 'none';
  harness?: { name: string; pip?: string[]; repo?: string; commit?: string; version?: string };
  datasets?: { name: string; url?: string; revision?: string }[];
  tiers?: Record<string, { limit?: number; repeats?: number; command?: string; note?: string }>;
  command?: string;
}

const SUITES_DIR = join(REPO_ROOT, 'benchmarks', 'suites');

export function listSuites(): Suite[] {
  if (!existsSync(SUITES_DIR)) return [];
  return readdirSync(SUITES_DIR)
    .filter((d) => existsSync(join(SUITES_DIR, d, 'suite.yaml')))
    .map((d) => YAML.parse(readFileSync(join(SUITES_DIR, d, 'suite.yaml'), 'utf8')) as Suite);
}

export function loadSuite(name: string): { suite: Suite; hash: string } {
  const file = join(SUITES_DIR, name, 'suite.yaml');
  if (!existsSync(file)) throw new Error(`no suite "${name}"; see \`suites\``);
  const text = readFileSync(file, 'utf8');
  return { suite: YAML.parse(text) as Suite, hash: createHash('sha256').update(text).digest('hex') };
}

// --- endpoint client ------------------------------------------------------

export interface ChatResult {
  ok: boolean; status: number; latency_ms: number; ttft_ms?: number;
  content?: string; tool_calls?: { name: string; arguments: unknown }[]; finish_reason?: string;
  usage?: { prompt_tokens?: number; completion_tokens?: number }; error?: string; raw?: unknown;
}

export async function chat(baseUrl: string, body: Record<string, unknown>, timeoutMs = 600_000): Promise<ChatResult> {
  const started = performance.now();
  let res: Response;
  try {
    res = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    return { ok: false, status: 0, latency_ms: performance.now() - started, error: (e as Error).message };
  }
  const type = res.headers.get('content-type') ?? '';
  if (body.stream && type.includes('text/event-stream') && res.body) {
    let ttft: number | undefined;
    let content = '';
    let finish: string | undefined;
    let usage: ChatResult['usage'];
    const calls = new Map<number, { name: string; args: string }>();
    const decoder = new TextDecoder();
    let buf = '';
    for await (const chunk of res.body) {
      buf += decoder.decode(chunk as Uint8Array, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (data === '[DONE]') continue;
        const ev = JSON.parse(data);
        const delta = ev.choices?.[0]?.delta ?? {};
        if (ttft === undefined && (delta.content || delta.tool_calls || delta.reasoning_content)) ttft = performance.now() - started;
        content += delta.content ?? '';
        for (const tc of delta.tool_calls ?? []) {
          const cur = calls.get(tc.index ?? 0) ?? { name: '', args: '' };
          cur.name += tc.function?.name ?? '';
          cur.args += tc.function?.arguments ?? '';
          calls.set(tc.index ?? 0, cur);
        }
        finish = ev.choices?.[0]?.finish_reason ?? finish;
        if (ev.usage) usage = ev.usage;
      }
    }
    return {
      ok: res.ok, status: res.status, latency_ms: performance.now() - started, ttft_ms: ttft, content, finish_reason: finish, usage,
      tool_calls: [...calls.values()].map((c) => ({ name: c.name, arguments: parseArgs(c.args) })),
    };
  }
  const text = await res.text();
  let json: any;
  try { json = JSON.parse(text); } catch { json = { error: text.slice(0, 500) }; }
  const msg = json.choices?.[0]?.message;
  return {
    ok: res.ok, status: res.status, latency_ms: performance.now() - started, content: msg?.content ?? undefined,
    finish_reason: json.choices?.[0]?.finish_reason, usage: json.usage,
    tool_calls: (msg?.tool_calls ?? []).map((tc: any) => ({ name: tc.function?.name, arguments: parseArgs(tc.function?.arguments) })),
    error: res.ok ? undefined : JSON.stringify(json.error ?? json).slice(0, 500), raw: json,
  };
}

const parseArgs = (a: unknown) => { if (typeof a !== 'string') return a ?? {}; try { return JSON.parse(a || '{}'); } catch { return a; } };

/** Parse Prometheus text exposition into name{labels} -> value. */
export function parseProm(text: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const line of text.split('\n')) {
    if (!line || line.startsWith('#')) continue;
    const m = /^([a-zA-Z_:][a-zA-Z0-9_:]*(?:\{[^}]*\})?)\s+([-+0-9.eEinfNa]+)/.exec(line);
    if (m) out[m[1]] = Number(m[2]);
  }
  return out;
}

async function scrape(url: string | undefined): Promise<Record<string, number> | undefined> {
  if (!url) return undefined;
  try { return parseProm(await (await fetch(url, { signal: AbortSignal.timeout(5000) })).text()); } catch { return undefined; }
}

const delta = (a?: Record<string, number>, b?: Record<string, number>) => {
  if (!a || !b) return undefined;
  const d: Record<string, number> = {};
  for (const k of Object.keys(b)) if (k in a && b[k] !== a[k]) d[k] = b[k] - a[k];
  return d;
};

// --- workloads ------------------------------------------------------------

export interface Case {
  id: string; messages: { role: string; content: string }[]; tools?: unknown[];
  expect?: { name: string; arguments: Record<string, unknown> }[]; max_tokens?: number; model?: string;
  [extra: string]: unknown;
}

export function loadWorkload(file: string): Case[] {
  const data = YAML.parse(readFileSync(file, 'utf8'));
  const cases = (Array.isArray(data) ? data : data.cases) as Case[];
  if (!cases?.length) throw new Error(`${file}: no cases`);
  return cases;
}

/** Deep equality with key order ignored; numbers and numeric strings are not coerced. */
export function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a as object), kb = Object.keys(b as object);
  return ka.length === kb.length && ka.every((k) => sameJson((a as any)[k], (b as any)[k]));
}

export function exactCalls(got: { name: string; arguments: unknown }[] | undefined, want: Case['expect']): boolean {
  const g = got ?? [];
  const w = want ?? [];
  return g.length === w.length && g.every((c, i) => c.name === w[i].name && sameJson(c.arguments ?? {}, w[i].arguments ?? {}));
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : undefined);
const pct = (xs: number[], p: number) => { if (!xs.length) return undefined; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]; };

// --- runners ----------------------------------------------------------------

interface RunCtx { base: string; model: string; metricsUrl?: string; cases: Case[]; repeats: number; engineMetrics?: Record<string, string> }

const requestBody = (ctx: RunCtx, c: Case, stream: boolean) => {
  const body: Record<string, unknown> = { model: c.model ?? ctx.model, messages: c.messages, temperature: 0, max_tokens: c.max_tokens ?? 1024 };
  if (c.tools) body.tools = c.tools;
  if (stream) { body.stream = true; body.stream_options = { include_usage: true }; }
  return body;
};

/** Returns whether streaming was used; it is dropped if the endpoint refuses it. */
async function runCases(ctx: RunCtx, wantStream: boolean, onRow: (row: Record<string, unknown>) => void): Promise<boolean> {
  let stream = wantStream;
  if (stream) {
    const probe = await chat(ctx.base, { ...requestBody(ctx, ctx.cases[0], true), max_tokens: 4 });
    if (!probe.ok && probe.status >= 400 && probe.status < 500) stream = false;
  }
  for (let rep = 0; rep < ctx.repeats; rep++) {
    for (const c of ctx.cases) {
      const before = await scrape(ctx.metricsUrl);
      const r = await chat(ctx.base, requestBody(ctx, c, stream));
      const after = await scrape(ctx.metricsUrl);
      onRow({ case: c.id, repeat: rep, streamed: stream, ...r, raw: undefined, engine_metrics_delta: delta(before, after) });
    }
  }
  return stream;
}

/** Engine-reported rates from metric deltas, when the recipe maps its metric names. */
function engineRates(rows: Record<string, any>[], map?: Record<string, string>) {
  if (!map) return undefined;
  const sum = (k: string) => rows.reduce((a, r) => a + (map[k] ? r.engine_metrics_delta?.[map[k]] ?? 0 : 0), 0);
  const dt = sum('decode_tokens'), dms = sum('decode_ms'), pt = sum('prefill_tokens'), pms = sum('prefill_ms');
  const per = (k: string, kms: string) => mean(rows.map((r) => {
    const t = r.engine_metrics_delta?.[map[k]], ms = r.engine_metrics_delta?.[map[kms]];
    return t && ms ? (t / ms) * 1000 : NaN;
  }).filter((x) => !Number.isNaN(x)));
  return {
    decode_tok_s_pooled: dms ? (dt / dms) * 1000 : undefined, prefill_tok_s_pooled: pms ? (pt / pms) * 1000 : undefined,
    decode_tok_s_mean: per('decode_tokens', 'decode_ms'), prefill_tok_s_mean: per('prefill_tokens', 'prefill_ms'),
    decode_tokens: dt, prefill_tokens: pt,
  };
}

export function summarizePerf(rows: Record<string, any>[], map?: Record<string, string>) {
  const ok = rows.filter((r) => r.ok);
  const lat = ok.map((r) => r.latency_ms);
  const ttft = ok.map((r) => r.ttft_ms).filter((x) => x !== undefined);
  const clientDecode = ok.map((r) => (r.ttft_ms !== undefined && r.usage?.completion_tokens > 1 ? (r.usage.completion_tokens - 1) / ((r.latency_ms - r.ttft_ms) / 1000) : NaN)).filter((x) => !Number.isNaN(x));
  return {
    requests: rows.length, succeeded: ok.length,
    latency_ms: { mean: mean(lat), p50: pct(lat, 50), p90: pct(lat, 90) },
    ttft_ms: ttft.length ? { mean: mean(ttft), p50: pct(ttft, 50), p90: pct(ttft, 90) } : null,
    client_decode_tok_s_mean: mean(clientDecode) ?? null,
    completion_tokens: ok.reduce((a, r) => a + (r.usage?.completion_tokens ?? 0), 0),
    engine: engineRates(ok, map) ?? null,
  };
}

export function summarizeToolCalls(rows: Record<string, any>[], cases: Case[]) {
  const byId = new Map(cases.map((c) => [c.id, c]));
  const scored = rows.map((r) => ({ case: r.case, ok: r.ok, exact: r.ok && exactCalls(r.tool_calls, byId.get(r.case)?.expect) }));
  return {
    requests: rows.length, succeeded: scored.filter((s) => s.ok).length,
    exact_calls: scored.filter((s) => s.exact).length,
    exact_call_accuracy: rows.length ? scored.filter((s) => s.exact).length / rows.length : null,
    per_case: scored,
  };
}

export interface BenchOptions extends RunOptions { suite: string; tier: 'smoke' | 'card'; out?: string; limit?: number }

export async function bench(loaded: LoadedRecipe, o: BenchOptions): Promise<string> {
  const r = loaded.recipe;
  const { suite, hash } = loadSuite(o.suite);
  if (suite.status === 'placeholder' || suite.runner === 'none') throw new Error(`suite ${suite.name} is a placeholder; nothing to run yet`);
  if (!suite.applies_to.includes('all') && !suite.applies_to.some((p) => r.purpose.includes(p))) {
    throw new Error(`suite ${suite.name} applies to ${suite.applies_to.join(', ')}; ${r.id} is ${r.purpose.join(', ')}`);
  }
  const tier = suite.tiers?.[o.tier] ?? {};
  let state = readState(r.id);
  const startedHere = !state;
  if (!state) {
    state = await up(loaded, { ...o, detach: true });
    if (!state) throw new Error('recipe did not start');
  }
  try {
    const runRecord = JSON.parse(readFileSync(join(state.runDir, 'run.json'), 'utf8'));
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const outDir = ensureDir(o.out ?? join(loaded.dir, 'benchmarks', 'results', `${stamp.slice(0, 10)}-${suite.name}-${o.tier}`));
    const rows: Record<string, unknown>[] = [];
    const rawFile = join(outDir, 'raw.jsonl');
    writeFileSync(rawFile, '');
    const onRow = (row: Record<string, unknown>) => { rows.push(row); writeFileSync(rawFile, JSON.stringify(row) + '\n', { flag: 'a' }); };
    let summary: unknown;
    let workloadFile: string | undefined;

    if (suite.runner === 'builtin:perf' || suite.runner === 'builtin:tool-calls') {
      const wl = r.benchmarks?.workloads;
      if (!wl) throw new Error(`${r.id} declares no benchmarks.workloads file`);
      workloadFile = join(loaded.dir, wl);
      let cases = loadWorkload(workloadFile);
      if (suite.runner === 'builtin:tool-calls') cases = cases.filter((c) => c.expect);
      const limit = o.limit ?? tier.limit;
      if (limit) cases = cases.slice(0, limit);
      const metricsUrl = r.telemetry?.metrics ? state.url + r.telemetry.metrics.path : undefined;
      const map = r.benchmarks?.engine_metrics;
      const ctx: RunCtx = { base: state.url, model: r.endpoint.model ?? r.id, metricsUrl, cases, repeats: tier.repeats ?? 1, engineMetrics: map };
      // One unmeasured warm-up request, as the suites require.
      await chat(state.url, { model: cases[0].model ?? ctx.model, messages: cases[0].messages, tools: cases[0].tools, max_tokens: cases[0].max_tokens ?? 16, temperature: 0 });
      const streamed = await runCases(ctx, suite.runner === 'builtin:perf', onRow);
      summary = suite.runner === 'builtin:perf' ? { streamed, ...summarizePerf(rows as any, map) } : summarizeToolCalls(rows as any, cases);
    } else if (suite.runner === 'recipe-command') {
      summary = await runRecipeCommand(loaded, o, state.url, outDir);
    } else {
      summary = runCommandSuite(suite, tier, o, state.url, r.endpoint.model ?? r.id, outDir);
    }

    const config = {
      recipe: r.id, recipe_status: r.status, suite: suite.name, tier: o.tier, suite_sha256: hash,
      harness: suite.harness ?? 'builtin', datasets: suite.datasets ?? [], workload: workloadFile ? relative(REPO_ROOT, workloadFile) : null,
      workload_sha256: workloadFile ? createHash('sha256').update(readFileSync(workloadFile)).digest('hex') : null,
      catalog: runRecord.catalog, source: publicSource(runRecord.source, r.attribution.source.repo), params: runRecord.params, profile: runRecord.profile,
      placements: runRecord.placements, acknowledgments: runRecord.acknowledgments,
      started_at: stamp, finished_at: new Date().toISOString(), runner: `node ${process.version}`,
      note: runRecord.source?.override ? 'source overridden on the command line' : undefined,
    };
    writeFileSync(join(outDir, 'run-config.json'), JSON.stringify(config, null, 2) + '\n');
    writeFileSync(join(outDir, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
    return outDir;
  } finally {
    if (startedHere) await down(r.id, loaded, { quiet: true });
  }
}

/** External harness: a pinned venv under the cache, then the tier's command with IE_* variables. */
function runCommandSuite(suite: Suite, tier: { command?: string; limit?: number }, o: BenchOptions, url: string, model: string, outDir: string) {
  const command = tier.command ?? suite.command;
  if (!command || !suite.harness?.pip?.length) throw new Error(`suite ${suite.name} has no command or pinned harness`);
  const venv = join(stateRoot(), 'bench-venvs', slug(suite.name));
  if (!existsSync(join(venv, 'bin', 'python'))) {
    execFileSync('python3', ['-m', 'venv', venv], { stdio: 'inherit' });
    execFileSync(join(venv, 'bin', 'pip'), ['install', '--quiet', ...suite.harness.pip], { stdio: 'inherit' });
  }
  const env = {
    ...process.env, PATH: `${join(venv, 'bin')}:${process.env.PATH}`, IE_BASE_URL: url, IE_MODEL: model, IE_OUT: outDir,
    IE_LIMIT: String(o.limit ?? tier.limit ?? ''), OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? 'not-needed',
  };
  const res = spawnSync('bash', ['-c', command], { env, stdio: 'inherit' });
  if (res.status !== 0) throw new Error(`${suite.name} harness exited ${res.status}`);
  const summaryFile = join(outDir, 'harness-summary.json');
  return existsSync(summaryFile) ? JSON.parse(readFileSync(summaryFile, 'utf8')) : { note: 'see harness output in this directory' };
}

/** Engine-provided check (fidelity): the recipe's command, run in its checkout on the head node. */
async function runRecipeCommand(loaded: LoadedRecipe, o: BenchOptions, url: string, outDir: string) {
  const r = loaded.recipe;
  const command = r.benchmarks?.fidelity;
  if (!command) throw new Error(`${r.id} declares no benchmarks.fidelity command`);
  const p = prepare(loaded, { ...o, yes: true });
  const head = p.placements[0];
  const env = { ...stepEnv({ recipe: r, recipeDir: loaded.dir, placements: p.placements, me: head, params: p.params, httpPort: p.httpPort }), IE_OUT: outDir, IE_BASE_URL: url };
  const res = await runOn(head, nodeDirs(r, head).src, command, env, join(outDir, 'harness.log'), !o.quiet);
  if (res.code !== 0) throw new Error(`fidelity command exited ${res.code}; see ${join(outDir, 'harness.log')}`);
  const summaryFile = join(outDir, 'harness-summary.json');
  if (!existsSync(summaryFile)) throw new Error('fidelity command did not write harness-summary.json');
  return JSON.parse(readFileSync(summaryFile, 'utf8'));
}

/** Committed results name the pinned repository, never a local path or mirror URL. */
export function publicSource(src: { repo: string; commit: string; override: boolean; mirror?: string }, pinnedRepo: string) {
  if (src.override) return { repo: '(overridden on the command line)', commit: src.commit, override: true };
  return { repo: pinnedRepo, commit: src.commit, override: false, fetched_from: src.mirror ? 'mirror' : 'pin' };
}
