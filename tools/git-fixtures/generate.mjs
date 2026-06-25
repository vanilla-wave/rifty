#!/usr/bin/env node
/**
 * MANUAL oracle generator — run by hand to (re)freeze fixtures; NOT run in tests.
 * Requires real git (frozen at 2.50.1 on this host).
 *
 * Per ADR-0093 (parity gold standard): `git status --porcelain` / `git log
 * --oneline` have NO Node analog, so the oracle is a FROZEN GOLDEN FIXTURE —
 * captured ONCE here from real git, committed with a provenance header, and
 * byte-asserted by packages/shell/tests/git-fixtures.test.ts. A live `git` spawn
 * at TEST time is FORBIDDEN; regeneration is this deliberate, reviewed act.
 *
 * Determinism: fixed identity + dates + `LC_ALL=C` + default branch `main`, so
 * the captured bytes (and the canonical SHAs our impl reproduces) are stable.
 *
 * Invocation:
 *   node tools/git-fixtures/generate.mjs
 *
 * Writes packages/git/fixtures/*; prints each path + byte count.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = resolve(HERE, '../../packages/git/fixtures');

/** Frozen identity + dates → reproducible oids + author/committer bytes. */
const GIT_ENV = {
  ...process.env,
  LC_ALL: 'C',
  GIT_AUTHOR_NAME: 'Test',
  GIT_AUTHOR_EMAIL: 't@example.com',
  GIT_AUTHOR_DATE: '1600000000 +0000',
  GIT_COMMITTER_NAME: 'Test',
  GIT_COMMITTER_EMAIL: 't@example.com',
  GIT_COMMITTER_DATE: '1600000000 +0000',
  // Strip any ambient config that could perturb output (templates, hooks, etc.).
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_SYSTEM: '/dev/null',
};

/** Run git in `cwd`, return trimmed-of-nothing stdout (we want exact bytes). */
function git(cwd, args) {
  return execFileSync('git', args, { cwd, env: GIT_ENV, encoding: 'utf8' });
}

/**
 * Capture stdout AND stderr SEPARATELY of a git invocation (checkout's "Switched
 * to…"/advisory/error text goes to stderr; only restore is silent). spawnSync so
 * a nonzero exit (the dirty-conflict refusal) does not throw — we want its bytes.
 */
function captureBoth(cwd, args) {
  const r = spawnSync('git', args, { cwd, env: GIT_ENV, encoding: 'utf8' });
  return { stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

/** Real git version string, e.g. "git version 2.50.1 ...". */
function gitVersion() {
  const out = execFileSync('git', ['--version'], { env: GIT_ENV, encoding: 'utf8' });
  const m = out.match(/git version (\d+\.\d+\.\d+)/);
  if (!m) throw new Error(`cannot parse git version from: ${out}`);
  return m[1];
}

/** Provenance header line + captured body → fixture file bytes. */
function provenance(version, command, tree) {
  return `# git ${version} | LC_ALL=C | ${command} | tree: ${tree}\n`;
}

function writeFixture(name, header, body) {
  const path = join(FIXTURES_DIR, name);
  const bytes = header + body;
  writeFileSync(path, bytes);
  console.log(`wrote ${path} (${Buffer.byteLength(bytes)} bytes)`);
}

/** Fresh repo in a tmpdir with `main` as the default branch. */
function freshRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'rifty-git-fix-'));
  git(dir, ['init', '-q', '-b', 'main']);
  return dir;
}

/**
 * Repo with `main` (a.txt='one') + branch `other` (a.txt='two'), checked out on
 * `main`. Two diverging branches so a dirty switch genuinely conflicts and a
 * detached checkout of `other`'s HEAD has a real subject. Returns the `other`
 * HEAD sha (deterministic — fixed identity/dates → canonical oid).
 */
function twoBranchRepo() {
  const dir = freshRepo();
  writeFileSync(join(dir, 'a.txt'), 'one\n');
  git(dir, ['add', 'a.txt']);
  git(dir, ['commit', '-q', '-m', 'first']);
  git(dir, ['checkout', '-q', '-b', 'other']);
  writeFileSync(join(dir, 'a.txt'), 'two\n');
  git(dir, ['add', 'a.txt']);
  git(dir, ['commit', '-q', '-m', 'second']);
  const headOther = git(dir, ['rev-parse', 'HEAD']).trim();
  git(dir, ['checkout', '-q', 'main']);
  return { dir, headOther };
}

/** Write a checkout stdout+stderr pair (`<name>.out`/`.err`) with provenance. */
function writeCheckout(version, name, command, desc, dir, args) {
  const { stdout, stderr } = captureBoth(dir, args);
  writeFixture(`${name}.out`, provenance(version, command, `${desc} (stdout)`), stdout);
  writeFixture(`${name}.err`, provenance(version, command, `${desc} (stderr)`), stderr);
}

function main() {
  const version = gitVersion();
  if (version !== '2.50.1') {
    // Honest loud throw: the provenance header pins 2.50.1; a different binary
    // would silently mislabel the bytes. Refreeze deliberately if upgrading.
    throw new Error(
      `expected git 2.50.1 (pinned oracle), found ${version}. Update the provenance pin in this script + the fixture headers if intentional.`,
    );
  }
  mkdirSync(FIXTURES_DIR, { recursive: true });

  const tmps = [];
  try {
    // --- status-untracked: 2 untracked files ---
    {
      const dir = freshRepo();
      tmps.push(dir);
      writeFileSync(join(dir, 'a.txt'), 'alpha\n');
      writeFileSync(join(dir, 'b.txt'), 'beta\n');
      const body = git(dir, ['status', '--porcelain']);
      writeFixture(
        'status-untracked.porcelain',
        provenance(version, 'git status --porcelain', '2 untracked files (a.txt,b.txt)'),
        body,
      );
    }

    // --- status-staged: same two, after `git add` ---
    {
      const dir = freshRepo();
      tmps.push(dir);
      writeFileSync(join(dir, 'a.txt'), 'alpha\n');
      writeFileSync(join(dir, 'b.txt'), 'beta\n');
      git(dir, ['add', 'a.txt', 'b.txt']);
      const body = git(dir, ['status', '--porcelain']);
      writeFixture(
        'status-staged.porcelain',
        provenance(version, 'git status --porcelain', '2 staged-new files (a.txt,b.txt)'),
        body,
      );
    }

    // --- status-mixed: committed+modified, staged-new, untracked, deleted ---
    {
      const dir = freshRepo();
      tmps.push(dir);
      // Commit two files (one we'll modify, one we'll delete).
      writeFileSync(join(dir, 'tracked.txt'), 'v1\n');
      writeFileSync(join(dir, 'doomed.txt'), 'bye\n');
      git(dir, ['add', 'tracked.txt', 'doomed.txt']);
      git(dir, ['commit', '-q', '-m', 'base']);
      // Modify the tracked file (unstaged worktree change → ` M`).
      writeFileSync(join(dir, 'tracked.txt'), 'v2\n');
      // Stage a brand-new file (→ `A `).
      writeFileSync(join(dir, 'staged-new.txt'), 'fresh\n');
      git(dir, ['add', 'staged-new.txt']);
      // Leave an untracked file (→ `??`).
      writeFileSync(join(dir, 'untracked.txt'), 'loose\n');
      // Delete a committed file in the worktree (unstaged → ` D`).
      rmSync(join(dir, 'doomed.txt'));
      const body = git(dir, ['status', '--porcelain']);
      writeFixture(
        'status-mixed.porcelain',
        provenance(
          version,
          'git status --porcelain',
          'committed+modified(tracked.txt), staged-new(staged-new.txt), untracked(untracked.txt), deleted(doomed.txt)',
        ),
        body,
      );
    }

    // --- log-oneline: 2 commits ---
    {
      const dir = freshRepo();
      tmps.push(dir);
      writeFileSync(join(dir, 'a.txt'), 'alpha\n');
      git(dir, ['add', 'a.txt']);
      git(dir, ['commit', '-q', '-m', 'first']);
      writeFileSync(join(dir, 'b.txt'), 'beta\n');
      git(dir, ['add', 'b.txt']);
      git(dir, ['commit', '-q', '-m', 'second']);
      const body = git(dir, ['log', '--oneline']);
      writeFixture(
        'log-oneline.txt',
        provenance(version, 'git log --oneline', '2 commits (first, second)'),
        body,
      );
    }

    // --- checkout: stdout+stderr captured separately (each on a fresh repo) ---
    {
      const { dir } = twoBranchRepo();
      tmps.push(dir);
      writeCheckout(
        version,
        'checkout-switch',
        'git checkout other',
        'switch to existing branch',
        dir,
        ['checkout', 'other'],
      );
    }
    {
      const { dir } = twoBranchRepo();
      tmps.push(dir);
      writeCheckout(version, 'checkout-create', 'git checkout -b feature', 'create + switch', dir, [
        'checkout',
        '-b',
        'feature',
      ]);
    }
    {
      const { dir } = twoBranchRepo();
      tmps.push(dir);
      writeCheckout(version, 'checkout-already', 'git checkout main', 'already on branch', dir, [
        'checkout',
        'main',
      ]);
    }
    {
      const { dir } = twoBranchRepo();
      tmps.push(dir);
      writeFileSync(join(dir, 'a.txt'), 'dirty\n'); // differs from `other` → conflict
      writeCheckout(
        version,
        'checkout-conflict',
        'git checkout other',
        'dirty-tree conflict refusal',
        dir,
        ['checkout', 'other'],
      );
    }
    {
      const { dir, headOther } = twoBranchRepo();
      tmps.push(dir);
      writeCheckout(
        version,
        'checkout-detached',
        `git checkout ${headOther}`,
        'detached HEAD',
        dir,
        ['checkout', headOther],
      );
    }
    {
      const { dir } = twoBranchRepo();
      tmps.push(dir);
      writeFileSync(join(dir, 'a.txt'), 'dirty\n'); // restore reverts to index (== HEAD here)
      writeCheckout(
        version,
        'checkout-restore',
        'git checkout -- a.txt',
        'restore from index',
        dir,
        ['checkout', '--', 'a.txt'],
      );
    }

    // --- switch / restore (modern porcelain — same engine as checkout) ---
    {
      const { dir } = twoBranchRepo();
      tmps.push(dir);
      writeCheckout(version, 'switch-existing', 'git switch other', 'switch existing branch', dir, [
        'switch',
        'other',
      ]);
    }
    {
      const { dir } = twoBranchRepo();
      tmps.push(dir);
      writeCheckout(version, 'switch-create', 'git switch -c feat', 'create + switch', dir, [
        'switch',
        '-c',
        'feat',
      ]);
    }
    {
      const { dir } = twoBranchRepo();
      tmps.push(dir);
      writeCheckout(version, 'switch-already', 'git switch main', 'already on branch', dir, [
        'switch',
        'main',
      ]);
    }
    {
      const { dir, headOther } = twoBranchRepo();
      tmps.push(dir);
      writeCheckout(
        version,
        'switch-detached',
        `git switch --detach ${headOther}`,
        'detached HEAD',
        dir,
        ['switch', '--detach', headOther],
      );
    }
    {
      const { dir } = twoBranchRepo();
      tmps.push(dir);
      writeFileSync(join(dir, 'a.txt'), 'dirty\n'); // restore worktree from index
      writeCheckout(version, 'restore-worktree', 'git restore a.txt', 'restore worktree', dir, [
        'restore',
        'a.txt',
      ]);
    }
    {
      const { dir } = twoBranchRepo();
      tmps.push(dir);
      writeFileSync(join(dir, 'c.txt'), 'staged\n');
      git(dir, ['add', 'c.txt']); // staged → restore --staged unstages
      writeCheckout(
        version,
        'restore-staged',
        'git restore --staged c.txt',
        'unstage via restore --staged',
        dir,
        ['restore', '--staged', 'c.txt'],
      );
    }
  } finally {
    for (const dir of tmps) rmSync(dir, { recursive: true, force: true });
  }
}

main();
