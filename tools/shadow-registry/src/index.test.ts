import { describe, expect, it } from 'vitest';
import { bakedOverrides, esbuildShimFiles, rollupShimFiles } from './index.ts';

describe('shadow-registry', () => {
  it('bakedOverrides contains the bcrypt → bcryptjs entry', () => {
    expect(bakedOverrides.bcrypt).toBe('bcryptjs');
  });

  it('esbuildShimFiles exposes a passthrough package.json + main.js', () => {
    expect(esbuildShimFiles['/workspace/node_modules/esbuild/package.json']).toContain('"esbuild"');
    expect(esbuildShimFiles['/workspace/node_modules/esbuild/lib/main.js']).toContain(
      'export const version',
    );
  });

  it('rollupShimFiles overlays dist/native.js', () => {
    expect(rollupShimFiles['/workspace/node_modules/rollup/dist/native.js']).toContain(
      'exports.parse',
    );
  });
});
