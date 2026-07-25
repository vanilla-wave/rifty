import { describe, expect, it } from 'vitest';
import { viteCliPreparationFromArgs } from './vite-cli-prep.ts';

describe('vite CLI preparation (seam used by the node-entry bootstrap)', () => {
  it('builds one complete preparation without a host esbuild asset', () => {
    expect(
      viteCliPreparationFromArgs({
        root: '/parent',
        args: ['build'],
        executedBinPath: '/parent/node_modules/.bin/vite',
      }),
    ).toEqual({
      root: '/parent',
      mode: 'build',
      executedBinPath: '/parent/node_modules/.bin/vite',
    });
  });
});
