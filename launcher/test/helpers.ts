// Test helpers: temporary state dirs, a local git "upstream", and recipe fixtures.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, cpSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

export const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

/** Isolate launcher state, cache and config under a temp dir for this process. */
export function isolate(): string {
  const root = mkdtempSync(join(tmpdir(), 'ie-test-'));
  process.env.XDG_STATE_HOME = join(root, 'state');
  process.env.XDG_CACHE_HOME = join(root, 'cache');
  process.env.XDG_CONFIG_HOME = join(root, 'config');
  return root;
}

export function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=test', ...args], { cwd, encoding: 'utf8' }).trim();
}

/** A local git repo with the fake engine and a start script; returns its path and HEAD. */
export function makeUpstream(root: string): { repo: string; commit: string } {
  const repo = join(root, 'upstream');
  mkdirSync(repo, { recursive: true });
  git(repo, 'init', '-q', '-b', 'main');
  cpSync(join(FIXTURES, 'fake_engine.py'), join(repo, 'fake_engine.py'));
  writeFileSync(join(repo, 'start.sh'), '#!/bin/sh\nexec python3 fake_engine.py "$PORT"\n');
  writeFileSync(join(repo, 'Makefile'), 'setup:\n\t@echo setup-ok\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'init');
  return { repo, commit: git(repo, 'rev-parse', 'HEAD') };
}

export function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => resolve(port));
    });
  });
}

export function baseRecipe(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: 1,
    id: 'fake/cpu/test',
    title: 'Fake engine',
    status: 'unverified',
    purpose: ['tool-calling', 'general'],
    attribution: {
      authors: [{ name: 'Test', role: 'author' }],
      source: { repo: 'TODO', commit: 'TODO', license: 'MIT', relationship: 'linked', integration: 'native' },
      components: [{ kind: 'weights', name: 'fake-weights', revision: 'abc', license: 'Apache-2.0', terms: { gated: false, commercial: true } }],
    },
    runtime: { isolation: 'host', privileges: [], network: { listen: '127.0.0.1:$IE_HTTP_PORT', auth: false } },
    hardware: { targets: [{ kind: 'mcu', match: { chip: 'fake' }, ports: ['serial'] }], topology: { nodes: 1, devices_per_node: 1 } },
    params: { layers: { default: 8, allowed: [2, 4, 8] } },
    profiles: { fast: { layers: 2 } },
    steps: { setup: 'echo setup-ok > .setup-done', serve: 'exec python3 fake_engine.py' },
    endpoint: { protocol: 'openai', model: 'fake' },
    telemetry: { metrics: { format: 'prometheus', path: '/metrics' } },
    benchmarks: {
      workloads: 'workload.yaml',
      engine_metrics: { decode_tokens: 'fake_decode_tokens_total', decode_ms: 'fake_decode_ms_total' },
    },
    ...over,
  };
}

/** Write a catalog with one recipe under root/catalog/hardware/...; returns the manifest path. */
export function writeRecipe(root: string, recipe: Record<string, unknown>, files: Record<string, string> = {}): string {
  const dir = join(root, 'catalog', 'hardware', ...(recipe.id as string).split('/'));
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'recipe.yaml');
  writeFileSync(file, YAML.stringify(recipe));
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true });
    writeFileSync(join(dir, name), text);
  }
  return file;
}

export function writeInventory(root: string, inv: unknown): string {
  const file = join(root, 'inventory.yaml');
  writeFileSync(file, YAML.stringify(inv));
  return file;
}

export const WORKLOAD = YAML.stringify({
  cases: [
    { id: 'timer', messages: [{ role: 'user', content: 'call set_timer {"seconds": 60}' }], expect: [{ name: 'set_timer', arguments: { seconds: 60 } }] },
    { id: 'none', messages: [{ role: 'user', content: 'hello' }], expect: [] },
    { id: 'wrong', messages: [{ role: 'user', content: 'call set_timer {"seconds": 5}' }], expect: [{ name: 'set_timer', arguments: { seconds: 6 } }] },
  ],
});
