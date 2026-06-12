import type { Packument } from '@riftydev/npm-client';
import { describe, expect, it } from 'vitest';
import { stripBrowserShimLifecycleScripts } from './vite-registry-client.ts';

describe('vite registry client shim lifecycle policy', () => {
  it('strips only lifecycle scripts covered by browser shims', () => {
    const packument: Packument = {
      name: 'esbuild',
      'dist-tags': { latest: '0.21.5' },
      versions: {
        '0.21.5': {
          name: 'esbuild',
          version: '0.21.5',
          scripts: {
            preinstall: 'node preinstall.js',
            postinstall: 'node install.js',
          },
          dist: { tarball: 'fake://esbuild/0.21.5' },
        },
      },
    };

    const stripped = stripBrowserShimLifecycleScripts('esbuild', packument);

    expect(stripped.versions['0.21.5']?.scripts).toEqual({
      preinstall: 'node preinstall.js',
    });
    expect(packument.versions['0.21.5']?.scripts).toEqual({
      preinstall: 'node preinstall.js',
      postinstall: 'node install.js',
    });
  });

  it('leaves ordinary package lifecycle scripts untouched', () => {
    const packument: Packument = {
      name: 'with-script',
      versions: {
        '1.0.0': {
          name: 'with-script',
          version: '1.0.0',
          scripts: { postinstall: 'node install.js' },
          dist: { tarball: 'fake://with-script/1.0.0' },
        },
      },
    };

    expect(stripBrowserShimLifecycleScripts('with-script', packument)).toBe(packument);
  });

  it('leaves esbuild versions without a matching shim untouched', () => {
    const packument: Packument = {
      name: 'esbuild',
      'dist-tags': { latest: '0.99.0' },
      versions: {
        '0.99.0': {
          name: 'esbuild',
          version: '0.99.0',
          scripts: { postinstall: 'node install.js' },
          dist: { tarball: 'fake://esbuild/0.99.0' },
        },
      },
    };

    expect(stripBrowserShimLifecycleScripts('esbuild', packument)).toBe(packument);
  });
});
