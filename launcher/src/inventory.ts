// Local inventory (never committed) and topology resolution.
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import YAML from 'yaml';
import type { Recipe, Scalar, Target } from './manifest.ts';

export interface Device {
  kind: string;
  label?: string;
  index?: number;                 // local device index (GPUs)
  ports?: Record<string, string>; // serial roles (MCUs)
  lock?: string;                  // flock file shared with other tools using this device
  [prop: string]: unknown;
}
export interface Host {
  name: string;
  address: string;                // "local" or an SSH target
  work_dir?: string;
  attrs?: Record<string, string>; // exported as IE_INV_<NAME>
  devices: Device[];
}
export interface Inventory { hosts: Host[] }

export function defaultInventoryPath(): string {
  const base = process.env.XDG_CONFIG_HOME || join(homedir(), '.config');
  return join(base, 'inference-engines', 'inventory.yaml');
}

export function expandHome(path: string): string {
  return path.startsWith('~/') ? join(homedir(), path.slice(2)) : path;
}

export function loadInventory(path = defaultInventoryPath()): Inventory {
  if (!existsSync(path)) {
    throw new Error(`no inventory at ${path}. Copy launcher/inventory.example.yaml there and describe your hosts and devices.`);
  }
  const inv = YAML.parse(readFileSync(path, 'utf8')) as Inventory;
  if (!inv?.hosts?.length) throw new Error(`${path}: expected a non-empty "hosts" list`);
  for (const h of inv.hosts) {
    if (!h.name || !h.address) throw new Error(`${path}: every host needs name and address`);
    h.devices ??= [];
    for (const d of h.devices) {
      if (d.lock) d.lock = expandHome(d.lock);
      if (typeof h.work_dir === 'string') h.work_dir = expandHome(h.work_dir);
    }
  }
  return inv;
}

/** Evaluate one predicate value: ">=16", "<=8", "580.*" glob, or equality. */
export function matchValue(want: Scalar, have: unknown): boolean {
  if (have === undefined || have === null) return false;
  if (typeof want === 'string') {
    const cmp = /^(>=|<=|>|<)\s*(-?\d+(?:\.\d+)?)$/.exec(want);
    if (cmp) {
      const n = Number(have);
      const v = Number(cmp[2]);
      if (Number.isNaN(n)) return false;
      return cmp[1] === '>=' ? n >= v : cmp[1] === '<=' ? n <= v : cmp[1] === '>' ? n > v : n < v;
    }
    if (want.includes('*')) {
      const re = new RegExp('^' + want.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$', 'i');
      return re.test(String(have));
    }
    return String(have).toLowerCase() === want.toLowerCase();
  }
  return have === want;
}

export function deviceMatches(t: Target, d: Device): boolean {
  if (d.kind !== t.kind) return false;
  for (const [key, want] of Object.entries(t.match ?? {})) if (!matchValue(want, d[key])) return false;
  for (const port of t.ports ?? []) if (!d.ports?.[port]) return false;
  return true;
}

export interface Placement {
  rank: number;
  role: 'head' | 'worker';
  host: Host;
  devices: Device[];
}

export interface Topology { nodes: number; devices_per_node: number }

export function topologyFor(r: Recipe, variant?: string): Topology {
  const base = r.hardware.topology;
  if (!variant) return { nodes: base.nodes, devices_per_node: base.devices_per_node };
  const v = base.variants?.[variant];
  if (!v) return { nodes: base.nodes, devices_per_node: base.devices_per_node };
  return { nodes: v.nodes ?? base.nodes, devices_per_node: v.devices_per_node ?? base.devices_per_node };
}

/**
 * Choose hosts and devices for a recipe. Each node is one host with enough
 * matching devices; for MCUs every board counts as its own node (a host may
 * provide several). `prefer` (--on) limits the pool to host names or device labels.
 */
export function resolvePlacement(r: Recipe, inv: Inventory, opts: { variant?: string; prefer?: string[] } = {}): Placement[] {
  const topo = topologyFor(r, opts.variant);
  const mcu = r.hardware.targets[0].kind === 'mcu';
  const prefer = new Set(opts.prefer ?? []);
  const out: Placement[] = [];
  for (const host of inv.hosts) {
    let matching = host.devices.filter((d) => r.hardware.targets.some((t) => deviceMatches(t, d)));
    if (prefer.size) {
      // --on narrows the pool: a host name selects the host, a label selects a device.
      const labelled = matching.filter((d) => d.label && prefer.has(d.label));
      matching = labelled.length ? labelled : prefer.has(host.name) ? matching : [];
    }
    if (mcu) {
      for (const d of matching) {
        if (out.length === topo.nodes) break;
        out.push({ rank: out.length, role: out.length === 0 ? 'head' : 'worker', host, devices: [d] });
      }
    } else if (matching.length >= topo.devices_per_node) {
      out.push({ rank: out.length, role: out.length === 0 ? 'head' : 'worker', host, devices: matching.slice(0, topo.devices_per_node) });
    }
    if (out.length === topo.nodes) return out;
  }
  const want = mcu ? `${topo.nodes} board(s)` : `${topo.nodes} host(s) with ${topo.devices_per_node} matching device(s) each`;
  const desc = r.hardware.targets.map((t) => `${t.kind} ${JSON.stringify(t.match ?? {})}${t.ports ? ` ports ${t.ports.join('+')}` : ''}`).join(' or ');
  throw new Error(`inventory cannot satisfy ${r.id}: needs ${want} matching ${desc}; found ${out.length}`);
}
