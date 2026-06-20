import { describe, expect, it } from 'vitest';
import {
  bakedOverrides,
  browserShimFileSets,
  collectBrowserShimFiles,
  esbuildShimFiles,
  lightningcssShimFiles,
  rollupShimFiles,
  viteBrowserShimFiles,
} from './index.ts';

describe('shadow-registry', () => {
  it('bakedOverrides contains the bcrypt → bcryptjs entry', () => {
    expect(bakedOverrides.bcrypt).toBe('bcryptjs');
  });

  it('bakedOverrides replaces esbuild with the WASI artifact', () => {
    expect(bakedOverrides.esbuild).toBe('@esbuild/wasi-preview1@0.28.0');
  });

  it('bakedOverrides replaces lightningcss with the WASM artifact', () => {
    expect(bakedOverrides.lightningcss).toBe('lightningcss-wasm@1.32.0');
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

  it('lightningcssShimFiles exposes the native package name backed by lightningcss-wasm', () => {
    expect(lightningcssShimFiles['/workspace/node_modules/lightningcss/package.json']).toContain(
      '"lightningcss"',
    );
    expect(lightningcssShimFiles['/workspace/node_modules/lightningcss/index.mjs']).toContain(
      "from 'lightningcss-wasm'",
    );
    expect(lightningcssShimFiles['/workspace/node_modules/lightningcss/index.cjs']).toContain(
      "require('lightningcss-wasm')",
    );
  });

  it('typed browser shim registry declares the Vite overlay set', () => {
    expect(Object.keys(browserShimFileSets)).toEqual(['esbuild', 'lightningcss', 'rollup']);
    expect(browserShimFileSets.lightningcss.packageName).toBe('lightningcss');
    expect(collectBrowserShimFiles(['lightningcss'])).toEqual(lightningcssShimFiles);
    expect(viteBrowserShimFiles).toMatchObject({
      ...esbuildShimFiles,
      ...lightningcssShimFiles,
      ...rollupShimFiles,
    });
  });
});
