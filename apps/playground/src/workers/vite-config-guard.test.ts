import { describe, expect, it } from 'vitest';
import {
  VITE_CONFIG_FILENAMES,
  assertNoUserViteConfig,
  findUserViteConfig,
} from './vite-config-guard.ts';

describe('findUserViteConfig', () => {
  it('matches Vite DEFAULT_CONFIG_FILES verbatim — order included', () => {
    // Contract renegotiated (PR-125 review): the earlier ts-first pin was
    // Vite-DIVERGENT — vite/src/node/constants.ts resolves js -> mjs -> ts ->
    // cjs -> mts -> cts (verified against the installed vite dist). The order
    // decides which file Vite loads when several exist AND whether the seeded
    // template .js would shadow a user's .ts (it would — js wins).
    expect(VITE_CONFIG_FILENAMES).toEqual([
      'vite.config.js',
      'vite.config.mjs',
      'vite.config.ts',
      'vite.config.cjs',
      'vite.config.mts',
      'vite.config.cts',
    ]);
  });

  it('reports the js config as the loaded one when both js and ts exist (Vite order)', () => {
    const present = new Set(['/scratch/vite.config.ts', '/scratch/vite.config.js']);
    expect(findUserViteConfig('/scratch', (path) => present.has(path))).toBe(
      '/scratch/vite.config.js',
    );
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
