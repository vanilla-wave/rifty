/**
 * Real WASM round-trip. A hand-crafted minimal module imports
 * `wasi_snapshot_preview1.proc_exit` and calls it with a constant; the runner
 * must observe the exit code and surface it via `WasiExit`.
 *
 * The bytes are crafted once (see comments below) and committed inline so the
 * test has no build-step dependency on wabt / wat2wasm.
 */
import { describe, expect, it } from 'vitest';
import { Wasi, runWasi } from '../../../packages/runtime-wasi/src/wasi.ts';

// 82-byte WASM module equivalent to:
//   (module
//     (import "wasi_snapshot_preview1" "proc_exit" (func (param i32)))
//     (func $_start (call 0 (i32.const 42)))
//     (export "_start" (func $_start)))
const PROC_EXIT_42_B64 =
  'AGFzbQEAAAABCAJgAX8AYAAAAiQBFndhc2lfc25hcHNob3RfcHJldmlldzEJcHJvY19leGl0AAADAgEBBwoBBl9zdGFydAABCggBBgBBKhAACw==';

// 176-byte WASM equivalent to:
//   (module
//     (memory (export "memory") 1)
//     (data (i32.const 100) "OK")
//     (import "wasi_snapshot_preview1" "fd_write"
//       (func (param i32 i32 i32 i32) (result i32)))
//     (import "wasi_snapshot_preview1" "proc_exit" (func (param i32)))
//     (func (export "_start")
//       (i32.store (i32.const 0)   (i32.const 100))   ;; iov.buf
//       (i32.store (i32.const 4)   (i32.const 2))     ;; iov.len
//       (call 0 (i32.const 1) (i32.const 0) (i32.const 1) (i32.const 200))
//       drop
//       (call 1 (i32.const 0))))
const FD_WRITE_OK_B64 =
  'AGFzbQEAAAABEANgBH9/f38Bf2ABfwBgAAACRgIWd2FzaV9zbmFwc2hvdF9wcmV2aWV3MQhmZF93cml0ZQAAFndhc2lfc25hcHNob3RfcHJldmlldzEJcHJvY19leGl0AAEDAgECBQMBAAEHEwIGbWVtb3J5AgAGX3N0YXJ0AAIKIwEhAEEAQeQANgIAQQRBAjYCAEEBQQBBAUHIARAAGkEAEAELCwkBAEHkAAsCT0s=';

function bytesOf(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

describe('runWasi — real wasm', () => {
  it('observes proc_exit(42) from a hand-crafted module', async () => {
    const result = await runWasi(bytesOf(PROC_EXIT_42_B64));
    expect(result.exitCode).toBe(42);
    expect(result.stdout).toBe('');
  });

  it('Wasi.start direct call returns the same exit code', async () => {
    const wasi = new Wasi();
    const { instance } = await WebAssembly.instantiate(bytesOf(PROC_EXIT_42_B64), wasi.imports);
    expect(wasi.start(instance)).toBe(42);
  });

  it('fd_write from a real module lands in stdout', async () => {
    const result = await runWasi(bytesOf(FD_WRITE_OK_B64));
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('OK');
  });
});
