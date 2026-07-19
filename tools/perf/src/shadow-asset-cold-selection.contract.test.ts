import { describe, expect, it, vi } from 'vitest';
import {
  installEsbuild0280SelectionOracle,
  pinnedEsbuild0280Packument,
} from './shadow-asset-cold-selection.mjs';

const REGISTRY_URL = 'https://registry.example/npm-registry';
const EXACT = {
  name: 'esbuild',
  version: '0.28.0',
  dist: {
    tarball: 'https://registry.example/esbuild/-/esbuild-0.28.0.tgz',
    integrity: 'sha512-exact',
  },
};

function movingPackument() {
  return {
    _id: 'esbuild',
    name: 'esbuild',
    'dist-tags': { latest: '0.28.1', next: '0.29.0' },
    versions: {
      '0.28.0': EXACT,
      '0.28.1': {
        name: 'esbuild',
        version: '0.28.1',
        dist: {
          tarball: 'https://registry.example/esbuild/-/esbuild-0.28.1.tgz',
          integrity: 'sha512-later',
        },
      },
    },
    time: { modified: '2026-07-18T00:00:00.000Z' },
  };
}

describe('finite public esbuild selection oracle', () => {
  it('keeps real exact metadata but exposes only the proven 0.28.0 selection', () => {
    const input = movingPackument();
    const pinned = pinnedEsbuild0280Packument(input);

    expect(pinned).toEqual({
      ...input,
      'dist-tags': { latest: '0.28.0', next: '0.29.0' },
      versions: { '0.28.0': EXACT },
    });
    expect(pinned).not.toBe(input);
    expect(pinned.versions['0.28.0']).toBe(EXACT);
  });

  it.each([
    ['missing exact version', () => ({ ...movingPackument(), versions: {} })],
    [
      'wrong exact identity',
      () => ({
        ...movingPackument(),
        versions: { '0.28.0': { ...EXACT, version: '0.28.1' } },
      }),
    ],
    [
      'wrong exact tarball',
      () => ({
        ...movingPackument(),
        versions: {
          '0.28.0': { ...EXACT, dist: { ...EXACT.dist, tarball: 'https://evil.example/file.tgz' } },
        },
      }),
    ],
    [
      'missing exact integrity',
      () => ({
        ...movingPackument(),
        versions: { '0.28.0': { ...EXACT, dist: { ...EXACT.dist, integrity: '' } } },
      }),
    ],
  ])('refuses %s instead of fabricating a selection', (_label, input) => {
    expect(() => pinnedEsbuild0280Packument(input())).toThrow(/esbuild@0\.28\.0/i);
  });

  it('routes the exact configured packument, verifies upstream, and proves one use', async () => {
    let handler: ((route: unknown) => Promise<void>) | undefined;
    const context = {
      route: vi.fn(async (_url: string, callback: (route: unknown) => Promise<void>) => {
        handler = callback;
      }),
    };
    const response = {
      ok: () => true,
      status: () => 200,
      json: async () => movingPackument(),
    };
    const fulfill = vi.fn(async () => undefined);
    const oracle = await installEsbuild0280SelectionOracle(context, REGISTRY_URL);

    expect(context.route).toHaveBeenCalledWith(`${REGISTRY_URL}/esbuild`, expect.any(Function));
    await handler?.({
      request: () => ({ method: () => 'GET' }),
      fetch: async () => response,
      fulfill,
    });
    expect(fulfill).toHaveBeenCalledWith({
      response,
      json: expect.objectContaining({
        'dist-tags': expect.objectContaining({ latest: '0.28.0' }),
        versions: { '0.28.0': EXACT },
      }),
    });
    expect(oracle.assertUsed()).toEqual({ requests: 1 });
  });

  it('refuses an unused, repeated, non-GET, or failed upstream oracle', async () => {
    let handler: ((route: unknown) => Promise<void>) | undefined;
    const context = {
      route: async (_url: string, callback: (route: unknown) => Promise<void>) => {
        handler = callback;
      },
    };
    const oracle = await installEsbuild0280SelectionOracle(context, REGISTRY_URL);
    expect(() => oracle.assertUsed()).toThrow(/exactly once/i);

    const fulfill = vi.fn();
    await expect(
      handler?.({
        request: () => ({ method: () => 'POST' }),
        fetch: vi.fn(),
        fulfill,
      }),
    ).rejects.toThrow(/GET/i);
    await expect(
      handler?.({
        request: () => ({ method: () => 'GET' }),
        fetch: async () => ({ ok: () => false, status: () => 503 }),
        fulfill,
      }),
    ).rejects.toThrow(/503/);
    expect(fulfill).not.toHaveBeenCalled();
    expect(() => oracle.assertUsed()).toThrow(/exactly once/i);
  });
});
