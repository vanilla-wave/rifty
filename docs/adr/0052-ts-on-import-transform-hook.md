# ADR 0052: TS-on-import transform hook on `ModuleLoaderOptions`

Status: Accepted
Date: 2026-05-30

## Context

opencode (the M12 facade target) is a `.ts` graph. ADR-0053 made `.ts`/`.tsx`
resolvable + ESM, but resolution is only half the story: `executeEsm`
(`esm.ts`) feeds `resolved.source` straight to acorn (`transformEsm`), so TS
syntax throws `SYNTAX_ERROR` unless its types are stripped / JSX lowered first.
The single-file WASI esbuild transform building block already exists and is
per-file stable with a real cwd preopen (`tools/shadow-registry`
`transformWithEsbuild`, ADR-0047/0049) — but `createModuleLoader`
(`loader.ts`) took only `{ cwd }` and had no injection point to reach it.

Spike A (the TS-strip round-trip premise that gated this chain) passed: a 3-file
`.ts` ESM graph with type annotations, an interface, and an enum strips through
the real esbuild WASI binary and round-trips cleanly through `transformEsm`
(acorn) — so the hook is wiring a verified pipeline, not a hypothetical one.

This ADR is the **transform-side** half of feature 02-ts-on-import-graph
(ADR-0053 is the **resolve-side** half). The two are deliberately decoupled.

## Decision

- **D1 — Injected `transformSource` hook on `ModuleLoaderOptions` (the
  load-bearing request shape).** Add two OPTIONAL public fields to
  `ModuleLoaderOptions` (`@riftydev/runtime-js/loader`):

  ```ts
  export type TransformSourceHook = (req: {
    readonly source: string;
    readonly id: string;                 // absolute resolved file path
    readonly loader: 'ts' | 'tsx' | 'jsx';
    readonly workspace: string;
  }) => Promise<string>;                  // returns stripped/lowered JS

  readonly workspace?: string;            // esbuild guest cwd/preopen
  readonly transformSource?: TransformSourceHook;
  ```

  The request-object shape `{ source, id, loader, workspace }` → `Promise<string>`
  is the load-bearing contract and is ratified here, not invented per-caller.

- **D2 — The loader carries zero new package import edges.** The caller (the
  headless harness) injects a closure that calls `transformWithEsbuild` from
  `tools/shadow-registry`. This mirrors the existing DI seam where the esbuild
  binding takes an injected `runWasi` precisely so the `tools/` package carries
  no kernel/vfs/runtime-wasi edge. `createModuleLoader` only grows its public
  option type by two optional fields; no new dependency, no layering inversion.

- **D3 — Async, ESM-only, extension-keyed.** The hook is `async` (esbuild via
  `runWasi` is async) and is invoked on the ESM execute path only, for files
  whose id ends `.ts`/`.tsx`/`.jsx`, with the loader chosen purely by extension
  (`.ts`→`'ts'`, `.tsx`→`'tsx'`, `.jsx`→`'jsx'`). When no hook is configured the
  source passes through unchanged — the directed transform-not-configured throw
  (and the CJS `.ts`-via-`require()` `NotImplementedError`) are owned by
  feature-02 T3/T4, not this ADR. opencode is `type:module`, so `.ts` → ESM and
  the async hook fits.

## Alternatives considered (rejected)

- **(B) Inline `import { transformWithEsbuild }` in `esm.ts`.** Rejected — pulls
  a `tools/` data-table package into runtime-js and forces a runtime-wasi edge,
  inverting the vfs→kernel→runtime layering the binding header explicitly
  avoids.
- **(C) Global singleton transform registry** (like `esmStash`). Reversible and
  needs no option change, but hides a hard data dependency in a global, is
  order-fragile, and is hard to test in isolation — weaker than explicit DI.

## Consequences

- Public surface of `@riftydev/runtime-js/loader` grows by two optional fields and
  one exported type (`TransformSourceHook`). Additive and optional: every
  existing caller compiles and behaves unchanged.
- `EsmLoaderDeps` (`esm.ts`) gains `workspace: string` and
  `transformSource?: TransformSourceHook`; `executeEsm` runs the hook before
  `transformEsm` for `.ts`/`.tsx`/`.jsx` ids. No-op for plain-JS modules.
- Future HMR / per-file invalidation and the transform cache (Q-2026-05-30-202)
  reuse this seam.
- If the transform later needs to be MANDATORY for arbitrary npm `.ts`, the
  field may need to become non-optional — a breaking follow-up captured then.

## Reversibility

IRREVERSIBLE (reversibility rule 1 — cross-package public API of
`@riftydev/runtime-js`). Additive + optional, but adopting callers would ripple on
revert. Recorded as an ADR because the request-object shape is a contract other
features (03/04/05) and the harness build against.

## References

- ADR-0053 (the resolve-side half — `.ts`/`.tsx` first-class extensions).
- ADR-0004 (module loader — "TypeScript / JSX support arrives as a transform
  step inserted before parsing"; this ADR is that step).
- ADR-0047/0049 (WASI esbuild binding + `runWasi` DI seam this hook injects).
- `docs/opencode/feature-02-ts-on-import-graph.md` (full feature design,
  T1..T9; this ADR ratifies T2's option surface).
- `docs/opencode/decisions.md` Section A, ADR-0052 draft (this, ratified).
- Reversible sub-decisions: Q-2026-05-30-201 (jsx default at caller),
  Q-2026-05-30-202 (transform cache), Q-2026-05-30-203 (single workspace root).
