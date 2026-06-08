import type { ParityCase } from '../../src/types.ts';

/**
 * Cross-file `ts-esm` parity for the TS-only syntax the effect@4 / opencode
 * server graph actually leans on (verified against the vendored tree): a
 * type-only `import type`, a `const enum`, and a `satisfies` expression, threaded
 * across a two-file `.ts` import graph (ADR-0052 item 3 of the WIRE task).
 *
 * This complements `ts-graph-cross-file.case.ts` (which pins `interface` / inline
 * `type`-import / plain `enum`). The constructs here are the ones opencode emits
 * but that case did not cover:
 *
 *  1. **`import type { … }` statement.** `a.ts` imports `Box` via a dedicated
 *     `import type` statement (not the inline `import { type X }` form). It must
 *     be erased entirely — if it survived to acorn it would parse as a runtime
 *     import of a non-existent binding (`Box` is an interface) and the executed
 *     module would `ReferenceError`. opencode uses `import type` pervasively
 *     (e.g. `core/src/account.ts`, `core/src/plugin.ts`).
 *  2. **`const enum`.** `b.ts` declares `const enum Priority { Low, High }`.
 *     esbuild (and the Node-side `tsx`, also esbuild) lower a `const enum` to a
 *     real runtime object exactly like a plain `enum` (NO inlining without
 *     `--minify`), so `Priority.High === 1` must cross the `b.ts -> a.ts` ESM
 *     edge as a live value. A strip-only path (Node's `--experimental-strip-types`)
 *     would THROW `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` here — which is exactly why
 *     the runner pins the Node reference to a full `tsx` transform. opencode uses
 *     `const enum` (e.g. `opencode/src/cli/.../bg-pulse-render.ts`).
 *  3. **`satisfies`.** `b.ts` builds `base` with a `satisfies` clause; the
 *     operator is type-only and must be erased, leaving the object value intact.
 *     opencode uses `satisfies` widely (e.g. `core/src/process.ts`,
 *     `core/src/git.ts`, several migrations).
 *
 * On the rifty side this runs through `createModuleLoader` with the REAL vendored
 * esbuild WASI transform hook (`buildTsTransform` in `run-in-rifty.ts`) — the
 * same edge the headless opencode harness uses. Both sides print `43`
 * (base.n=40 + box.n=2 + Priority.High=1) only if every construct erased/lowered
 * correctly AND `b.ts` fully evaluated before `a.ts` read its bindings.
 *
 * NOTE on decorators: the WIRE task lists decorators alongside these. They are
 * deliberately NOT exercised here — esbuild with no tsconfig leaves stage-3
 * `@decorator` syntax UN-lowered (passthrough), and rifty's post-strip acorn
 * parse (`ecmaVersion:'latest'`, no decorators plugin) then rejects it, whereas
 * the Node-side `tsx` fully lowers it. That asymmetry is a real rifty-pipeline
 * gap, but decorators are NOT on opencode's source-transform path (the grep
 * across the vendored tree finds none), so faking a green parity case for them
 * would be dishonest. The gap is recorded in `docs/public/compat/modules.md`
 * + docs/backlog/ (Q-2026-05-31-304) instead.
 */
const c: ParityCase = {
  kind: 'ts-esm',
  setup: {
    files: {
      'b.ts':
        'const enum Priority { Low, High }\n' +
        'export interface Box { n: number }\n' +
        'export const base = { n: 40 } satisfies Box;\n' +
        'export { Priority };\n',
      'a.ts':
        "import { base, Priority } from './b.ts';\n" +
        "import type { Box } from './b.ts';\n" +
        'const box: Box = { n: 2 };\n' +
        'console.log(base.n + box.n + Priority.High);\n',
    },
  },
  code: "import './a.ts';",
  expected: '43',
};

export default c;
