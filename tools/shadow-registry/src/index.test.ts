import { describe, expect, it } from 'vitest';
import { bakedOverrides, internalsShims } from './index.ts';

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

  it('internalsShims are keyed by installed trigger with package-relative file paths', () => {
    expect(Object.keys(internalsShims).sort()).toEqual([
      '@esbuild/wasi-preview1',
      'lightningcss-wasm',
      'rollup',
    ]);
    for (const shim of Object.values(internalsShims)) {
      expect(shim.range.length).toBeGreaterThan(0);
      for (const rel of Object.keys(shim.files)) {
        // Relative, in-package paths only — the installer anchors them at the
        // resolved installPath (never a hardcoded /workspace root).
        expect(rel.startsWith('/')).toBe(false);
        expect(rel).not.toContain('..');
        expect(rel).not.toContain('node_modules');
      }
    }
  });

  it('rollup shim is ONE mode-independent file delegating to the real WASM parser', () => {
    const rollup = internalsShims.rollup;
    expect(rollup?.range).toBe('^4.0.0');
    const native = rollup?.files['dist/native.js'] ?? '';
    expect(native).toContain("require('@rollup/wasm-node/dist/native.js')");
    expect(native).toContain('exports.parse = native.parse');
    expect(native).toContain('exports.parseAsync = native.parseAsync');
    expect(native).toContain('exports.xxhashBase64Url = native.xxhashBase64Url');
    expect(native).toContain('exports.xxhashBase36 = native.xxhashBase36');
    expect(native).toContain('exports.xxhashBase16 = native.xxhashBase16');
    // The dev empty-Program stub is gone (ADR-0188) — no fallback, no mode split.
    expect(native).not.toContain('emptyProgram');
  });

  it('rollup shim companion-pins @rollup/wasm-node in lockstep', () => {
    expect(internalsShims.rollup?.companions).toEqual(['@rollup/wasm-node']);
  });

  it('esbuild alias shim materializes the original import name with the bridge-backed entry', () => {
    const shim = internalsShims['@esbuild/wasi-preview1'];
    expect(shim?.into).toBe('esbuild');
    expect(shim?.files['package.json']).toContain('"esbuild"');
    const main = shim?.files['lib/main.js'] ?? '';
    expect(main).toContain('export const version');
    expect(main).toContain('__riftyEsbuildTransform');
    expect(main).toContain("NotImplementedError('esbuild.transform'");
    // Unified content: real bridge transform + write:false config build + the
    // tolerant no-op context() dev dep-scan constructs.
    expect(main).toContain('loadEntryThroughPlugins');
    expect(main).toContain('opts.write !== false');
    expect(main).toContain('rebuild: async ()');
    expect(main).not.toContain('Pass-through');
  });

  it('lightningcss alias shim delegates both entrypoints to lightningcss-wasm', () => {
    const shim = internalsShims['lightningcss-wasm'];
    expect(shim?.into).toBe('lightningcss');
    expect(shim?.files['package.json']).toContain('"lightningcss"');
    expect(shim?.files['index.mjs']).toContain("from 'lightningcss-wasm'");
    expect(shim?.files['index.cjs']).toContain("require('lightningcss-wasm')");
  });
});
