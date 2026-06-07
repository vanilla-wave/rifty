/**
 * Single-segment glob expansion via the public `Shell` (ADR-0091 part 2). Each
 * case pins a specific failure mode: unquoted `*`/`?`/`[…]` expand sorted from
 * the cwd; a QUOTED glob stays literal (quote provenance is load-bearing); a
 * no-match glob stays literal (bash nullglob-off); dotfiles need an explicit
 * leading dot; a dir-prefixed glob expands within that dir. `echo` joins its
 * operands with single spaces, so a sorted-space-joined stdout is the contract.
 */

import { MemoryFsSync, resetSyncMirror, setSyncMirror } from '@riftydev/vfs/internal';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { Shell } from '../src/index.ts';

const enc = new TextEncoder();

/** Install a fresh in-memory mirror seeded with `files` before each test. */
function seed(files: Record<string, string>): void {
  const fs = new MemoryFsSync();
  for (const [path, content] of Object.entries(files)) {
    const dir = path.slice(0, path.lastIndexOf('/')) || '/';
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path, enc.encode(content));
  }
  setSyncMirror(fs);
}

beforeEach(() => resetSyncMirror());
afterEach(() => resetSyncMirror());

it('unquoted *.ts expands to matching names, sorted ascending', async () => {
  // Failure mode: not expanding the glob (echoing `*.ts` literally), or wrong order.
  seed({ '/b.ts': '', '/a.ts': '', '/c.js': '' });
  const sh = new Shell({ cwd: '/' });
  const { stdout } = await sh.run('echo *.ts');
  expect(stdout).toBe('a.ts b.ts\n');
});

it('quoted "*.ts" stays literal (quote provenance suppresses expansion)', async () => {
  // Failure mode: expanding a quoted glob (would break `grep "*.ts"`-style usage).
  seed({ '/a.ts': '', '/b.ts': '' });
  const sh = new Shell({ cwd: '/' });
  const { stdout } = await sh.run('echo "*.ts"');
  expect(stdout).toBe('*.ts\n');
});

it('a glob with zero matches stays literal (bash nullglob-off)', async () => {
  // Failure mode: emitting an empty arg (or nothing) when no file matches.
  seed({ '/a.ts': '' });
  const sh = new Shell({ cwd: '/' });
  const { stdout } = await sh.run('echo *.xyz');
  expect(stdout).toBe('*.xyz\n');
});

it('[ab]* char class expands only names starting a or b', async () => {
  // Failure mode: treating `[ab]` literally, or matching `c…`.
  seed({ '/apple': '', '/berry': '', '/cherry': '' });
  const sh = new Shell({ cwd: '/' });
  const { stdout } = await sh.run('echo [ab]*');
  expect(stdout).toBe('apple berry\n');
});

it('?.ts matches exactly one char before .ts', async () => {
  // Failure mode: `?` matching zero or >1 chars.
  seed({ '/a.ts': '', '/ab.ts': '', '/x.ts': '' });
  const sh = new Shell({ cwd: '/' });
  const { stdout } = await sh.run('echo ?.ts');
  expect(stdout).toBe('a.ts x.ts\n');
});

it('a dir-prefixed glob expands within that directory, prefix preserved', async () => {
  // Failure mode: losing the `sub/` prefix or globbing from the wrong dir.
  seed({ '/sub/a.ts': '', '/sub/b.ts': '', '/sub/c.js': '', '/top.ts': '' });
  const sh = new Shell({ cwd: '/' });
  const { stdout } = await sh.run('echo sub/*.ts');
  expect(stdout).toBe('sub/a.ts sub/b.ts\n');
});

it('an unquoted glob does NOT match dotfiles unless the pattern leads with a dot', async () => {
  // Failure mode: `*` matching `.hidden` (bash requires an explicit leading dot).
  seed({ '/.hidden.ts': '', '/visible.ts': '' });
  const sh = new Shell({ cwd: '/' });
  const { stdout } = await sh.run('echo *.ts');
  expect(stdout).toBe('visible.ts\n');
});
