import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchValue, resolvePlacement, type Inventory } from '../src/inventory.ts';
import { expand, remoteCommand, stepEnv } from '../src/nodes.ts';
import { nvidiaDevices } from '../src/probe.ts';
import type { Recipe } from '../src/manifest.ts';
import { baseRecipe } from './helpers.ts';

test('match predicates', () => {
  assert.ok(matchValue('>=16', 16));
  assert.ok(!matchValue('>=16', 8));
  assert.ok(matchValue('<9', '8'));
  assert.ok(matchValue('580.*', '580.95.05'));
  assert.ok(!matchValue('580.*', '575.1'));
  assert.ok(matchValue('*GB10*', 'NVIDIA GB10'));
  assert.ok(matchValue('esp32-s3', 'ESP32-S3'));
  assert.ok(!matchValue('>=16', undefined));
});

const inv: Inventory = {
  hosts: [
    { name: 'bench', address: 'local', devices: [
      { kind: 'mcu', label: 'board1', chip: 'fake', ports: { serial: '/dev/a' } },
      { kind: 'mcu', label: 'board2', chip: 'fake', ports: { serial: '/dev/b' } },
      { kind: 'mcu', label: 'noserial', chip: 'fake', ports: { flash: '/dev/c' } },
    ] },
    { name: 'spark-a', address: 'me@a', attrs: { ADDR: '10.0.0.1', IFACE: 'enp1' }, devices: [{ kind: 'gpu', index: 0, model: 'GB10', label: 'a0' }] },
    { name: 'spark-b', address: 'me@b', attrs: { ADDR: '10.0.0.2', IFACE: 'enp2' }, devices: [{ kind: 'gpu', index: 0, model: 'GB10', label: 'b0' }] },
    { name: 'dual', address: 'local', devices: [{ kind: 'gpu', index: 0, model: 'P100', vram_gb: 16 }, { kind: 'gpu', index: 1, model: 'P100', vram_gb: 16 }] },
  ],
};

const recipe = (over: Record<string, unknown>) => baseRecipe(over) as unknown as Recipe;

test('MCU recipes take one board per node and require the declared ports', () => {
  const r = recipe({});
  const p = resolvePlacement(r, inv);
  assert.equal(p.length, 1);
  assert.equal(p[0].devices[0].label, 'board1');
  assert.equal(resolvePlacement(r, inv, { prefer: ['board2'] })[0].devices[0].label, 'board2');
  assert.throws(() => resolvePlacement(r, inv, { prefer: ['noserial'] }), /cannot satisfy/);
});

test('two GPUs on one host', () => {
  const r = recipe({ hardware: { targets: [{ kind: 'gpu', match: { model: 'P100', vram_gb: '>=16' } }], topology: { nodes: 1, devices_per_node: 2 } } });
  const [p] = resolvePlacement(r, inv);
  assert.equal(p.host.name, 'dual');
  const env = stepEnv({ recipe: r, recipeDir: '/r', placements: [p], me: p, params: {}, httpPort: 8000 });
  assert.equal(env.IE_DEVICES, '0,1');
  assert.equal(env.CUDA_VISIBLE_DEVICES, '0,1');
});

test('two Sparks: ranks, addresses, inventory attrs and env_map', () => {
  const r = recipe({
    hardware: { targets: [{ kind: 'gpu', match: { model: '*GB10*' } }], topology: { nodes: 2, devices_per_node: 1 } },
    roles: { head: ['serve'], worker: ['serve'] },
    env_map: { HEAD_IP: '${IE_NODE_0_ADDR}', WORKER_IP: '${IE_NODE_1_ADDR}', IFACE: '${IE_INV_IFACE}' },
  });
  const p = resolvePlacement(r, inv);
  assert.deepEqual(p.map((x) => [x.host.name, x.rank, x.role]), [['spark-a', 0, 'head'], ['spark-b', 1, 'worker']]);
  const env = stepEnv({ recipe: r, recipeDir: '/r', placements: p, me: p[1], params: { layers: 8 }, httpPort: 8888 });
  assert.equal(env.HEAD_IP, '10.0.0.1');
  assert.equal(env.WORKER_IP, '10.0.0.2');
  assert.equal(env.IFACE, 'enp2');
  assert.equal(env.IE_NODE_RANK, '1');
  assert.equal(env.IE_PARAM_LAYERS, '8');
  assert.match(env.IE_SRC_DIR, /fake__cpu__test\/src$/);
});

test('env_map rejects unknown variables', () => {
  assert.throws(() => expand('${NOPE}', {}), /NOPE/);
  assert.equal(expand('x${A}y', { A: '1' }), 'x1y');
});

test('remote commands quote env and command safely', () => {
  const cmd = remoteCommand('/w/src', "echo 'hi' && ./start.sh", { A: 'a b', B: "it's" });
  assert.equal(cmd, `mkdir -p /w/src && cd /w/src && env A='a b' B='it'\\''s' bash -c 'echo '\\''hi'\\'' && ./start.sh'`);
});

test('nvidia-smi output becomes inventory devices', () => {
  const d = nvidiaDevices('0, NVIDIA GB10, 122880, 580.95.05\n');
  assert.deepEqual(d[0], { kind: 'gpu', vendor: 'nvidia', index: 0, model: 'GB10', vram_gb: 120, driver: '580.95.05', label: 'gpu0' });
});
