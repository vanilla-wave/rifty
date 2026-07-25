import type { ParityCase } from '../../src/types.ts';

/**
 * Smoke for the `ts-esm` kind: a single-file TypeScript module whose type
 * annotation must be stripped before execution. Node v24 strips types
 * through full-transform `tsx`; the rifty side runs the SAME source through
 * `createModuleLoader` with exact workspace esbuild injected by the Node-only
 * harness. Both must print `42`.
 *
 * This is the harness prerequisite for the gold cross-file graph case: it
 * proves the runner threads real esbuild lowering through the loader.
 */
const c: ParityCase = {
  kind: 'ts-esm',
  code: 'const x: number = 41; console.log(x + 1)',
  expected: '42',
};

export default c;
