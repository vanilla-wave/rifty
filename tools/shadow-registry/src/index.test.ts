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

  it('esbuild alias materializes one CJS overlay over the realm runtime slot', () => {
    const shim = internalsShims['@esbuild/wasi-preview1'];
    expect(shim?.into).toBe('esbuild');
    expect(shim?.files['package.json']).toContain('"esbuild"');
    expect(Object.keys(shim?.files ?? {}).sort()).toEqual(['lib/main.cjs', 'package.json']);
    const main = shim?.files['lib/main.cjs'] ?? '';
    expect(main).toContain('globalThis.__rifty?.esbuild');
    expect(main).toContain('module.exports = esbuild');
    expect(main).not.toContain('__riftyEsbuildTransform');
    expect(main).not.toContain('Proxy');
    expect(main).not.toContain('Object.assign');
  });

  it('esbuild alias version matches the bakedOverrides trigger pin exactly (no lying metadata)', () => {
    const shim = internalsShims['@esbuild/wasi-preview1'];
    const pinned = bakedOverrides.esbuild?.split('@').at(-1);
    const pkg = JSON.parse(shim?.files['package.json'] ?? '{}') as { version?: string };
    // Static package metadata must equal the installed trigger pin.
    expect(pkg.version).toBe(pinned);
    expect(shim?.apiVersion).toBe(pinned);
    expect(shim?.range).toBe(pinned);
  });

  it('esbuild main/import/require/default resolve to the same CJS module id', () => {
    const shim = internalsShims['@esbuild/wasi-preview1'];
    const pkg = JSON.parse(shim?.files['package.json'] ?? '{}') as {
      main?: string;
      module?: string;
      type?: string;
      exports?: Record<string, Record<string, string>>;
    };
    const ids = [
      pkg.main,
      pkg.module,
      pkg.exports?.['.']?.import,
      pkg.exports?.['.']?.require,
      pkg.exports?.['.']?.default,
    ];
    expect(ids).toEqual(Array.from({ length: 5 }, () => './lib/main.cjs'));
    expect(new Set(ids)).toEqual(new Set(['./lib/main.cjs']));
    expect(pkg.type).toBe('commonjs');
  });

  it('lightningcss alias shim delegates both entrypoints to lightningcss-wasm', () => {
    const shim = internalsShims['lightningcss-wasm'];
    expect(shim?.into).toBe('lightningcss');
    expect(shim?.files['package.json']).toContain('"lightningcss"');
    expect(shim?.files['index.mjs']).toContain("from 'lightningcss-wasm'");
    expect(shim?.files['index.cjs']).toContain("require('lightningcss-wasm')");
  });
});

describe('esbuild CJS overlay behavior', () => {
  type RiftyTestGlobal = typeof globalThis & {
    __rifty?: { esbuild?: unknown };
    __riftyEsbuildTransform?: unknown;
  };

  function loadCjsShim(): unknown {
    const cjs = internalsShims['@esbuild/wasi-preview1']?.files['lib/main.cjs'] ?? '';
    const module: { exports: unknown } = { exports: {} };
    new Function('module', 'exports', cjs)(module, module.exports);
    return module.exports;
  }

  function withRuntimeSlot(run: (global: RiftyTestGlobal) => void): void {
    const global = globalThis as RiftyTestGlobal;
    const previous = Object.getOwnPropertyDescriptor(global, '__rifty');
    try {
      run(global);
    } finally {
      if (previous) Object.defineProperty(global, '__rifty', previous);
      else Reflect.deleteProperty(global, '__rifty');
    }
  }

  it('exports the exact slot object without a facade or wrapper', () => {
    withRuntimeSlot((global) => {
      const runtime = Object.freeze({
        version: '0.28.0',
        build: () => 'build-marker',
        default: Object.freeze({ default: 'upstream-default-marker' }),
      });
      global.__rifty = { esbuild: runtime };
      expect(loadCjsShim()).toBe(runtime);
    });
  });

  it('loud-throws when the runtime slot is absent and ignores the legacy bridge', () => {
    withRuntimeSlot((global) => {
      global.__rifty = {};
      global.__riftyEsbuildTransform = () => undefined;
      try {
        expect(() => loadCjsShim()).toThrow(
          'rifty invariant: esbuild runtime slot is not initialized',
        );
      } finally {
        Reflect.deleteProperty(global, '__riftyEsbuildTransform');
      }
    });
  });
});
