import { describe, expect, it } from 'vitest';
import { bakedOverrides, internalsShims } from './index.ts';
import { builtinShadowSubstitutionCatalog } from './internal/index.ts';

describe('shadow-registry', () => {
  it('bakedOverrides contains the bcrypt → bcryptjs entry', () => {
    expect(bakedOverrides.bcrypt).toBe('bcryptjs');
  });

  it('has no legacy esbuild redirect or alias overlay', () => {
    expect(bakedOverrides.esbuild).toBeUndefined();
    expect(internalsShims['@esbuild/wasi-preview1']).toBeUndefined();
  });

  it('bakedOverrides replaces lightningcss with the WASM artifact', () => {
    expect(bakedOverrides.lightningcss).toBe('lightningcss-wasm@1.32.0');
  });

  it('bakedOverrides replaces exact sass-embedded with the exact pure Sass twin', () => {
    expect(bakedOverrides['sass-embedded']).toBe('sass@1.100.0');
  });

  it('derives every registry-backed builtin redirect from the owner-decoded catalog', () => {
    const registryRedirects = Object.fromEntries(
      builtinShadowSubstitutionCatalog.recipes.flatMap((recipe) =>
        recipe.acquisition.kind === 'registry'
          ? [
              [
                recipe.trigger.name,
                `${recipe.acquisition.name}@${recipe.acquisition.version}`,
              ] as const,
            ]
          : [],
      ),
    );

    expect(bakedOverrides).toEqual({ bcrypt: 'bcryptjs', ...registryRedirects });
  });

  it('internalsShims are keyed by installed trigger with package-relative file paths', () => {
    expect(Object.keys(internalsShims).sort()).toEqual(['lightningcss-wasm', 'rollup']);
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

  it('keeps the install-only Sass recipe out of the internals-shim path', () => {
    expect(internalsShims.sass).toBeUndefined();
    expect(internalsShims['sass-embedded']).toBeUndefined();
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

  it('lightningcss alias shim delegates both entrypoints to lightningcss-wasm', () => {
    const shim = internalsShims['lightningcss-wasm'];
    expect(shim?.into).toBe('lightningcss');
    expect(shim?.files['package.json']).toContain('"lightningcss"');
    expect(shim?.files['index.mjs']).toContain("from 'lightningcss-wasm'");
    expect(shim?.files['index.cjs']).toContain("require('lightningcss-wasm')");
  });
});
