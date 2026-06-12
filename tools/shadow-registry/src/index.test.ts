import { describe, expect, it } from 'vitest';
import {
  bakedOverrides,
  browserShimLifecycleScriptSkips,
  esbuildShimFiles,
  rollupShimFiles,
} from './index.ts';

describe('shadow-registry', () => {
  it('bakedOverrides contains the bcrypt → bcryptjs entry', () => {
    expect(bakedOverrides.bcrypt).toBe('bcryptjs');
  });

  it('bakedOverrides replaces esbuild with the WASI artifact', () => {
    expect(bakedOverrides.esbuild).toBe('@esbuild/wasi-preview1@0.28.0');
  });

  it('esbuildShimFiles exposes a passthrough package.json + main.js', () => {
    expect(esbuildShimFiles['/workspace/node_modules/esbuild/package.json']).toContain('"esbuild"');
    expect(esbuildShimFiles['/workspace/node_modules/esbuild/lib/main.js']).toContain(
      'export const version',
    );
    expect(browserShimLifecycleScriptSkips.esbuild).toContainEqual({
      version: '0.21.5',
      scripts: ['postinstall'],
    });
  });

  it('rollupShimFiles overlays dist/native.js', () => {
    expect(rollupShimFiles['/workspace/node_modules/rollup/dist/native.js']).toContain(
      'exports.parse',
    );
  });
});
