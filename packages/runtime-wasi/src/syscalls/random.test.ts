/**
 * Unit tests for `random_get` (lives in {@link ./proc.ts}).
 *
 * Regression coverage for two browser-only failure modes the old one-liner
 * (`crypto.getRandomValues(ctx.bytes().subarray(ptr, ptr+len))`) hit:
 *   1. `crypto.getRandomValues` REJECTS a view backed by a SharedArrayBuffer
 *      ("must not be shared") — threaded WASI modules (Rolldown's emnapi pthread
 *      build) run on shared wasm memory. Node does NOT enforce this, so we
 *      simulate the browser contract with a spy.
 *   2. `getRandomValues` caps a single call at 65536 bytes; a larger `len` threw
 *      `QuotaExceededError` (this one DOES reproduce in Node — no mock needed).
 */
import { describe, expect, it, vi } from 'vitest';
import { procSyscalls } from './proc.ts';
import { E_SUCCESS, type WasiCtx } from './shared.ts';

interface RandomNs {
  random_get: (ptr: number, len: number) => number;
}

function setupCtx(memory: WebAssembly.Memory): { ns: RandomNs; memory: WebAssembly.Memory } {
  const ctx: WasiCtx = {
    args: [],
    env: {},
    fds: new Map(),
    cwdFd: 3,
    nextFd: { value: 3 },
    exited: { value: false },
    exitCode: { value: 0 },
    onStdout: () => {},
    onStderr: () => {},
    onStdin: () => null,
    view: () => new DataView(memory.buffer),
    bytes: () => new Uint8Array(memory.buffer),
  };
  return { ns: procSyscalls(ctx) as unknown as RandomNs, memory };
}

describe('random_get', () => {
  it('never hands a SharedArrayBuffer-backed view to crypto.getRandomValues', () => {
    // Shared wasm memory (what a threaded WASI guest gets).
    const memory = new WebAssembly.Memory({ initial: 1, maximum: 1, shared: true });
    expect(memory.buffer).toBeInstanceOf(SharedArrayBuffer);
    const { ns } = setupCtx(memory);

    // Simulate the BROWSER contract Node lacks: getRandomValues throws on a
    // shared-backed view. The fix must fill a PRIVATE buffer, so the spy is only
    // ever called with a non-shared view.
    const spy = vi.spyOn(crypto, 'getRandomValues').mockImplementation((view) => {
      if (ArrayBuffer.isView(view) && view.buffer instanceof SharedArrayBuffer) {
        throw new TypeError("Failed to execute 'getRandomValues': value must not be shared.");
      }
      const u8 = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
      for (let i = 0; i < u8.length; i++) u8[i] = (i % 251) + 1; // deterministic non-zero
      return view;
    });

    try {
      const rc = ns.random_get(128, 64);
      expect(rc).toBe(E_SUCCESS);
    } finally {
      spy.mockRestore();
    }

    const out = new Uint8Array(memory.buffer, 128, 64);
    expect(out.every((b) => b !== 0)).toBe(true);
  });

  it('fills a >65536-byte request by chunking (getRandomValues per-call cap)', () => {
    // Non-shared memory: getRandomValues runs for real. The old code passed the
    // whole 70000-byte view in one call → QuotaExceededError.
    const memory = new WebAssembly.Memory({ initial: 2 }); // 128 KiB
    const { ns } = setupCtx(memory);
    const len = 70000;
    const rc = ns.random_get(0, len);
    expect(rc).toBe(E_SUCCESS);
    const out = new Uint8Array(memory.buffer, 0, len);
    // Bytes past the 65536 cap must also be randomised (not left zero).
    const tail = out.subarray(65536);
    expect(tail.some((b) => b !== 0)).toBe(true);
  });
});
