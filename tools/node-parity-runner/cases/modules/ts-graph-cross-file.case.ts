import type { ParityCase } from '../../src/types.ts';

/**
 * GOLD-STANDARD parity case for Feature 02 (TS-on-import across a package
 * graph), the P0 acceptance signal at the unit-of-language level — independent
 * of any opencode VFS contents (ADR-0052, EXECUTION-LOG P0 closer).
 *
 * A two-file `.ts` graph proves three things at once, head-to-head against
 * Node-with-a-stripper (Node v24 strip-types vs the rifty esbuild WASI hook):
 *
 * 1. **Type-only erasure.** `b.ts` exports an `interface Box` and `a.ts` imports
 *    it as `type Box` and annotates a local with it. Both must vanish entirely
 *    after the strip — if `interface`/`type`-import survived to acorn it would
 *    be `SYNTAX_ERROR`; if the runtime tried to load `Box` as a real binding it
 *    would be a `ReferenceError`.
 * 2. **Value survival across files.** `const base` (a stripped type-annotated
 *    declaration) and `enum Color` are real runtime values that must cross the
 *    `b.ts` → `a.ts` ESM edge. `enum` lowers to an object, so `Color.G === 1`
 *    (members `R=0, G=1`); a stale type-strip that dropped the enum body would
 *    make `Color.G` `undefined` and the sum `NaN`.
 * 3. **Cross-file ESM load order.** `a.ts` imports from `b.ts`, which is imported
 *    by the entry; the computed `base + box.n + Color.G` (40 + 2 + 1) is only
 *    `43` if `b.ts` fully evaluated before `a.ts` read its bindings, matching
 *    Node's import-graph ordering.
 *
 * On the rifty side this runs through `createModuleLoader` with the REAL
 * vendored esbuild WASI transform hook (`buildTsTransform` in `run-in-rifty.ts`,
 * the same edge the headless opencode harness uses). If F02-T1 (`.ts`/`.tsx`
 * resolvable+ESM) or F02-T3 (the pre-acorn strip step) regressed, rifty would
 * either `MODULE_NOT_FOUND` on `./a.ts`/`./b.ts` (no `.ts` extension) or
 * `SYNTAX_ERROR` on the `interface`/`enum` (no strip) — Node prints `43` and the
 * stdouts diverge.
 */
const c: ParityCase = {
  kind: 'ts-esm',
  setup: {
    files: {
      'b.ts':
        'enum Color { R, G }; export interface Box { n: number } export const base: number = 40; export { Color }',
      'a.ts':
        'import { base, Color, type Box } from "./b.ts"; const box: Box = { n: 2 }; console.log(base + box.n + Color.G)',
    },
  },
  code: 'import "./a.ts"',
  expected: '43',
};

export default c;
