import { describe, expect, it } from 'vitest';
import { runWasi } from './wasi.ts';

// (module (func (export "_start")))  — the minimal WASI-shaped guest: empty
// `_start`, no imports, no memory (Wasi.start tolerates an absent memory export).
const TRIVIAL_WASI_START = new Uint8Array([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, // magic + version
  0x01, 0x04, 0x01, 0x60, 0x00, 0x00, // type: () -> ()
  0x03, 0x02, 0x01, 0x00, // func 0 : type 0
  0x07, 0x0a, 0x01, 0x06, 0x5f, 0x73, 0x74, 0x61, 0x72, 0x74, 0x00, 0x00, // export "_start"
  0x0a, 0x04, 0x01, 0x02, 0x00, 0x0b, // code: empty body
]);

describe('runWasi input forms', () => {
  it('runs from raw bytes', async () => {
    const result = await runWasi(TRIVIAL_WASI_START);
    expect(result.exitCode).toBe(0);
  });

  it('runs from a precompiled WebAssembly.Module — compile once, fresh instance per run', async () => {
    const module = await WebAssembly.compile(TRIVIAL_WASI_START);
    const first = await runWasi(module);
    const second = await runWasi(module);
    expect(first.exitCode).toBe(0);
    expect(second.exitCode).toBe(0);
  });
});
