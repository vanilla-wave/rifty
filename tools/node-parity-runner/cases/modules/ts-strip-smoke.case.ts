import type { ParityCase } from '../../src/types.ts';

/**
 * Smoke for the `ts-esm` kind: a single-file TypeScript module whose type
 * annotation must be stripped before execution. Node v24 strips types
 * natively when the entry is `main.ts`; the rifty side runs the SAME source
 * through `createModuleLoader` with the real esbuild WASI transform hook
 * (injected by `run-in-rifty.ts`). Both must print `42`.
 *
 * This is the harness prerequisite for the gold cross-file graph case: it
 * proves the runner threads the real esbuild type-strip end-to-end on both
 * sides (Node strip-types vs rifty esbuild-on-import).
 */
const c: ParityCase = {
  kind: 'ts-esm',
  code: 'const x: number = 41; console.log(x + 1)',
  expected: '42',
};

export default c;
