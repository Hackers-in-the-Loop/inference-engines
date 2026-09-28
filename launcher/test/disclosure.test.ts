import { test } from 'node:test';
import assert from 'node:assert/strict';
import { confirmPlan, isAcknowledged, renderPlan } from '../src/disclosure.ts';
import type { Component, Recipe } from '../src/manifest.ts';
import { baseRecipe, isolate } from './helpers.ts';

const nc: Component = { kind: 'drafter', name: 'drafter-x', license: 'CC-BY-NC-ND-4.0', terms: { commercial: false, summary: 'research and evaluation only' }, acknowledge: 'required' };

test('the plan warns about host execution, device writes and restricted licenses', () => {
  const r = baseRecipe({ runtime: { isolation: 'host', privileges: ['serial-device-access'], device_writes: ['flash-erase-and-write'], network: { listen: '127.0.0.1:$IE_HTTP_PORT', auth: false } } }) as unknown as Recipe;
  const placements = [{ rank: 0, role: 'head' as const, host: { name: 'h', address: 'local', devices: [] }, devices: [{ kind: 'mcu', label: 'board1', ports: { flash: '/dev/f' } }] }];
  const plan = renderPlan({ recipe: r, placements, params: { layers: 8 }, components: [nc], httpPort: 8081, source: { repo: 'u', commit: 'a'.repeat(40), override: false }, steps: ['setup', 'serve'] });
  assert.match(plan, /WARNING  runs on the host, not in a container/);
  assert.match(plan, /WRITES   FLASH-ERASE-AND-WRITE on board1 \(flash=\/dev\/f\)/);
  assert.match(plan, /listens on 127.0.0.1:8081, no auth/);
  assert.match(plan, /drafter-x .*ACKNOWLEDGMENT REQUIRED/);
});

test('--yes never covers license terms; --accept does, and is remembered until terms change', async () => {
  isolate();
  const r = baseRecipe() as unknown as Recipe;
  const stderr = process.stderr.write;
  process.stderr.write = () => true;
  try {
    await assert.rejects(confirmPlan('plan', r, [nc], { yes: true, accept: [], interactive: false }), /--accept drafter-x/);
    assert.equal(isAcknowledged(r.id, nc), false);
    const acks = await confirmPlan('plan', r, [nc], { yes: true, accept: ['drafter-x'], interactive: false });
    assert.equal(acks[0].component, 'drafter-x');
    assert.equal(isAcknowledged(r.id, nc), true);
    // Remembered: no --accept needed next time.
    await confirmPlan('plan', r, [nc], { yes: true, accept: [], interactive: false });
    // Changed terms invalidate the acknowledgment.
    const changed = { ...nc, revision: 'new' };
    assert.equal(isAcknowledged(r.id, changed), false);
    await assert.rejects(confirmPlan('plan', r, [changed], { yes: true, accept: [], interactive: false }), /acknowledgment required/);
    // Without --yes a non-interactive run stops before doing anything.
    await assert.rejects(confirmPlan('plan', r, [], { yes: false, accept: [], interactive: false }), /confirmation required/);
  } finally {
    process.stderr.write = stderr;
  }
});
