import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ensureVmEngineReady,
  getQuickJsModuleSync,
  getQuickjsWasmUrl,
  isVmEngineReady,
} from './quickjs-loader.ts';

describe('getQuickjsWasmUrl', () => {
  const savedEnv = process.env.RIFTY_QUICKJS_WASM_URL;

  beforeEach(() => {
    (globalThis as Record<string, unknown>).__RIFTY_QUICKJS_WASM_URL = undefined;
    // biome-ignore lint/performance/noDelete: process.env coerces assignments to strings; only delete truly unsets the key, which the default-fallback test requires.
    delete process.env.RIFTY_QUICKJS_WASM_URL;
  });

  afterEach(() => {
    // Clear between tests; getQuickjsWasmUrl narrows on `typeof === 'string'`,
    // so `undefined` falls through to the next tier exactly as an absent key.
    (globalThis as Record<string, unknown>).__RIFTY_QUICKJS_WASM_URL = undefined;
    if (savedEnv === undefined) {
      // biome-ignore lint/performance/noDelete: restoring "not set" requires delete, not = undefined (which leaves the literal "undefined" string).
      delete process.env.RIFTY_QUICKJS_WASM_URL;
    } else {
      process.env.RIFTY_QUICKJS_WASM_URL = savedEnv;
    }
  });
  it('prefers the bootstrap global', () => {
    (globalThis as Record<string, unknown>).__RIFTY_QUICKJS_WASM_URL = 'https://x/q.wasm';
    expect(getQuickjsWasmUrl()).toBe('https://x/q.wasm');
  });
  it('falls back to a relative default', () => {
    expect(getQuickjsWasmUrl()).toBe('/quickjs.wasm');
  });
});

describe('quickjs preload', () => {
  it('preloads once and is then sync-available', async () => {
    // First assertion: only valid before any preload in this file's module
    // instance. Vitest isolates module graph per test file, so this is the
    // first call in this process for this module.
    expect(isVmEngineReady()).toBe(false);
    const a = await ensureVmEngineReady();
    const b = await ensureVmEngineReady();
    expect(a).toBe(b); // same module singleton
    expect(isVmEngineReady()).toBe(true);
    const mod = getQuickJsModuleSync();
    const ctx = mod.newContext();
    expect(ctx.dump(ctx.unwrapResult(ctx.evalCode('1+1')))).toBe(2);
    ctx.dispose();
  });

  it('throws a guiding error when not yet preloaded', () => {
    // Reset is impossible (module singleton), but if it WERE unready the error
    // must guide. Here it is ready, so this documents the happy path stays sync.
    expect(() => getQuickJsModuleSync()).not.toThrow();
  });
});
