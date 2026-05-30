# ADR 0053: `.ts`/`.tsx` as first-class resolvable + ESM module extensions

Status: Accepted
Date: 2026-05-30

## Context

opencode (the M12 facade target) is a `.ts` graph: a bare
`import { Session } from "@/session/session"` lands on `session.ts`, and the
package ships `"exports": { "./*": "./src/*.ts" }` with hundreds of internal
relative imports written without extensions or with `.ts`. The rifty resolver
(ADR-0004) never knew `.ts`/`.tsx` are resolvable: `DEFAULT_EXTENSIONS` and
`INDEX_FILES` (`resolver.ts:25-26`) listed only `.js`/`.mjs`/`.cjs`/`.json`, and
`detectKind` (`resolver.ts:437`) classified any unknown extension as CJS. So a
`.ts` target did not even resolve a file (`MODULE_NOT_FOUND`), and even if it
had, it would have been mis-classified CJS.

This ADR is the **resolve-side** half of feature 02-ts-on-import-graph. The
**transform-side** (stripping TS types via the WASI esbuild binding before the
AST ESM rewriter parses) is a separate, separable decision (the
`transformSource` hook on `ModuleLoaderOptions`, ADR-0052 draft). The two are
deliberately decoupled: a `.ts` may resolve here even with no transform
configured — it then throws a directed error at execute time (no silent stub),
which is more honest than pretending `.ts` does not exist.

Spike A (the TS-strip round-trip premise that gated this chain) passed: a 3-file
`.ts` ESM graph with type annotations, an interface, and an enum strips through
the real esbuild WASI binary and round-trips cleanly through `transformEsm`
(acorn) — so resolving `.ts` is not chasing an unverified transform path.

## Decision

- **D1 — `.ts`/`.tsx` are resolvable, after the `.js` family, before `.json`.**
  `DEFAULT_EXTENSIONS = ['.js','.mjs','.cjs','.ts','.tsx','.json']` and
  `INDEX_FILES` gains `'index.ts'`,`'index.tsx'` in the same relative order. The
  `.js` family stays FIRST so a plain-Node package shipping `foo.js` (or both
  `foo.js` and `foo.ts`) resolves byte-identically to Node — Node never resolves
  bare `.ts`, so the only way to stay parity-safe for existing packages is to let
  `.js` win.
- **D2 — `.ts`/`.tsx` classify as ESM under a `type:module` scope, else CJS.**
  `detectKind` extends its `.js` branch to `.ts`/`.tsx`: ESM iff the nearest
  package scope is `type:module`, else CJS — mirroring how a TS-aware Node loader
  classifies a source file by its package scope. opencode is `type:module`, so
  its `.ts` uniformly classifies ESM.
- **D3 — Resolve unconditionally; directed throw on transform-less execute.** No
  feature flag gating the new extensions. A `.ts` that resolves but reaches the
  ESM execute path with no `transformSource` hook throws a directed error
  (owned by the transform-side ADR-0052/feature-02 T3), never a silent stub.

## Deviation from ADR-0004 (Node resolution)

ADR-0004 specifies "Node algorithm … extension fallbacks". Node — without a
type-stripping loader configured — does NOT resolve a bare `.ts` specifier
(`MODULE_NOT_FOUND`). rifty now does. This is a **deliberate, scoped deviation**
required for the opencode facade and for any TS-on-import target. It cannot be
made byte-identical to vanilla Node by construction. The deviation is bounded by
D1's ordering: existing plain-JS packages are unaffected because `.js`/`.mjs`/
`.cjs` are tried first; only a package shipping ONLY a `.ts` (rare; some
Bun-first packages) resolves where Node would not. ADR-0004 is not superseded —
its resolver algorithm and CJS/ESM interop stand; this ADR extends its extension
fallback set and `detectKind` classification.

## Consequences

- `resolver.ts`: `DEFAULT_EXTENSIONS`/`INDEX_FILES` grow by two entries each;
  `detectKind`'s `.js` branch widens to `.ts`/`.tsx`. No signature change.
- Behaviour changes for ALL consumers of `@rifty/runtime-js` (the vite path, the
  conformance suite). Guarded by the both-exist parity assertion (a package with
  both `foo.js` and `foo.ts` still resolves `foo.js`).
- Conformance: `tests/conformance/modules/resolver.test.ts` `describe('TS
  extension resolution')` — (a) `foo.ts` resolves when `foo.js` absent; (b) the
  Node-deviation guard (`.js` wins when both exist); (c) directory `index.ts`;
  (d) `detectKind` esm-under-module / cjs-under-non-module.

## Reversibility

IRREVERSIBLE (reversibility rule 1 — observable cross-package behaviour of the
runtime resolver; rule 4 — the full feature spans `resolver.ts` + `esm.ts` +
`loader.ts`). The resolve-side change in THIS ADR is two list edits + one
`detectKind` branch in a single file; the transform-side wiring is gated
separately (ADR-0052 draft). Recorded as an ADR because it deviates from
ADR-0004's Node-resolution contract.

## References

- ADR-0004 (module loader — the Node resolution algorithm this extends/deviates
  from; "TypeScript / JSX support arrives as a transform step inserted before
  parsing").
- ADR-0047/0049 (WASI esbuild binding — the per-file transform building block
  the transform-side relies on).
- ADR-0052 draft (TS-on-import transform hook on `ModuleLoaderOptions` — the
  separable transform-side half).
- `docs/opencode/feature-02-ts-on-import-graph.md` (full feature design + T1..T9).
- `docs/opencode/decisions.md` Section A, ADR-0053 draft (this, ratified).
