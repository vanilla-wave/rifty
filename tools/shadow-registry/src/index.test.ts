import { describe, expect, it } from 'vitest';
import {
  bakedOverrides,
  browserShimFileSets,
  collectBrowserShimFiles,
  esbuildShimFiles,
  lightningcssShimFiles,
  rollupShimFiles,
  viteBrowserShimFiles,
  viteBuildShimFiles,
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

  it('esbuildShimFiles exposes a bridge-backed package.json + main.js', () => {
    expect(esbuildShimFiles['/workspace/node_modules/esbuild/package.json']).toContain('"esbuild"');
    const main = esbuildShimFiles['/workspace/node_modules/esbuild/lib/main.js'] ?? '';
    expect(main).toContain('export const version');
    expect(main).toContain('__riftyEsbuildTransform');
    expect(main).toContain("NotImplementedError('esbuild.transform'");
    expect(main).not.toContain('Pass-through');
  });

  it('rollupShimFiles overlays dist/native.js', () => {
    expect(rollupShimFiles['/workspace/node_modules/rollup/dist/native.js']).toContain(
      'exports.parse',
    );
  });

  it('viteBuildShimFiles uses the real @rollup/wasm-node parser without changing the dev stub', () => {
    const buildNative = viteBuildShimFiles['/workspace/node_modules/rollup/dist/native.js'];
    const devNative = viteBrowserShimFiles['/workspace/node_modules/rollup/dist/native.js'];

    expect(buildNative).toContain("require('@rollup/wasm-node/dist/native.js')");
    expect(buildNative).toContain('exports.parse = native.parse');
    expect(buildNative).toContain('exports.parseAsync = native.parseAsync');
    expect(buildNative).toContain('exports.xxhashBase64Url = native.xxhashBase64Url');
    expect(buildNative).toContain('exports.xxhashBase36 = native.xxhashBase36');
    expect(buildNative).toContain('exports.xxhashBase16 = native.xxhashBase16');
    expect(devNative).not.toBe(buildNative);
    expect(devNative).toContain('emptyProgram');
  });

  it('viteBuildShimFiles delegates esbuild transform/config-build to the injected async WASI bridge', () => {
    const buildEsbuild = viteBuildShimFiles['/workspace/node_modules/esbuild/lib/main.js'];
    const devEsbuild = viteBrowserShimFiles['/workspace/node_modules/esbuild/lib/main.js'];

    expect(buildEsbuild).toContain('__riftyEsbuildTransform');
    expect(buildEsbuild).toContain('NotImplementedError');
    expect(buildEsbuild).toContain('esbuild.transformSync');
    expect(buildEsbuild).toContain('loadEntryThroughPlugins');
    expect(buildEsbuild).toContain('opts.write !== false');
    expect(buildEsbuild).not.toBe(devEsbuild);
    expect(devEsbuild).toContain('__riftyEsbuildTransform');
    expect(devEsbuild).toContain('dev-server did not install the WASI transform bridge');
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
