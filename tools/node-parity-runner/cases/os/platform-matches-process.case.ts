import type { ParityCase } from '../../src/types.ts';

/**
 * ADR-0026 requires `process.platform === 'rifty'` and `process.arch === 'wasm'`
 * (public ABI). `os.platform()` / `os.arch()` MUST mirror those values so the
 * common `os.platform() === process.platform` check keeps working.
 *
 * Node and rifty disagree on the literal strings (Node returns
 * 'darwin'/'linux'/'win32' and 'x64'/'arm64'; rifty returns 'rifty'/'wasm'),
 * so this case can only pin invariants that hold in BOTH runtimes:
 *   - typeof os.platform() === 'string'
 *   - typeof os.arch() === 'string'
 *   - `os.platform()` matches the `process.platform` reported by the SAME
 *     runtime — i.e. consistency between the `node:os` shim and the
 *     `node:process` shim within rifty. We reach the runtime's own process
 *     module via `require('node:process')` (rifty registers
 *     `riftyProcess` there); in Node that resolves to the real `process`.
 *
 * The actual exact-value contract (`os.platform() === 'rifty'`) is pinned by
 * the unit test in `packages/runtime-js/src/builtins/os.test.ts`.
 */
const c: ParityCase = {
  code: `
    const os = require('node:os');
    const proc = require('node:process');
    console.log(typeof os.platform());
    console.log(typeof os.arch());
    console.log(os.platform() === proc.platform);
    console.log(os.arch() === proc.arch);
  `,
};

export default c;
