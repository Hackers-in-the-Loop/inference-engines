// The run plan shown before anything executes, and license acknowledgments.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { STEP_ORDER, type Component, type Recipe, type Scalar } from './manifest.ts';
import type { Placement } from './inventory.ts';
import { ensureDir } from './nodes.ts';

const licenseText = (l: string | string[]) => (Array.isArray(l) ? l.join(' + ') : l);
const size = (n?: number) => (n === undefined ? '' : n >= 1e9 ? `~${(n / 1e9).toFixed(0)} GB` : `~${Math.round(n / 1e6)} MB`);

export interface PlanInput {
  recipe: Recipe; placements: Placement[]; params: Record<string, Scalar>; profile?: string;
  components: Component[]; httpPort: number; source: { repo: string; commit: string; override: boolean; mirror?: string };
  steps: string[];
}

export function renderPlan(i: PlanInput): string {
  const r = i.recipe;
  const L: string[] = [];
  L.push(`${r.id}  (status: ${r.status})${i.profile ? `  profile: ${i.profile}` : ''}`);
  L.push(`  ${r.title}`);
  L.push(`  source   ${i.source.repo} @ ${i.source.commit.slice(0, 12)}  (${licenseText(r.attribution.source.license)}, ${r.attribution.source.integration})`);
  if (i.source.override) L.push('  NOTE     source overridden on the command line; this run is not evidence for the pinned recipe');
  else if (i.source.mirror) L.push(`  NOTE     fetching the pinned commit from a mirror; the pin is ${i.source.mirror}`);
  if (Object.keys(i.params).length) L.push(`  params   ${Object.entries(i.params).map(([k, v]) => `${k}=${v}`).join(' ')}`);
  L.push(`  nodes    ${i.placements.map((p) => `rank ${p.rank} ${p.role} on ${p.host.name} [${p.devices.map((d) => d.label ?? d.kind).join(', ')}]`).join('; ')}`);
  L.push('');
  const iso = r.runtime.isolation;
  if (iso === 'host') L.push('  WARNING  runs on the host, not in a container');
  else L.push(`  runs in  ${iso}${r.runtime.container?.image ? ` ${r.runtime.container.image}` : ''}${r.runtime.container?.digest ? `@${r.runtime.container.digest.slice(0, 19)}` : ''}`);
  if (r.runtime.privileges.length) L.push(`  needs    ${r.runtime.privileges.join(', ')}`);
  for (const w of r.runtime.device_writes ?? []) {
    const ports = i.placements.flatMap((p) => p.devices.flatMap((d) => Object.entries(d.ports ?? {}).map(([k, v]) => `${k}=${v}`)));
    L.push(`  WRITES   ${w.toUpperCase()} on ${i.placements.flatMap((p) => p.devices.map((d) => d.label ?? d.kind)).join(', ')}${ports.length ? ` (${ports.join(' ')})` : ''}`);
  }
  for (const h of r.runtime.host_changes ?? []) L.push(`  CHANGES  ${h}`);
  L.push(`  network  listens on ${r.runtime.network.listen.replace('$IE_HTTP_PORT', String(i.httpPort))}${r.runtime.network.auth === false ? ', no auth' : r.runtime.network.auth ? `, auth: ${r.runtime.network.auth}` : ''}`);
  for (const d of r.runtime.downloads ?? []) L.push(`  download ${d.what} ${size(d.approx_bytes)}`);
  L.push('');
  for (const step of i.steps) {
    const cmd = r.steps[step as keyof Recipe['steps']];
    if (!cmd) continue;
    const override = r.runtime.steps?.[step];
    const where = override?.isolation && override.isolation !== iso ? ` [${override.isolation}]` : '';
    L.push(`  ${step.padEnd(8)} ${cmd}${where}${override?.note ? `  (${override.note})` : ''}`);
  }
  L.push('');
  L.push('  licenses');
  for (const c of i.components) {
    const rev = c.revision ?? c.commit ?? c.digest;
    L.push(`    ${c.kind.padEnd(8)} ${c.name}${rev ? ` @${rev.slice(0, 12)}` : ''}  ${licenseText(c.license)}${c.acknowledge === 'required' ? '  [ACKNOWLEDGMENT REQUIRED]' : ''}`);
  }
  return L.join('\n');
}

export function restrictionText(c: Component): string {
  const t = c.terms ?? {};
  const bits = [
    t.gated ? 'gated: accept the terms on the host site and use your own token' : '',
    t.commercial === false ? 'no commercial use' : '',
    t.share_alike ? 'share-alike obligations' : '',
  ].filter(Boolean);
  return [
    `  ${c.name}: ${licenseText(c.license)}`,
    t.summary ? `    ${t.summary}` : '',
    bits.length ? `    ${bits.join('; ')}` : '',
    t.acceptance_url ? `    ${t.acceptance_url}` : '',
  ].filter(Boolean).join('\n');
}

// --- acknowledgment store -------------------------------------------------

export function stateRoot(): string {
  return join(process.env.XDG_STATE_HOME || join(homedir(), '.local', 'state'), 'inference-engines');
}
const ackFile = () => join(stateRoot(), 'acknowledgments.json');

export function termsHash(c: Component): string {
  const material = { license: c.license, terms: c.terms ?? {}, revision: c.revision, commit: c.commit, digest: c.digest, sha256: c.sha256 };
  return createHash('sha256').update(JSON.stringify(material)).digest('hex');
}

type AckStore = Record<string, { hash: string; at: string }>;
function readAcks(): AckStore {
  return existsSync(ackFile()) ? (JSON.parse(readFileSync(ackFile(), 'utf8')) as AckStore) : {};
}
export function isAcknowledged(recipeId: string, c: Component): boolean {
  return readAcks()[`${recipeId}::${c.name}`]?.hash === termsHash(c);
}
export function recordAck(recipeId: string, c: Component): { component: string; hash: string; at: string } {
  const store = readAcks();
  const entry = { hash: termsHash(c), at: new Date().toISOString() };
  store[`${recipeId}::${c.name}`] = entry;
  ensureDir(dirname(ackFile()));
  writeFileSync(ackFile(), JSON.stringify(store, null, 2) + '\n');
  return { component: c.name, ...entry };
}

export interface ConfirmOptions { yes: boolean; accept: string[]; interactive: boolean }

/**
 * Show the plan, collect acknowledgments for restricted components, then ask to
 * continue. `--yes` answers the continue prompt only; license terms need
 * `--accept <component>` or typing the component name.
 */
export async function confirmPlan(plan: string, recipe: Recipe, components: Component[], o: ConfirmOptions): Promise<{ component: string; hash: string; at: string }[]> {
  process.stderr.write(plan + '\n\n');
  const acks: { component: string; hash: string; at: string }[] = [];
  const rl = o.interactive ? createInterface({ input: process.stdin, output: process.stderr }) : undefined;
  try {
    for (const c of components.filter((x) => x.acknowledge === 'required')) {
      if (isAcknowledged(recipe.id, c) && !o.accept.includes(c.name)) {
        acks.push({ component: c.name, hash: termsHash(c), at: 'previously' });
        continue;
      }
      process.stderr.write(`This recipe uses a component with restrictive terms:\n${restrictionText(c)}\n`);
      if (o.accept.includes(c.name)) {
        acks.push(recordAck(recipe.id, c));
        process.stderr.write(`  accepted via --accept ${c.name}\n\n`);
        continue;
      }
      if (!rl) throw new Error(`acknowledgment required for ${c.name}; pass --accept ${c.name} (plain --yes does not cover license terms)`);
      const typed = (await rl.question(`Type "${c.name}" to confirm you understand and accept these terms: `)).trim();
      if (typed !== c.name) throw new Error('not acknowledged; nothing was run');
      acks.push(recordAck(recipe.id, c));
    }
    if (!o.yes) {
      if (!rl) throw new Error('confirmation required; rerun interactively or pass --yes');
      const answer = (await rl.question('Continue? [y/N] ')).trim().toLowerCase();
      if (answer !== 'y' && answer !== 'yes') throw new Error('cancelled; nothing was run');
    }
  } finally {
    rl?.close();
  }
  return acks;
}

export const DEFAULT_UP_STEPS = STEP_ORDER.filter((s) => s !== 'stop');
