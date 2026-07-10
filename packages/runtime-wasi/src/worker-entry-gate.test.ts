/**
 * Regression: the worker-entry top-level side-effect must run the WASI guest
 * ONLY when the kernel published a wasi-guest spec (one carrying the WASM-URL
 * key) — NOT in any worker realm. `@riftydev/runtime-js`'s `node:wasi` builtin
 * re-exports this module (via the package index), pulling it into the static
 * import graph of EVERY runtime-js worker (owner shell, dev-server child, the
 * worker_threads pthread children Rolldown spawns). Those graphs eval before the
 * kernel publishes a spec, so an unguarded `buildWasiProcess()` threw
 * "KernelProcessSpec is missing" and crashed the host worker on boot — hanging
 * the entire playground at `$ vite`.
 *
 * `runWasiGuestEntryIfActive()` is the extracted, unit-testable gate.
 */
import type { KernelProcessSpec } from '@riftydev/kernel';
import { afterEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ spec: null as KernelProcessSpec | null }));

vi.mock('@riftydev/kernel', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@riftydev/kernel')>();
  return { ...actual, readKernelProcessSpec: () => h.spec };
});

const { WASI_WASM_URL_ENV, runWasiGuestEntryIfActive } = await import('./worker-entry.ts');

// (module (import "wasi_snapshot_preview1" "proc_exit" (func (param i32)))
//   (func $_start (call 0 (i32.const 0))) (export "_start" (func $_start)))
const PROC_EXIT_0_B64 =
  'AGFzbQEAAAABCAJgAX8AYAAAAiQBFndhc2lfc25hcHNob3RfcHJldmlldzEJcHJvY19leGl0AAADAgEBBwoBBl9zdGFydAABCggBBgBBABAACw==';

function specWith(env: Record<string, string>): KernelProcessSpec {
  return {
    pid: 2,
    ppid: 1,
    argv: ['wasi-guest'],
    env,
    cwd: '/',
    capabilities: { stdin: 'unavailable', runtimeIpc: false },
    stdio: {
      stdout: new MessageChannel().port1,
      stderr: new MessageChannel().port1,
      stdin: new MessageChannel().port1,
      ipc: new MessageChannel().port1,
    },
  };
}

afterEach(() => {
  h.spec = null;
});

describe('runWasiGuestEntryIfActive (worker-entry gate)', () => {
  it('does NOT run (and does not throw) when no spec is published', async () => {
    h.spec = null; // static-graph eval in a host worker, before kernel `init`
    await expect(runWasiGuestEntryIfActive()).resolves.toBe(false);
  });

  it('does NOT run when the spec is not a wasi-guest spec (no WASM URL)', async () => {
    h.spec = specWith({ SOMETHING: 'else' }); // e.g. the owner/dev-server child spec
    await expect(runWasiGuestEntryIfActive()).resolves.toBe(false);
  });

  it('runs the guest when the spec carries the WASM URL (genuine wasi entry)', async () => {
    h.spec = specWith({ [WASI_WASM_URL_ENV]: `data:application/wasm;base64,${PROC_EXIT_0_B64}` });
    await expect(runWasiGuestEntryIfActive()).resolves.toBe(true);
  });
});
