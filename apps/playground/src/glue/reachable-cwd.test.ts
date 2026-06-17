/**
 * Tests for `reachableCwd` — the owner-side guard that a restored terminal cwd
 * still exists as a directory in the OWNER tree (single-store-owner model:
 * exactly one realm owns the authoritative store, and the page holds no
 * authoritative fs — it reads through ports; cwd validation moved off the PAGE
 * store, where it read a now-removed authoritative mirror, into the owner realm
 * that actually holds the tree).
 */

import { describe, expect, it } from 'vitest';
import { reachableCwd } from './reachable-cwd.ts';

interface FakeFs {
  statSyncOrNull(path: string): { isDirectory: boolean } | null;
}

function fs(dirs: readonly string[]): FakeFs {
  const set = new Set(dirs);
  return {
    statSyncOrNull: (path) => (set.has(path) ? { isDirectory: true } : null),
  };
}

describe('reachableCwd', () => {
  it('keeps the cwd when it is a directory in the tree', () => {
    expect(reachableCwd(fs(['/workspace', '/workspace/src']), '/workspace/src', '/workspace')).toBe(
      '/workspace/src',
    );
  });

  it('falls back when the cwd is absent from the tree', () => {
    expect(reachableCwd(fs(['/workspace']), '/workspace/gone', '/workspace')).toBe('/workspace');
  });

  it('falls back when the cwd resolves to a file, not a directory', () => {
    const fileFs: FakeFs = {
      statSyncOrNull: (path) => (path === '/workspace/file.js' ? { isDirectory: false } : null),
    };
    expect(reachableCwd(fileFs, '/workspace/file.js', '/workspace')).toBe('/workspace');
  });

  it('falls back when no cwd is given', () => {
    expect(reachableCwd(fs(['/workspace']), undefined, '/workspace')).toBe('/workspace');
  });
});
