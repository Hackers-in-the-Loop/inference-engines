import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { loadCatalog, parseManifest, REPO_ROOT, resolveParams, activeComponents, type Recipe } from '../src/manifest.ts';
import { baseRecipe, isolate, writeRecipe } from './helpers.ts';

const problems = (over: Record<string, unknown>) => {
  const root = isolate();
  const { problems } = parseManifest(writeRecipe(root, baseRecipe(over)));
  return problems.map((p) => p.message);
};

test('committed recipes validate', () => {
  const { recipes, problems } = loadCatalog(REPO_ROOT);
  assert.deepEqual(problems, []);
  assert.ok(recipes.length >= 1);
});

test('a minimal recipe is valid', () => {
  assert.deepEqual(problems({}), []);
});

test('gated, non-commercial or share-alike components must require acknowledgment', () => {
  const comp = (terms: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
    attribution: { ...(baseRecipe().attribution as object), components: [{ kind: 'drafter', name: 'd', license: 'CC-BY-NC-ND-4.0', terms, ...extra }] },
  });
  assert.ok(problems(comp({ commercial: false })).some((m) => m.includes('acknowledge')));
  assert.ok(problems(comp({ gated: true })).some((m) => m.includes('acknowledge')));
  assert.ok(problems(comp({ share_alike: true })).some((m) => m.includes('acknowledge')));
  assert.deepEqual(problems(comp({ commercial: false }, { acknowledge: 'required' })), []);
  assert.deepEqual(problems(comp({ commercial: true })), []);
});

test('verified recipes need pins and evidence', () => {
  const msgs = problems({ status: 'verified' });
  assert.ok(msgs.some((m) => m.includes('40-hex source.commit')));
  assert.ok(msgs.some((m) => m.includes('evidence')));
});

test('param defaults and profiles must respect allowed values', () => {
  assert.ok(problems({ params: { layers: { default: 3, allowed: [2, 4] } }, profiles: {} }).some((m) => m.includes('not in allowed')));
  assert.ok(problems({ profiles: { bad: { layers: 5 } } }).some((m) => m.includes('not allowed')));
  assert.ok(problems({ profiles: { bad: { depth: 5 } } }).some((m) => m.includes('no such param')));
});

test('multi-node recipes must declare roles', () => {
  const hw = { targets: [{ kind: 'gpu' }], topology: { nodes: 2, devices_per_node: 1 } };
  assert.ok(problems({ hardware: hw }).some((m) => m.includes('roles')));
  assert.deepEqual(problems({ hardware: hw, roles: { head: ['serve'], worker: ['serve'] } }), []);
});

test('duplicate ids and aliases are rejected', () => {
  const root = isolate();
  writeRecipe(root, baseRecipe({ aliases: ['same'] }));
  writeRecipe(root, baseRecipe({ id: 'fake/cpu/other', aliases: ['same'] }));
  const { problems } = loadCatalog(join(root, 'catalog'));
  assert.ok(problems.some((p) => p.message.includes('"same" is already used')));
});

test('params resolve from defaults, profiles and overrides', () => {
  const r = baseRecipe() as unknown as Recipe;
  assert.deepEqual(resolveParams(r), { layers: 8 });
  assert.deepEqual(resolveParams(r, 'fast'), { layers: 2 });
  assert.deepEqual(resolveParams(r, 'fast', { layers: '4' }), { layers: 4 });
  assert.throws(() => resolveParams(r, undefined, { layers: '5' }), /not allowed/);
  assert.throws(() => resolveParams(r, 'nope'), /unknown profile/);
});

test('profile-only components are active only for their profile', () => {
  const r = baseRecipe({
    profiles: { fast: { layers: 2 }, ablit: {} },
    attribution: { ...(baseRecipe().attribution as object), components: [
      { kind: 'weights', name: 'base', license: 'MIT' },
      { kind: 'weights', name: 'gated', license: 'other', profiles: ['ablit'], terms: { gated: true }, acknowledge: 'required' },
    ] },
  }) as unknown as Recipe;
  assert.deepEqual(activeComponents(r).map((c) => c.name), ['base']);
  assert.deepEqual(activeComponents(r, 'ablit').map((c) => c.name), ['base', 'gated']);
});
