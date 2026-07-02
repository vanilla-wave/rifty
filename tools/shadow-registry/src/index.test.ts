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
    expect(main).toContain('__riftyEsbuildTransform');
    expect(main).toContain("NotImplementedError('esbuild.transform'");
    // Unified content: real bridge transform + write:false config build.
    expect(main).toContain('loadEntryThroughPlugins');
    expect(main).toContain('opts.write !== false');
    expect(main).not.toContain('Pass-through');
  });

  it('esbuild alias version matches the bakedOverrides trigger pin exactly (no lying metadata)', () => {
    const shim = internalsShims['@esbuild/wasi-preview1'];
    const pinned = bakedOverrides.esbuild?.split('@').at(-1);
    const pkg = JSON.parse(shim?.files['package.json'] ?? '{}') as { version?: string };
    // The alias package.json + the shim's `version` export are STATIC claims;
    // they must equal the version the override actually installs, and the
    // exact-pin range must refuse any drifted trigger at install time.
    expect(pkg.version).toBe(pinned);
    expect(shim?.files['lib/main.js']).toContain(`const version = "${pinned}"`);
    expect(shim?.range).toBe(pinned);
  });

  it('esbuild alias serves BOTH module systems: ESM entry + CJS entry (require("esbuild") is real Node behavior)', () => {
    const shim = internalsShims['@esbuild/wasi-preview1'];
    const pkg = JSON.parse(shim?.files['package.json'] ?? '{}') as {
      main?: string;
      exports?: Record<string, Record<string, string>>;
    };
    // `type: module` classifies lib/main.js as ESM; a require condition pointing
    // there would loud-fail sync require() in the rifty loader — the require
    // entry must be a real .cjs file (the lightningcss shim pattern).
    expect(pkg.exports?.['.']?.import).toBe('./lib/main.js');
    expect(pkg.exports?.['.']?.require).toBe('./lib/main.cjs');
    expect(pkg.main).toBe('./lib/main.cjs');
    const esm = shim?.files['lib/main.js'] ?? '';
    const cjs = shim?.files['lib/main.cjs'] ?? '';
    expect(esm).toContain('export default');
    expect(esm).not.toContain('module.exports');
    expect(cjs).toContain('module.exports');
    expect(cjs).not.toContain('export default');
    // Same single body in both — no per-format drift.
    expect(cjs).toContain('loadEntryThroughPlugins');
    expect(cjs).toContain('__riftyEsbuildTransform');
  });

  it('esbuild build() loud-throws when the transformed entry imports local files (no silent single-module "bundle")', () => {
    const shim = internalsShims['@esbuild/wasi-preview1'];
    const main = shim?.files['lib/main.js'] ?? '';
    expect(main).toContain("'esbuild.build.bundle'");
  });

  it('esbuild context()/analyzeMetafile() are honest: empty inputs only, loud otherwise', () => {
    const shim = internalsShims['@esbuild/wasi-preview1'];
    const main = shim?.files['lib/main.js'] ?? '';
    expect(main).toContain("'esbuild.context'");
    expect(main).toContain("'esbuild.analyzeMetafile'");
  });

  it('lightningcss alias shim delegates both entrypoints to lightningcss-wasm', () => {
    const shim = internalsShims['lightningcss-wasm'];
    expect(shim?.into).toBe('lightningcss');
    expect(shim?.files['package.json']).toContain('"lightningcss"');
    expect(shim?.files['index.mjs']).toContain("from 'lightningcss-wasm'");
    expect(shim?.files['index.cjs']).toContain("require('lightningcss-wasm')");
  });
});

describe('esbuild shim behavior (CJS body executed)', () => {
  interface EsbuildShimApi {
    readonly version: string;
    readonly transform: (input: string, options?: object) => Promise<{ code: string }>;
    readonly build: (
      opts: object,
    ) => Promise<{ errors: unknown[]; outputFiles: { text: string }[] }>;
    readonly context: (
      opts: object,
    ) => Promise<{ rebuild: () => Promise<{ errors: unknown[]; outputFiles: unknown[] }> }>;
    readonly analyzeMetafile: (metafile: object) => Promise<string>;
  }
  type PluginApi = {
    onResolve: (options: object, cb: unknown) => void;
    onLoad: (
      options: { filter: RegExp },
      cb: (args: object) => { contents: string; loader: string },
    ) => void;
  };

  function loadCjsShim(): EsbuildShimApi {
    const cjs = internalsShims['@esbuild/wasi-preview1']?.files['lib/main.cjs'] ?? '';
    const module = { exports: {} };
    new Function('module', 'exports', cjs)(module, module.exports);
    return module.exports as EsbuildShimApi;
  }

  function entryPlugin(contents: string): object {
    return {
      name: 'test-loader',
      setup(api: PluginApi): void {
        api.onLoad({ filter: /.*/ }, () => ({ contents, loader: 'ts' }));
      },
    };
  }

  const withBridge = async (run: (esbuild: EsbuildShimApi) => Promise<void>): Promise<void> => {
    const g = globalThis as { __riftyEsbuildTransform?: unknown };
    g.__riftyEsbuildTransform = async (code: string) => ({ code, map: '', warnings: [] });
    try {
      await run(loadCjsShim());
    } finally {
      g.__riftyEsbuildTransform = undefined;
    }
  };

  it('build() succeeds for a single-module config with only bare (external) imports', async () => {
    await withBridge(async (esbuild) => {
      const result = await esbuild.build({
        write: false,
        entryPoints: ['/proj/vite.config.ts'],
        plugins: [
          entryPlugin("import { defineConfig } from 'vite';\nexport default defineConfig({});"),
        ],
      });
      expect(result.errors).toEqual([]);
      expect(result.outputFiles[0]?.text).toContain('defineConfig');
    });
  });

  it('build() loud-throws when the entry imports a LOCAL file (real esbuild would bundle it)', async () => {
    await withBridge(async (esbuild) => {
      await expect(
        esbuild.build({
          write: false,
          entryPoints: ['/proj/vite.config.ts'],
          plugins: [
            entryPlugin("import { helper } from './config-helper.js';\nexport default helper();"),
          ],
        }),
      ).rejects.toThrow(/esbuild\.build\.bundle/);
    });
  });

  it('context() with entry points loud-throws; the EMPTY dep-optimizer context rebuilds empty (real zero-entry result)', async () => {
    const esbuild = loadCjsShim();
    await expect(esbuild.context({ entryPoints: ['a.ts'] })).rejects.toThrow(/esbuild\.context/);
    const ctx = await esbuild.context({ entryPoints: [] });
    await expect(ctx.rebuild()).resolves.toMatchObject({ errors: [], outputFiles: [] });
  });

  it('analyzeMetafile is loud for a non-empty metafile, honest-empty otherwise', async () => {
    const esbuild = loadCjsShim();
    await expect(esbuild.analyzeMetafile({ inputs: { 'a.ts': {} }, outputs: {} })).rejects.toThrow(
      /esbuild\.analyzeMetafile/,
    );
    await expect(esbuild.analyzeMetafile({ inputs: {}, outputs: {} })).resolves.toBe('');
  });
});
