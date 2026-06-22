/**
 * Regression guard: a same-size content overwrite MUST bump mtime, even within
 * one wall-clock tick. A stale-mtime overwrite makes the edit invisible to an
 * mtime-trusting stat cache (isomorphic-git's racy-clean index shortcut), which
 * silently reports `git status`/`diff` as unchanged — silent data loss (ADR-0167).
 * Deterministic (no reliance on the clock advancing): we force a far-future prior
 * mtime, so a naive `Date.now()` stamp would REGRESS and this test would fail.
 */
import { describe, expect, it } from 'vitest';
import { MemoryVfs } from './memory.ts';

describe('MemoryVfs write mtime monotonicity', () => {
  it('overwrite mtime strictly exceeds the prior mtime even when the wall clock has not advanced', async () => {
    const vfs = new MemoryVfs();
    await vfs.writeFile('/f', 'aaaa');
    const future = Date.now() + 1_000_000;
    await vfs.utimes('/f', future, future);
    await vfs.writeFile('/f', 'bbbb'); // same byte length
    expect((await vfs.stat('/f')).mtime).toBeGreaterThan(future);
  });

  it('repeated same-size overwrites yield strictly increasing mtimes', async () => {
    const vfs = new MemoryVfs();
    await vfs.writeFile('/g', 'x');
    const seen: number[] = [];
    for (let i = 0; i < 5; i++) {
      await vfs.writeFile('/g', 'y'); // same size each iteration
      seen.push((await vfs.stat('/g')).mtime);
    }
    for (let i = 1; i < seen.length; i++) {
      expect(seen[i] as number).toBeGreaterThan(seen[i - 1] as number);
    }
  });
});
