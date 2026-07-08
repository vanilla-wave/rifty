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

  it('esbuild alias shim delegates the REAL esbuild JS API to the host bridge (ADR-0192)', () => {
    const shim = internalsShims['@esbuild/wasi-preview1'];
    expect(shim?.into).toBe('esbuild');
    expect(shim?.files['package.json']).toContain('"esbuild"');
    const main = shim?.files['lib/main.js'] ?? '';
    expect(main).toContain('globalThis.__riftyEsbuild');
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
    // The partial emulations are gone: no transform-only build(), no
    // empty-only context stub, no WASI transform bridge global.
    expect(main).not.toContain('loadEntryThroughPlugins');
    expect(main).not.toContain('__riftyEsbuildTransform');
    expect(main).not.toContain('rebuild: async () => ({');
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
    expect(cjs).toContain('globalThis.__riftyEsbuild');
    expect(esm).toContain('globalThis.__riftyEsbuild');
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
    readonly initialize: (options?: object) => Promise<void>;
    readonly transform: (input: string, options?: object) => Promise<{ code: string }>;
    readonly build: (opts: object) => Promise<unknown>;
    readonly context: (opts: object) => Promise<unknown>;
    readonly transformSync: (input: string, options?: object) => unknown;
    readonly buildSync: (opts: object) => unknown;
    readonly stop: () => Promise<void>;
  }

  function loadCjsShim(): EsbuildShimApi {
    const cjs = internalsShims['@esbuild/wasi-preview1']?.files['lib/main.cjs'] ?? '';
    const module = { exports: {} };
    new Function('module', 'exports', cjs)(module, module.exports);
    return module.exports as EsbuildShimApi;
  }

  const withHost = async (
    host: object,
    run: (esbuild: EsbuildShimApi) => Promise<void>,
  ): Promise<void> => {
    const g = globalThis as { __riftyEsbuild?: unknown };
    g.__riftyEsbuild = host;
    try {
      await run(loadCjsShim());
    } finally {
      g.__riftyEsbuild = undefined;
    }
  };

  it('delegates transform/build/context untouched to the host instance', async () => {
    const calls: Array<{ member: string; args: unknown[] }> = [];
    const record =
      (member: string) =>
      (...args: unknown[]) => {
        calls.push({ member, args });
        return Promise.resolve({ member });
      };
    await withHost(
      { transform: record('transform'), build: record('build'), context: record('context') },
      async (esbuild) => {
        const options = { entryPoints: ['a.ts'], bundle: true, plugins: [{ name: 'p' }] };
        await esbuild.transform('const x = 1', { loader: 'ts' });
        await esbuild.build(options);
        await esbuild.context(options);
        expect(calls.map((c) => c.member)).toEqual(['transform', 'build', 'context']);
        // Same object references cross the bridge — JS plugins stay callable.
        expect(calls[1]?.args[0]).toBe(options);
        expect(calls[2]?.args[0]).toBe(options);
      },
    );
  });

  it('API calls without the installed host bridge fail loud (sync, fail-fast) with the wiring hint', () => {
    const esbuild = loadCjsShim();
    expect(() => esbuild.transform('x')).toThrow(/installEsbuildBridge/);
    expect(() => esbuild.build({})).toThrow(/installEsbuildBridge/);
  });

  it('initialize rejects browser-only options and a second call (Node esbuild parity)', async () => {
    let hostInits = 0;
    await withHost(
      {
        initialize: () => {
          hostInits += 1;
          return Promise.resolve();
        },
      },
      async (esbuild) => {
        await expect(esbuild.initialize({ wasmURL: 'x.wasm' })).rejects.toThrow(/esbuild-wasm/);
        await esbuild.initialize();
        expect(hostInits).toBe(1);
        await expect(esbuild.initialize()).rejects.toThrow(/more than once/);
      },
    );
  });

  it('initialize can retry after a failed host initialization', async () => {
    let hostInits = 0;
    await withHost(
      {
        initialize: () => {
          hostInits += 1;
          return hostInits === 1
            ? Promise.reject(new Error('wasm fetch failed'))
            : Promise.resolve();
        },
      },
      async (esbuild) => {
        await expect(esbuild.initialize()).rejects.toThrow('wasm fetch failed');
        await esbuild.initialize();
        expect(hostInits).toBe(2);
        await expect(esbuild.initialize()).rejects.toThrow(/more than once/);
      },
    );
  });

  it('sync APIs loud-throw (esbuild-wasm has no synchronous API in a browser realm)', () => {
    const esbuild = loadCjsShim();
    expect(() => esbuild.transformSync('x')).toThrow(/esbuild\.transformSync/);
    expect(() => esbuild.buildSync({})).toThrow(/esbuild\.buildSync/);
  });
});
