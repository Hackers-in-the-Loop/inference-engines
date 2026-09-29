// Pinned source checkouts, upstream.lock verification and drift reports.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const HEX40 = /^[0-9a-f]{40}$/;

export interface SourceSpec { repo: string; commit: string; override: boolean; mirror?: string }

/**
 * The source to check out. `--source` alone is a mirror of the pinned commit (same
 * content, so still evidence); `--commit` that differs from the pin is an override.
 */
export function sourceSpec(pin: { repo: string; commit: string }, over: { source?: string; commit?: string }): SourceSpec {
  const commit = over.commit ?? pin.commit;
  const override = over.commit !== undefined && over.commit !== pin.commit;
  if (!HEX40.test(commit) && !override) {
    throw new Error(`source.commit is "${commit}", not a pinned commit. Pin it in recipe.yaml, or pass --source <path|url> --commit <sha> for development.`);
  }
  if (over.source && !override) return { repo: over.source, commit, override: false, mirror: pin.repo };
  return { repo: over.source ?? pin.repo, commit, override };
}

export function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

/** Shell commands that make `dir` a checkout of spec at its commit (run locally or over SSH). */
export function checkoutScript(spec: SourceSpec, dir: string): string {
  const q = shellQuote;
  // A commit ref may be a branch/tag name only for development overrides.
  return [
    'set -e',
    `if [ ! -d ${q(dir)}/.git ]; then mkdir -p "$(dirname ${q(dir)})"; git clone --quiet ${q(spec.repo)} ${q(dir)}; fi`,
    `cd ${q(dir)}`,
    `git remote set-url origin ${q(spec.repo)}`,
    `git cat-file -e ${q(spec.commit)}^{commit} 2>/dev/null || git fetch --quiet --tags origin`,
    `git -c advice.detachedHead=false checkout --quiet ${q(spec.commit)}`,
    'git rev-parse HEAD',
  ].join('\n');
}

export function shellQuote(s: string): string {
  return /^[A-Za-z0-9_./:=@%+,-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`;
}

export function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

export interface LockEntry { sha256: string; path: string }

/** upstream.lock uses sha256sum format: "<hex>  <path>" per line; # comments allowed. */
export function readLock(lockFile: string): LockEntry[] {
  return readFileSync(lockFile, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => {
      const m = /^([0-9a-f]{64})\s+\*?(.+)$/.exec(l);
      if (!m) throw new Error(`${lockFile}: bad line "${l}"`);
      return { sha256: m[1], path: m[2] };
    });
}

export interface LockMismatch { path: string; expected: string; actual: string | 'missing' }

export function verifyLock(lockFile: string, srcDir: string): LockMismatch[] {
  const bad: LockMismatch[] = [];
  for (const e of readLock(lockFile)) {
    const file = join(srcDir, e.path);
    const actual = existsSync(file) ? sha256File(file) : 'missing';
    if (actual !== e.sha256) bad.push({ path: e.path, expected: e.sha256, actual });
  }
  return bad;
}

export interface DriftReport {
  pinned: string; latest: string; branch: string; commitsBehind: number;
  changed: { path: string; state: 'changed' | 'removed' }[];
}

/** Compare the pinned files with the upstream default branch. `srcDir` must be a clone. */
export function driftReport(srcDir: string, pinned: string, lock: LockEntry[]): DriftReport {
  git(srcDir, 'fetch', '--quiet', 'origin');
  let branch: string;
  try {
    branch = git(srcDir, 'symbolic-ref', '--short', 'refs/remotes/origin/HEAD');
  } catch {
    git(srcDir, 'remote', 'set-head', 'origin', '--auto');
    branch = git(srcDir, 'symbolic-ref', '--short', 'refs/remotes/origin/HEAD');
  }
  const latest = git(srcDir, 'rev-parse', branch);
  const commitsBehind = Number(git(srcDir, 'rev-list', '--count', `${pinned}..${latest}`));
  const changed: DriftReport['changed'] = [];
  for (const e of lock) {
    let blob: Buffer;
    try {
      blob = execFileSync('git', ['show', `${latest}:${e.path}`], { cwd: srcDir, stdio: ['ignore', 'pipe', 'ignore'] });
    } catch {
      changed.push({ path: e.path, state: 'removed' });
      continue;
    }
    if (createHash('sha256').update(blob).digest('hex') !== e.sha256) changed.push({ path: e.path, state: 'changed' });
  }
  return { pinned, latest, branch, commitsBehind, changed };
}
