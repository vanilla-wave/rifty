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

  it('esbuildShimFiles delegates the real esbuild JS API to the host bridge (ADR-0192)', () => {
    const pkg = esbuildShimFiles['/workspace/node_modules/esbuild/package.json'] ?? '';
    expect(pkg).toContain('"esbuild"');
    // Real version — the exact esbuild-wasm pin, never an invented string.
    expect(pkg).toContain('"version": "0.27.7"');
    const main = esbuildShimFiles['/workspace/node_modules/esbuild/lib/main.js'] ?? '';
    expect(main).toContain('globalThis.__riftyEsbuild');
    // Real surface: version from the host instance + full async API delegation.
    expect(main).toContain('export const version = hostEsbuild().version');
    for (const member of [
      'transform',
      'build',
      'context',
      'formatMessages',
      'analyzeMetafile',
      'stop',
    ]) {
      expect(main).toContain(`hostEsbuild().${member}(`);
    }
    // esbuild-wasm has no synchronous API in a browser realm — loud throws.
    for (const feature of [
      'esbuild.transformSync',
      'esbuild.buildSync',
      'esbuild.formatMessagesSync',
      'esbuild.analyzeMetafileSync',
    ]) {
      expect(main).toContain(`NotImplementedError('${feature}'`);
    }
    // The fakes are gone: no invented version, no transform-only build()
    // emulation, no do-nothing context stub, no WASI transform bridge.
    expect(main).not.toContain('0.21.5');
    expect(main).not.toContain('loadEntryThroughPlugins');
    expect(main).not.toContain('__riftyEsbuildTransform');
    expect(main).not.toContain('rebuild: async () => ({');
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

  it('dev and build share ONE honest esbuild delegation shim (ADR-0192)', () => {
    const buildEsbuild = viteBuildShimFiles['/workspace/node_modules/esbuild/lib/main.js'];
    const devEsbuild = viteBrowserShimFiles['/workspace/node_modules/esbuild/lib/main.js'];

    expect(buildEsbuild).toBe(devEsbuild);
    expect(buildEsbuild).toContain('globalThis.__riftyEsbuild');
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
