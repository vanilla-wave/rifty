/**
 * Real WASM round-trip. A hand-crafted minimal module imports
 * `wasi_snapshot_preview1.proc_exit` and calls it with a constant; the runner
 * must observe the exit code and surface it via `WasiExit`.
 *
 * The bytes are crafted once (see comments below) and committed inline so the
 * test has no build-step dependency on wabt / wat2wasm.
 */
import { syncMirror } from '@riftydev/vfs';
import { resetSyncMirror } from '@riftydev/vfs/internal';
import { afterEach, describe, expect, it } from 'vitest';
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

// 443-byte WASM equivalent to:
//   (module
//     (memory (export "memory") 1)
//     (data (i32.const 1000) "|")
//     (import "wasi_snapshot_preview1" "fd_write"
//       (func (param i32 i32 i32 i32) (result i32)))
//     (import "wasi_snapshot_preview1" "args_sizes_get"
//       (func (param i32 i32) (result i32)))
//     (import "wasi_snapshot_preview1" "args_get"
//       (func (param i32 i32) (result i32)))
//     (import "wasi_snapshot_preview1" "environ_sizes_get"
//       (func (param i32 i32) (result i32)))
//     (import "wasi_snapshot_preview1" "environ_get"
//       (func (param i32 i32) (result i32)))
//     (import "wasi_snapshot_preview1" "proc_exit" (func (param i32)))
//     (func (export "_start")
//       ;; args sizes -> args_get, environ sizes -> environ_get.
//       ;; fd_write writes arg bytes, "|", then environ bytes.
//       ;; Any non-zero errno exits non-zero via proc_exit.))
const ARGS_ENV_PROOF_B64 =
  'AGFzbQEAAAABFgRgBH9/f38Bf2ACf38Bf2ABfwBgAAAC4AEGFndhc2lfc25hcHNob3RfcHJldmlldzEIZmRfd3JpdGUAABZ3YXNpX3NuYXBzaG90X3ByZXZpZXcxDmFyZ3Nfc2l6ZXNfZ2V0AAEWd2FzaV9zbmFwc2hvdF9wcmV2aWV3MQhhcmdzX2dldAABFndhc2lfc25hcHNob3RfcHJldmlldzERZW52aXJvbl9zaXplc19nZXQAARZ3YXNpX3NuYXBzaG90X3ByZXZpZXcxC2Vudmlyb25fZ2V0AAEWd2FzaV9zbmFwc2hvdF9wcmV2aWV3MQlwcm9jX2V4aXQAAgMCAQMFAwEAAQcTAgZtZW1vcnkCAAZfc3RhcnQABgqNAQGKAQBBAEEEEAEEQEEBEAUAC0EQQcAAEAIEQEECEAUAC0EIQQwQAwRAQQMQBQALQYABQYACEAQEQEEEEAUAC0GABEHAADYCAEGEBEEEKAIANgIAQYgEQegHNgIAQYwEQQE2AgBBkARBgAI2AgBBlARBDCgCADYCAEEBQYAEQQNB2AQQAARAQQUQBQALCwsIAQBB6AcLAXw=';

// 335-byte WASM equivalent to:
//   (module
//     (memory (export "memory") 1)
//     (data (i32.const 100) "input.txt")
//     (import "wasi_snapshot_preview1" "fd_write"
//       (func (param i32 i32 i32 i32) (result i32)))
//     (import "wasi_snapshot_preview1" "fd_read"
//       (func (param i32 i32 i32 i32) (result i32)))
//     (import "wasi_snapshot_preview1" "path_open"
//       (func (param i32 i32 i32 i32 i32 i64 i64 i32 i32) (result i32)))
//     (import "wasi_snapshot_preview1" "proc_exit" (func (param i32)))
//     (func (export "_start")
//       ;; path_open fd 3 + "input.txt", fd_read opened fd, fd_write stdout.
//       ;; Any non-zero errno exits non-zero via proc_exit.))
const PATH_OPEN_READ_B64 =
  'AGFzbQEAAAABHQRgBH9/f38Bf2AJf39/f39+fn9/AX9gAX8AYAAAAooBBBZ3YXNpX3NuYXBzaG90X3ByZXZpZXcxCGZkX3dyaXRlAAAWd2FzaV9zbmFwc2hvdF9wcmV2aWV3MQdmZF9yZWFkAAAWd2FzaV9zbmFwc2hvdF9wcmV2aWV3MQlwYXRoX29wZW4AARZ3YXNpX3NuYXBzaG90X3ByZXZpZXcxCXByb2NfZXhpdAACAwIBAwUDAQABBxMCBm1lbW9yeQIABl9zdGFydAAECmkBZwBBA0EAQeQAQQlBAEIAQgBBAEEUEAIEQEEBEAMAC0EgQcgBNgIAQSRBIDYCAEEUKAIAQSBBAUEoEAEEQEECEAMAC0EwQcgBNgIAQTRBKCgCADYCAEEBQTBBAUE8EAAEQEEDEAMACwsLEAEAQeQACwlpbnB1dC50eHQ=';

// 261-byte WASM equivalent to:
//   (module
//     (memory (export "memory") 1)
//     (data (i32.const 100) "CLOCK_OK")
//     (import "wasi_snapshot_preview1" "fd_write"
//       (func (param i32 i32 i32 i32) (result i32)))
//     (import "wasi_snapshot_preview1" "clock_time_get"
//       (func (param i32 i64 i32) (result i32)))
//     (import "wasi_snapshot_preview1" "proc_exit" (func (param i32)))
//     (func (export "_start")
//       ;; clock_time_get realtime into 0; exit if errno or timestamp is zero.
//       ;; fd_write "CLOCK_OK" on success.))
const CLOCK_TIME_NONZERO_B64 =
  'AGFzbQEAAAABFwRgBH9/f38Bf2ADf35/AX9gAX8AYAAAAm4DFndhc2lfc25hcHNob3RfcHJldmlldzEIZmRfd3JpdGUAABZ3YXNpX3NuYXBzaG90X3ByZXZpZXcxDmNsb2NrX3RpbWVfZ2V0AAEWd2FzaV9zbmFwc2hvdF9wcmV2aWV3MQlwcm9jX2V4aXQAAgMCAQMFAwEAAQcTAgZtZW1vcnkCAAZfc3RhcnQAAwpDAUEAQQBCAEEAEAEEQEEBEAIAC0EAKQMAUARAQQIQAgALQSBB5AA2AgBBJEEINgIAQQFBIEEBQTAQAARAQQMQAgALCwsPAQBB5AALCENMT0NLX09L';

// 360-byte WASM equivalent to:
//   (module
//     (memory (export "memory") 1)
//     (data (i32.const 100) "\7f" x 64)
//     (data (i32.const 200) "RANDOM_OK")
//     (import "wasi_snapshot_preview1" "fd_write"
//       (func (param i32 i32 i32 i32) (result i32)))
//     (import "wasi_snapshot_preview1" "random_get"
//       (func (param i32 i32) (result i32)))
//     (import "wasi_snapshot_preview1" "proc_exit" (func (param i32)))
//     (func (export "_start")
//       ;; random_get over sentinel bytes; scan until any byte changed.
//       ;; fd_write "RANDOM_OK" only if errno is zero and buffer changed.))
const RANDOM_GET_CHANGED_B64 =
  'AGFzbQEAAAABFgRgBH9/f38Bf2ACf38Bf2ABfwBgAAACagMWd2FzaV9zbmFwc2hvdF9wcmV2aWV3MQhmZF93cml0ZQAAFndhc2lfc25hcHNob3RfcHJldmlldzEKcmFuZG9tX2dldAABFndhc2lfc25hcHNob3RfcHJldmlldzEJcHJvY19leGl0AAIDAgEDBQMBAAEHEwIGbWVtb3J5AgAGX3N0YXJ0AAMKZAFiAQF/QeQAQcAAEAEEQEEBEAIAC0EAIQACQANAQeQAIABqLQAAQf8ARw0BIABBAWohACAAQcAASQ0AC0ECEAIAC0EgQcgBNgIAQSRBCTYCAEEBQSBBAUEwEAAEQEEDEAIACwsLVgIAQeQAC0B/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/f39/AEHIAQsJUkFORE9NX09L';

function bytesOf(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

describe('runWasi — real wasm', () => {
  afterEach(() => resetSyncMirror());

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

  it('args and environ syscalls expose guest bytes to real wasm', async () => {
    const result = await runWasi(bytesOf(ARGS_ENV_PROOF_B64), {
      args: ['wasi-guest', '--flag=ok'],
      env: { RIFTY_ENV: 'present', MODE: 'test' },
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('wasi-guest\0--flag=ok\0|RIFTY_ENV=present\0MODE=test\0');
  });

  it('path_open lets real wasm read a preopened workspace file', async () => {
    const fs = syncMirror();
    fs.mkdirSync('/workspace', { recursive: true });
    fs.writeFileSync('/workspace/input.txt', new TextEncoder().encode('PATH-OK'));

    const result = await runWasi(bytesOf(PATH_OPEN_READ_B64), {
      preopens: { '/workspace': '/workspace' },
      cwd: '/workspace',
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('PATH-OK');
  });

  it('clock_time_get returns a nonzero timestamp to real wasm', async () => {
    const result = await runWasi(bytesOf(CLOCK_TIME_NONZERO_B64));
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('CLOCK_OK');
  });

  it('random_get changes a sentinel buffer for real wasm', async () => {
    const result = await runWasi(bytesOf(RANDOM_GET_CHANGED_B64));
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('RANDOM_OK');
  });
});
