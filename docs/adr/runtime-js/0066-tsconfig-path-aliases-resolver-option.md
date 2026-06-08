# ADR 0066: tsconfig-style path aliases via an explicit `paths` resolver option

Status: Accepted (opencode facade M12)
Date: 2026-06-01

> TL;DR: tsconfig `paths` aliases ride an opt-in `paths` map on `ModuleLoaderOptions` (caller reads tsconfig); off = Node-faithful, tsc-specificity match, miss falls through

## Context

The opencode GRAPH-LOAD smoke (`tests/integration/opencode-graph-load.opt-in.test.ts`)
cleared every earlier suspected blocker (undici's `node:diagnostics_channel`, the
`@effect/platform-node` builtin surface) and now hits a wall inside opencode's own
source graph:

```
Cannot find module '@/account/account'
  imported from packages/opencode/src/server/routes/instance/httpapi/server.ts
```

`@/` is opencode's tsconfig `paths` alias —
`packages/opencode/tsconfig.json` declares
`"paths": { "@/*": ["./src/*"], "@tui/*": ["./src/cli/cmd/tui/*"], "@test/*": ["./test/*"] }`.
The vendored `…/src/account/account.ts` exists, so this is a resolver gap, not a
vendoring gap. rifty's resolver (`packages/runtime-js/src/module-loader/resolver.ts`)
implements the Node algorithm (relative / absolute / bare-`node_modules` walk /
`exports` / `imports`#-map) but has no notion of tsconfig `paths`: `@/account/account`
falls into the bare branch, is mis-parsed as scope `@/account` + subpath `./account`,
finds no `node_modules/@/account`, and reports `MODULE_NOT_FOUND`.

**Relationship to ADR-0053.** ADR-0053 used `@/session/session` as its motivating
example but only delivered the *extension* half (`.ts`/`.tsx` resolvable); the *alias*
half (`@/` → package `src/`) was assumed by the example yet never implemented. This ADR
completes it. It does not contradict ADR-0053 (whose D1–D3 are purely extensions) — it
is the mechanism that example presupposed.

**Why Node doesn't do this.** Node — even with `--experimental-strip-types` — does not
read tsconfig or resolve `paths`; opencode relies on Bun (and tsc/esbuild/tsx) reading
`compilerOptions.paths`. rifty already took a ratified TS-on-import posture (ADR-0052
transform hook, ADR-0053 `.ts` resolvable) beyond vanilla Node for TS targets; resolving
`paths` is the next step on that posture. Made under ADR-0063/0064 standing authority —
the need is verified by the live smoke wall (an inflection, not a stop).

## Decision

- **D1 — Path aliases are an explicit, opt-in `paths` option on `ModuleLoaderOptions`,
  NOT auto-read from tsconfig.** The resolver gains `paths?: PathAliases` (a map
  `pattern → target | target[]`, targets being **absolute** VFS path patterns) and does
  pure pattern matching + file resolution. It does **not** discover `tsconfig.json`,
  follow `extends`, or interpret `baseUrl` — reading tsconfig and resolving targets to
  absolute patterns is a **caller** concern (done by the opencode smoke harness; a future
  playground "open a TS project" flow would do it). Keeps the core resolver Node-faithful
  by default (D2) and keeps `extends`/`baseUrl` semantics out of it.

- **D2 — Off by default = Node-faithful.** With no `paths`, resolution is byte-identical
  to today (Node algorithm + ADR-0053 `.ts` set). Bare `@/foo` with no map is
  `MODULE_NOT_FOUND`, as Node reports. No non-opt-in project is affected.

- **D3 — tsc-faithful matching.** At most one `*` per pattern. An exact (star-less)
  pattern matches only the whole specifier and outranks any wildcard. Among wildcards the
  most specific wins: longest static prefix, tie-broken by longest static suffix (the same
  longest-base/longest-trailer rule `exports`/`imports` `findWildcard` uses — one
  specificity model across the resolver). The chosen pattern's targets are tried in
  declared order; the `*` capture is substituted, and the first target resolving to an
  existing file (via normal file/dir/extension resolution) wins.

- **D4 — Alias miss falls through, never hard-fails.** If a pattern matches but no
  candidate resolves, fall through to normal resolution (bare `node_modules` walk), so a
  genuine miss still surfaces as `MODULE_NOT_FOUND` on the original specifier — matching
  tsc's paths-then-fallback and avoiding a misleading alias-specific error. Aliases are
  attempted only for non-relative, non-absolute specifiers (a real `@scope/pkg` is
  unaffected unless a `paths` pattern actually matches it).

## Consequences

- `resolver.ts`: new `PathAliases` type; `createResolver(vfs, { paths })` gains an
  optional second arg; `resolve()` tries `resolvePathAlias` before the bare branch for
  non-relative/non-absolute specifiers. No change to existing call paths when `paths` is
  absent.
- `loader.ts`: `ModuleLoaderOptions` gains `paths?: PathAliases`, forwarded to
  `createResolver`. `index.ts` re-exports `PathAliases`. Additive, optional.
- The opencode smoke harness reads `packages/opencode/tsconfig.json`'s
  `compilerOptions.paths`, resolves each target relative to the opencode package dir into
  absolute `/workspace/...` patterns, and passes them as `paths`. Clears the entire `@/`
  (and `@tui/`/`@test/`) alias class at once; remaining walls are then genuine
  missing-module (vendoring) or missing-builtin, found by re-running the smoke.
- Conformance: `tests/conformance/modules/resolver.test.ts` `describe('tsconfig path
  aliases')` pins wildcard resolution, extension resolution through an alias,
  longest-prefix specificity, exact-over-wildcard, ordered-candidate fallback, the
  off-by-default Node-faithfulness guard, and the no-false-positive guard (a real
  `@scope/pkg` still resolves through `node_modules` with a `@/*` alias present).

## Reversibility

IRREVERSIBLE (rule 1 — adds a public field to `ModuleLoaderOptions`, cross-package API).
No new external dependency (rule 2 — pure in-resolver string matching). Does not
contradict an existing ADR (completes the alias half ADR-0053 presupposed). Recorded as a
ratified ADR per ADR-0063/0064 standing authority.

The REVERSIBLE follow-on — automatic tsconfig discovery (locating `tsconfig.json`,
following `extends`, interpreting `baseUrl`, applying `paths` without a caller-supplied
map) — is deferred under `Q-2026-06-01-305`. Purely additive over this option (it would
compute the same `paths` map the caller now supplies); needs no ADR to add later.

## References

- ADR-0052 (TS-on-import transform hook on `ModuleLoaderOptions`) + ADR-0053 (`.ts`/`.tsx`
  first-class resolvable — this completes the alias half its example presupposed).
- ADR-0004 (the Node resolution algorithm this extends; `paths` is a scoped, opt-in,
  off-by-default deviation, so ADR-0004 is not superseded).
- ADR-0063/0064 (record-and-continue; the live smoke wall is a verified need, an
  inflection not a stop).
- `docs/opencode/HANDOFF.md` / `docs/opencode/README.md` (the GRAPH-LOAD gate and the
  `@/account/account` wall this clears).
- `Q-2026-06-01-305` (deferred automatic tsconfig discovery — the reversible follow-on).
