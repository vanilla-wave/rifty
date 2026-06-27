import { describe, expect, it } from 'vitest';
import {
  VITE_CONFIG_FILENAMES,
  assertNoUserViteConfig,
  findUserViteConfig,
} from './vite-config-guard.ts';

describe('findUserViteConfig', () => {
  it('checks every real Vite root config filename', () => {
    expect(VITE_CONFIG_FILENAMES).toEqual([
      'vite.config.ts',
      'vite.config.js',
      'vite.config.mjs',
      'vite.config.cjs',
      'vite.config.mts',
      'vite.config.cts',
    ]);
  });

  it('returns the first present project-root vite config', () => {
    expect(findUserViteConfig('/scratch', (path) => path === '/scratch/vite.config.mjs')).toBe(
      '/scratch/vite.config.mjs',
    );
  });

  it('ignores non-root and absent vite configs', () => {
    expect(
      findUserViteConfig(
        '/scratch',
        (path) => path === '/scratch/src/vite.config.ts' || path === '/elsewhere/vite.config.ts',
      ),
    ).toBeNull();
  });

  it('throws a directed NotImplementedError when the legacy owner path would ignore config', () => {
    expect(() =>
      assertNoUserViteConfig('/scratch', (path) => path === '/scratch/vite.config.ts'),
    ).toThrow(
      expect.objectContaining({
        name: 'NotImplementedError',
        feature: 'vite.config-loading',
      }),
    );
  });
});
