# ADR 0053: `.ts`/`.tsx` as first-class resolvable + ESM module extensions

Status: Accepted
Date: 2026-05-30

> TL;DR: `.ts`/`.tsx` resolve after the `.js` family before `.json`, classify ESM/CJS by package scope, throwing a directed error if executed transform-less

> Correction 2026-07-24 (ADR-0316): resolution and the provider-neutral
> transform hook stand; references below to the vendored WASI binding describe
> the retired proof provider, not a current product path.

> Correction 2026-08-10 (ADR-0348): the TS-aware extension list remains the
> import resolver's deliberate deviation. Node 24 synchronous `require(ESM)`
> splits out Node's `.js`/`.json`/`.node` legacy fallback; `.mjs`, `.cjs`, and
> TS-family files require an explicit suffix on the require path.

## Context

opencode (the M12 facade target) is a `.ts` graph: `import { Session } from "@/session/session"` lands on `session.ts`, and the package ships `"exports": { "./*": "./src/*.ts" }` with hundreds of extensionless / `.ts` relative imports. The rifty resolver (ADR-0004) never treated `.ts`/`.tsx` as resolvable: `DEFAULT_EXTENSIONS`/`INDEX_FILES` (`resolver.ts:25-26`) listed only `.js`/`.mjs`/`.cjs`/`.json`, and `detectKind` (`resolver.ts:437`) classified any unknown extension as CJS. So a `.ts` target failed to resolve (`MODULE_NOT_FOUND`), and even if resolved, would be mis-classified CJS.

This is the **resolve-side** half of feature 02-ts-on-import-graph. The **transform-side** (stripping TS types via the WASI esbuild binding before the AST ESM rewriter parses — the `transformSource` hook on `ModuleLoaderOptions`, ADR-0052 draft) is a separable decision. Deliberately decoupled: a `.ts` may resolve here with no transform configured — it then throws a directed error at execute time (no silent stub), which is more honest than pretending `.ts` does not exist.

Spike A (the TS-strip round-trip premise gating this chain) passed: a 3-file `.ts` ESM graph with type annotations, an interface, and an enum strips through the real esbuild WASI binary and round-trips cleanly through `transformEsm` (acorn) — so resolving `.ts` is not chasing an unverified transform path.

## Decision

- **D1 — `.ts`/`.tsx` are resolvable, after the `.js` family, before `.json`.** `DEFAULT_EXTENSIONS = ['.js','.mjs','.cjs','.ts','.tsx','.json']`; `INDEX_FILES` gains `'index.ts'`,`'index.tsx'` in the same relative order. The `.js` family stays FIRST so a plain-Node package shipping `foo.js` (or both `foo.js` and `foo.ts`) resolves byte-identically to Node. Node never resolves bare `.ts`, so letting `.js` win is the only parity-safe option for existing packages.
- **D2 — `.ts`/`.tsx` classify ESM under a `type:module` scope, else CJS.** `detectKind` extends its `.js` branch to `.ts`/`.tsx`: ESM iff the nearest package scope is `type:module`, else CJS — mirroring a TS-aware Node loader. opencode is `type:module`, so its `.ts` uniformly classifies ESM.
- **D3 — Resolve unconditionally; directed throw on transform-less execute.** No feature flag. A `.ts` that resolves but reaches the ESM execute path with no `transformSource` hook throws a directed error (owned by transform-side ADR-0052/feature-02 T3), never a silent stub.

## Deviation from ADR-0004 (Node resolution)

ADR-0004 specifies "Node algorithm … extension fallbacks". Node — without a type-stripping loader — does NOT resolve a bare `.ts` specifier (`MODULE_NOT_FOUND`); rifty now does. This is a **deliberate, scoped deviation** required for the opencode facade and any TS-on-import target; it cannot be byte-identical to vanilla Node by construction. Bounded by D1's ordering: existing plain-JS packages are unaffected (`.js`/`.mjs`/`.cjs` tried first); only a package shipping ONLY a `.ts` (rare; some Bun-first packages) resolves where Node would not. ADR-0004 is **not superseded** — its resolver algorithm and CJS/ESM interop stand; this ADR extends its extension fallback set and `detectKind` classification.

## Consequences

- `resolver.ts`: `DEFAULT_EXTENSIONS`/`INDEX_FILES` grow by two entries each; `detectKind`'s `.js` branch widens to `.ts`/`.tsx`. No signature change.
- Behaviour changes for ALL consumers of `@riftydev/runtime-js` (vite path, conformance suite). Guarded by the both-exist parity assertion (`foo.js` + `foo.ts` still resolves `foo.js`).
- Conformance: `tests/conformance/modules/resolver.test.ts` `describe('TS extension resolution')` — (a) `foo.ts` resolves when `foo.js` absent; (b) Node-deviation guard (`.js` wins when both exist); (c) directory `index.ts`; (d) `detectKind` esm-under-module / cjs-under-non-module.

## Reversibility

IRREVERSIBLE (rule 1 — observable cross-package behaviour of the runtime resolver; rule 4 — the full feature spans `resolver.ts` + `esm.ts` + `loader.ts`). The resolve-side change in THIS ADR is two list edits + one `detectKind` branch in a single file; transform-side wiring is gated separately (ADR-0052 draft). Recorded as an ADR because it deviates from ADR-0004's Node-resolution contract.

## References

- ADR-0004 (module loader — the Node resolution algorithm this extends/deviates from; "TypeScript / JSX support arrives as a transform step inserted before parsing").
- ADR-0047/0049 (WASI esbuild binding — per-file transform building block the transform-side relies on).
- ADR-0052 draft (TS-on-import transform hook on `ModuleLoaderOptions` — the separable transform-side half).
- `docs/opencode/feature-02-ts-on-import-graph.md` (full feature design + T1..T9).
- `docs/opencode/decisions.md` Section A, ADR-0053 draft (this, ratified).
