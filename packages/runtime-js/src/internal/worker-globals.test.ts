/**
 * Unit tests for the runtime-js worker-globals owner table.
 *
 * Closes the "Ungoverned globals" Tier 2 #10 finding from the 2026-05-26
 * architecture review: runtime-js used to write ad-hoc keys directly to
 * `globalThis`/`self` (`__riftyEsmStash`, `__riftyLastEsmBody`,
 * `__riftyLastEsmFile`, plus the `__setCreateRequireImpl` closure). With the
 * M11 A-026 multi-realm migration on the horizon, ad-hoc keys would start
 * colliding with kernel's `shared-globals.ts` published `__riftyKernel*`
 * keys. This module mirrors kernel's typed publish/read pattern under a
 * dedicated `__rifty` sub-namespace so the two never overlap.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  RUNTIME_JS_GLOBAL_KEYS,
  RUNTIME_JS_ROOT_KEY,
  publishRuntimeEsbuild,
  readRuntimeEsbuild,
  readRuntimeGlobal,
  runtimeGlobalKeys,
  unpublishRuntimeGlobal,
} from './worker-globals.ts';
import { publishRuntimeGlobal } from './worker-globals.ts';

interface MaybeGlobal {
  [k: string]: unknown;
}

function clearRoot(): void {
  for (const key of runtimeGlobalKeys()) {
    unpublishRuntimeGlobal(key);
  }
  // Replace the root with an empty placeholder so subsequent tests start
  // clean. `Reflect.deleteProperty` is biome-friendly (the bare `delete`
  // operator is banned by `lint/performance/noDelete`) and works on the
  // non-configurable property we installed.
  Reflect.deleteProperty(globalThis as MaybeGlobal, RUNTIME_JS_ROOT_KEY);
}

function withClean<T>(fn: () => T): T {
  try {
    return fn();
  } finally {
    clearRoot();
  }
}

afterEach(() => {
  clearRoot();
});

describe('RUNTIME_JS_GLOBAL_KEYS', () => {
  it('exposes every documented key', () => {
    expect(RUNTIME_JS_GLOBAL_KEYS.require).toBe('require');
    expect(RUNTIME_JS_GLOBAL_KEYS.import).toBe('import');
    expect(RUNTIME_JS_GLOBAL_KEYS.esmStash).toBe('esmStash');
    expect(RUNTIME_JS_GLOBAL_KEYS.esmLastBody).toBe('esmLastBody');
    expect(RUNTIME_JS_GLOBAL_KEYS.esmLastFile).toBe('esmLastFile');
    expect(RUNTIME_JS_GLOBAL_KEYS.createRequireImpl).toBe('createRequireImpl');
    expect(RUNTIME_JS_GLOBAL_KEYS.esbuild).toBe('esbuild');
  });

  it('lives under the single __rifty root', () => {
    expect(RUNTIME_JS_ROOT_KEY).toBe('__rifty');
  });

  it('runtimeGlobalKeys() enumerates the keys', () => {
    const keys = runtimeGlobalKeys();
    expect(keys).toContain('require');
    expect(keys).toContain('import');
    expect(keys).toContain('esmStash');
    expect(keys).toContain('esmLastBody');
    expect(keys).toContain('esmLastFile');
    expect(keys).toContain('createRequireImpl');
    expect(keys).toContain('esbuild');
  });
});

describe('publish/read roundtrip', () => {
  it('publishes and reads a function value (require)', () => {
    withClean(() => {
      const fn = (s: string): unknown => `loaded:${s}`;
      publishRuntimeGlobal('require', fn);
      const got = readRuntimeGlobal('require');
      expect(got).toBe(fn);
      expect(typeof got === 'function' && got('foo')).toBe('loaded:foo');
    });
  });

  it('publishes and reads an async function value (import)', () => {
    withClean(() => {
      const fn = async (s: string): Promise<unknown> => `imported:${s}`;
      publishRuntimeGlobal('import', fn);
      const got = readRuntimeGlobal('import');
      expect(got).toBe(fn);
    });
  });

  it('publishes and reads a Record value (esmStash)', () => {
    withClean(() => {
      const stash: Record<string, string> = { '/a.js': 'body-a', '/b.js': 'body-b' };
      publishRuntimeGlobal('esmStash', stash);
      const got = readRuntimeGlobal('esmStash');
      expect(got).toBe(stash);
      expect(got?.['/a.js']).toBe('body-a');
    });
  });

  it('publishes and reads a string value (esmLastBody)', () => {
    withClean(() => {
      publishRuntimeGlobal('esmLastBody', 'const x = 1;');
      expect(readRuntimeGlobal('esmLastBody')).toBe('const x = 1;');
    });
  });

  it('publishes and reads a string value (esmLastFile)', () => {
    withClean(() => {
      publishRuntimeGlobal('esmLastFile', '/some/module.mjs');
      expect(readRuntimeGlobal('esmLastFile')).toBe('/some/module.mjs');
    });
  });

  it('publishes and reads a function value (createRequireImpl)', () => {
    withClean(() => {
      const impl = (from: string) => {
        const req = (id: string): unknown => `${from}:${id}`;
        return req;
      };
      publishRuntimeGlobal('createRequireImpl', impl);
      const got = readRuntimeGlobal('createRequireImpl');
      expect(got).toBe(impl);
    });
  });

  it('returns null when a key has never been published', () => {
    withClean(() => {
      expect(readRuntimeGlobal('require')).toBeNull();
      expect(readRuntimeGlobal('import')).toBeNull();
      expect(readRuntimeGlobal('esmStash')).toBeNull();
      expect(readRuntimeGlobal('esmLastBody')).toBeNull();
      expect(readRuntimeGlobal('esmLastFile')).toBeNull();
      expect(readRuntimeGlobal('createRequireImpl')).toBeNull();
      expect(readRuntimeGlobal('esbuild')).toBeNull();
    });
  });

  it('publish is idempotent — re-publishing the same key overwrites', () => {
    withClean(() => {
      publishRuntimeGlobal('esmLastFile', '/first.mjs');
      expect(readRuntimeGlobal('esmLastFile')).toBe('/first.mjs');
      publishRuntimeGlobal('esmLastFile', '/second.mjs');
      expect(readRuntimeGlobal('esmLastFile')).toBe('/second.mjs');
    });
  });
});

describe('unpublish', () => {
  it('clears a previously-published key (read returns null afterwards)', () => {
    withClean(() => {
      publishRuntimeGlobal('esmLastBody', 'body');
      expect(readRuntimeGlobal('esmLastBody')).toBe('body');
      unpublishRuntimeGlobal('esmLastBody');
      expect(readRuntimeGlobal('esmLastBody')).toBeNull();
    });
  });

  it('is a no-op on a key that was never published (does not throw)', () => {
    withClean(() => {
      expect(() => unpublishRuntimeGlobal('esmStash')).not.toThrow();
      expect(readRuntimeGlobal('esmStash')).toBeNull();
    });
  });

  it('leaves other keys intact', () => {
    withClean(() => {
      publishRuntimeGlobal('esmLastBody', 'body');
      publishRuntimeGlobal('esmLastFile', '/file.mjs');
      unpublishRuntimeGlobal('esmLastBody');
      expect(readRuntimeGlobal('esmLastBody')).toBeNull();
      expect(readRuntimeGlobal('esmLastFile')).toBe('/file.mjs');
    });
  });

  it('after unpublishing every key, the __rifty root holds an empty object', () => {
    withClean(() => {
      publishRuntimeGlobal('esmLastBody', 'b');
      publishRuntimeGlobal('esmLastFile', '/f');
      unpublishRuntimeGlobal('esmLastBody');
      unpublishRuntimeGlobal('esmLastFile');
      const root = (globalThis as MaybeGlobal)[RUNTIME_JS_ROOT_KEY];
      expect(root).toBeDefined();
      expect(Object.keys(root as object)).toEqual([]);
    });
  });
});

describe('esbuild public seam', () => {
  it('returns null before this realm publishes an outer', () => {
    withClean(() => {
      expect(readRuntimeEsbuild()).toBeNull();
    });
  });

  it('publishes under the owner-table key and preserves exact identity', () => {
    withClean(() => {
      const outer = Object.freeze({ version: '0.28.0', build: () => undefined });
      publishRuntimeEsbuild(outer);

      expect(readRuntimeEsbuild()).toBe(outer);
      const root = (globalThis as MaybeGlobal)[RUNTIME_JS_ROOT_KEY] as
        | Record<string, unknown>
        | undefined;
      expect(root?.esbuild).toBe(outer);
      expect((globalThis as MaybeGlobal).__riftyEsbuild).toBeUndefined();
    });
  });

  it('uses owner-table overwrite semantics without mutating either outer', () => {
    withClean(() => {
      const first = Object.freeze({ version: 'first' });
      const second = Object.freeze({ version: 'second' });

      publishRuntimeEsbuild(first);
      publishRuntimeEsbuild(second);

      expect(readRuntimeEsbuild()).toBe(second);
      expect(first).toEqual({ version: 'first' });
      expect(second).toEqual({ version: 'second' });
    });
  });
});

describe('namespace isolation', () => {
  it('runtime-js keys live under the __rifty root, not flat on globalThis', () => {
    withClean(() => {
      publishRuntimeGlobal('require', () => undefined);
      // The flat-key forms used pre-migration should never be seen post-publish.
      expect((globalThis as MaybeGlobal).__riftyEsmStash).toBeUndefined();
      expect((globalThis as MaybeGlobal).__riftyLastEsmBody).toBeUndefined();
      expect((globalThis as MaybeGlobal).__riftyLastEsmFile).toBeUndefined();
      // The owner-table root holds the value.
      const root = (globalThis as MaybeGlobal)[RUNTIME_JS_ROOT_KEY] as
        | Record<string, unknown>
        | undefined;
      expect(root).toBeDefined();
      expect(typeof root?.require).toBe('function');
    });
  });

  it('does not touch kernel-owned flat keys (__riftyKernel*)', () => {
    withClean(() => {
      const sentinel = { sentinel: true };
      (globalThis as MaybeGlobal).__riftyKernelSyncCall = sentinel;
      publishRuntimeGlobal('require', () => undefined);
      publishRuntimeGlobal('esmStash', {});
      // Re-confirm the kernel-owned flat key was not clobbered.
      expect((globalThis as MaybeGlobal).__riftyKernelSyncCall).toBe(sentinel);
      // Clean up the sentinel since we set it manually.
      Reflect.deleteProperty(globalThis as MaybeGlobal, '__riftyKernelSyncCall');
    });
  });
});
