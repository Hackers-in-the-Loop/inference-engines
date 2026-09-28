// Recipe manifests: discovery, schema validation and semantic rules.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import Ajv2020 from 'ajv/dist/2020.js';

export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCHEMA_PATH = join(REPO_ROOT, 'schema', 'recipe.schema.json');
const STEP_ORDER = ['setup', 'fetch', 'build', 'deploy', 'serve', 'health', 'stop'] as const;
export type StepName = (typeof STEP_ORDER)[number];
export { STEP_ORDER };

export type Scalar = string | number | boolean;
export interface Component {
  kind: string; name: string; license: string | string[];
  repo?: string; commit?: string; revision?: string; digest?: string; sha256?: string;
  terms?: { gated?: boolean; commercial?: boolean | string; share_alike?: boolean; acceptance_url?: string; summary?: string };
  acknowledge?: 'required' | 'none';
  profiles?: string[];
}
export interface Target { kind: string; match?: Record<string, Scalar>; ports?: string[] }
export interface Recipe {
  schema: 1; id: string; aliases?: string[]; title: string;
  status: 'unverified' | 'experimental' | 'verified' | 'deprecated';
  purpose: string[];
  attribution: {
    authors: { name: string; url?: string; role: string }[];
    cite?: Record<string, unknown>[];
    source: { repo: string; commit: string; license: string | string[]; relationship: string; integration: 'native' | 'adapter' };
    components?: Component[];
    notes?: string;
  };
  runtime: {
    isolation: 'container' | 'vm' | 'host';
    container?: { engine?: string; image?: string; digest?: string };
    privileges: string[]; device_writes?: string[];
    network: { listen: string; auth?: boolean | string };
    downloads?: { what: string; approx_bytes?: number }[];
    host_changes?: string[];
    steps?: Record<string, { isolation?: string; note?: string }>;
  };
  hardware: { targets: Target[]; topology: { nodes: number; devices_per_node: number; variants?: Record<string, { nodes?: number; devices_per_node?: number }> } };
  roles?: { head?: StepName[]; worker?: StepName[] };
  params?: Record<string, { default: Scalar; allowed?: Scalar[]; description?: string }>;
  profiles?: Record<string, Record<string, Scalar>>;
  toolchain?: { name: string; version?: string; check?: string }[];
  env_map?: Record<string, string>;
  steps: Partial<Record<StepName, string>>;
  endpoint: { protocol: 'openai' | 'custom'; port?: number; base_path?: string; extra_routes?: string[]; limits?: string; model?: string };
  telemetry?: { metrics?: { format: 'prometheus'; path: string }; otlp?: boolean; log_parser?: string };
  benchmarks?: { suites?: string[]; workloads?: string; fidelity?: string; engine_metrics?: Record<string, string> };
  evidence?: string[];
}
export interface LoadedRecipe { recipe: Recipe; file: string; dir: string }
export interface Problem { file: string; message: string }

let validator: ReturnType<Ajv2020['compile']> | undefined;
function schemaValidator() {
  if (!validator) {
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    validator = ajv.compile(JSON.parse(readFileSync(SCHEMA_PATH, 'utf8')));
  }
  return validator;
}

/** Find every recipe.yaml under hardware/. */
export function findManifests(root = REPO_ROOT): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules' || name.startsWith('.')) continue;
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (name === 'recipe.yaml') out.push(path);
    }
  };
  walk(join(root, 'hardware'));
  return out.sort();
}

export function parseManifest(file: string): { recipe?: Recipe; problems: Problem[] } {
  let data: unknown;
  try {
    data = YAML.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    return { problems: [{ file, message: `YAML: ${(err as Error).message}` }] };
  }
  const validate = schemaValidator();
  if (!validate(data)) {
    return {
      problems: (validate.errors ?? []).map((e) => ({ file, message: `schema: ${e.instancePath || '/'} ${e.message}` })),
    };
  }
  const recipe = data as Recipe;
  return { recipe, problems: semanticProblems(recipe, file) };
}

const HEX40 = /^[0-9a-f]{40}$/;

/** Rules JSON Schema can't express well. */
export function semanticProblems(r: Recipe, file: string): Problem[] {
  const p: string[] = [];
  for (const [name, spec] of Object.entries(r.params ?? {})) {
    if (spec.allowed && !spec.allowed.includes(spec.default)) p.push(`params.${name}: default ${spec.default} is not in allowed`);
  }
  for (const [profile, values] of Object.entries(r.profiles ?? {})) {
    for (const [name, value] of Object.entries(values)) {
      const spec = r.params?.[name];
      if (!spec) p.push(`profiles.${profile}.${name}: no such param`);
      else if (spec.allowed && !spec.allowed.includes(value)) p.push(`profiles.${profile}.${name}: ${value} is not allowed`);
    }
  }
  for (const c of r.attribution.components ?? []) {
    for (const prof of c.profiles ?? []) if (!r.profiles?.[prof]) p.push(`component ${c.name}: unknown profile ${prof}`);
  }
  if (r.hardware.topology.nodes > 1 && !r.roles) p.push('multi-node recipes must declare roles');
  if (r.attribution.source.integration === 'adapter' && r.attribution.source.relationship === 'reference') {
    p.push('a reference recipe is not run, so it cannot have an adapter');
  }
  if (r.status === 'verified') {
    if (!HEX40.test(r.attribution.source.commit)) p.push('verified recipes need a 40-hex source.commit');
    for (const c of r.attribution.components ?? []) {
      if (c.kind === 'weights' && !c.revision) p.push(`verified: weights ${c.name} needs a revision`);
      if (c.kind === 'image' && !c.digest) p.push(`verified: image ${c.name} needs a digest`);
      if (JSON.stringify(c).includes('TODO')) p.push(`verified: component ${c.name} still has TODO values`);
    }
    if (r.runtime.isolation === 'container' && !r.runtime.container?.digest) p.push('verified container recipes need runtime.container.digest');
    if (!r.evidence?.length) p.push('verified recipes need committed evidence');
    if (JSON.stringify(r.runtime).includes('TODO')) p.push('verified: runtime still has TODO values');
  }
  return p.map((message) => ({ file, message }));
}

/** Load all recipes; problems include duplicate ids and aliases. */
export function loadCatalog(root = REPO_ROOT): { recipes: LoadedRecipe[]; problems: Problem[] } {
  const recipes: LoadedRecipe[] = [];
  const problems: Problem[] = [];
  const names = new Map<string, string>();
  for (const file of findManifests(root)) {
    const { recipe, problems: found } = parseManifest(file);
    problems.push(...found);
    if (!recipe) continue;
    for (const name of [recipe.id, ...(recipe.aliases ?? [])]) {
      const other = names.get(name);
      if (other) problems.push({ file, message: `name "${name}" is already used by ${relative(root, other)}` });
      else names.set(name, file);
    }
    recipes.push({ recipe, file, dir: dirname(file) });
  }
  return { recipes, problems };
}

export function findRecipe(nameOrAlias: string, root = REPO_ROOT): LoadedRecipe {
  const { recipes } = loadCatalog(root);
  const hit = recipes.find((l) => l.recipe.id === nameOrAlias || l.recipe.aliases?.includes(nameOrAlias));
  if (!hit) throw new Error(`no recipe named "${nameOrAlias}"; try \`list\``);
  const { problems } = parseManifest(hit.file);
  if (problems.length) throw new Error(`${hit.recipe.id} is invalid:\n` + problems.map((x) => `  ${x.message}`).join('\n'));
  return hit;
}

/** Resolve params from defaults, a profile, then explicit overrides. */
export function resolveParams(r: Recipe, profile?: string, overrides: Record<string, string> = {}): Record<string, Scalar> {
  const out: Record<string, Scalar> = {};
  for (const [name, spec] of Object.entries(r.params ?? {})) out[name] = spec.default;
  if (profile) {
    const values = r.profiles?.[profile];
    if (!values) throw new Error(`unknown profile "${profile}"; available: ${Object.keys(r.profiles ?? {}).join(', ') || 'none'}`);
    Object.assign(out, values);
  }
  for (const [name, raw] of Object.entries(overrides)) {
    const spec = r.params?.[name];
    if (!spec) throw new Error(`unknown param "${name}"`);
    const value: Scalar = typeof spec.default === 'number' ? Number(raw) : typeof spec.default === 'boolean' ? raw === 'true' : raw;
    if (typeof value === 'number' && Number.isNaN(value)) throw new Error(`param ${name} must be a number`);
    out[name] = value;
  }
  for (const [name, value] of Object.entries(out)) {
    const allowed = r.params?.[name]?.allowed;
    if (allowed && !allowed.includes(value)) throw new Error(`param ${name}=${value} is not allowed (${allowed.join(', ')})`);
  }
  return out;
}

/** Components active for a profile. */
export function activeComponents(r: Recipe, profile?: string): Component[] {
  return (r.attribution.components ?? []).filter((c) => !c.profiles || (profile !== undefined && c.profiles.includes(profile)));
}

export function restricted(c: Component): boolean {
  return c.acknowledge === 'required';
}
