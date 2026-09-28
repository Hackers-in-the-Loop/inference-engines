import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkoutScript, driftReport, readLock, sha256File, sourceSpec, verifyLock } from '../src/source.ts';
import { git, isolate, makeUpstream } from './helpers.ts';

test('unpinned sources are refused unless overridden', () => {
  assert.throws(() => sourceSpec({ repo: 'r', commit: 'TODO' }, {}), /not a pinned commit/);
  assert.deepEqual(sourceSpec({ repo: 'r', commit: 'TODO' }, { source: '/x', commit: 'main' }), { repo: '/x', commit: 'main', override: true });
  const sha = 'a'.repeat(40);
  assert.deepEqual(sourceSpec({ repo: 'r', commit: sha }, {}), { repo: 'r', commit: sha, override: false });
  assert.deepEqual(sourceSpec({ repo: 'r', commit: sha }, { source: '/mirror' }), { repo: '/mirror', commit: sha, override: false, mirror: 'r' });
  assert.equal(sourceSpec({ repo: 'r', commit: sha }, { source: '/m', commit: 'b'.repeat(40) }).override, true);
});

test('checkout, lock verification and drift', () => {
  const root = isolate();
  const up = makeUpstream(root);
  const clone = join(root, 'clone');
  const head = execFileSync('bash', ['-c', checkoutScript({ repo: up.repo, commit: up.commit, override: false }, clone)], { encoding: 'utf8' }).trim();
  assert.equal(head, up.commit);

  const lock = join(root, 'upstream.lock');
  writeFileSync(lock, `# adapter depends on these\n${sha256File(join(clone, 'start.sh'))}  start.sh\n${sha256File(join(clone, 'Makefile'))}  Makefile\n`);
  assert.deepEqual(verifyLock(lock, clone), []);

  writeFileSync(join(clone, 'start.sh'), 'tampered\n');
  const bad = verifyLock(lock, clone);
  assert.equal(bad.length, 1);
  assert.equal(bad[0].path, 'start.sh');
  git(clone, 'checkout', '--', 'start.sh');

  // Upstream moves on: one locked file changes, another is removed.
  writeFileSync(join(up.repo, 'start.sh'), '#!/bin/sh\necho v2\n');
  git(up.repo, 'rm', '-q', 'Makefile');
  git(up.repo, 'commit', '-qam', 'v2');
  const rep = driftReport(clone, up.commit, readLock(lock));
  assert.equal(rep.commitsBehind, 1);
  assert.deepEqual(rep.changed, [{ path: 'start.sh', state: 'changed' }, { path: 'Makefile', state: 'removed' }]);

  // Re-running checkout at the pin is idempotent even after upstream moved.
  const again = execFileSync('bash', ['-c', checkoutScript({ repo: up.repo, commit: up.commit, override: false }, clone)], { encoding: 'utf8' }).trim();
  assert.equal(again, up.commit);
});
