# ADR 0066: tsconfig-style path aliases via an explicit `paths` resolver option

Status: Accepted (opencode facade M12)
Date: 2026-06-01

## Context

The opencode GRAPH-LOAD smoke (`tests/integration/opencode-graph-load.opt-in.test.ts`)
walked past every previously-suspected blocker — undici's `node:diagnostics_channel`
and the rest of the `@effect/platform-node` builtin surface (`node:util.debuglog`,
`node:console`, `node:util/types`, `node:worker_threads` markers, `node:dgram`) —
and now hits an exact wall **inside opencode's own source graph**:

```
Cannot find module '@/account/account'
  imported from packages/opencode/src/server/routes/instance/httpapi/server.ts
```

`@/` is opencode's **tsconfig `paths` alias** —
`packages/opencode/tsconfig.json` declares
`"paths": { "@/*": ["./src/*"], "@tui/*": ["./src/cli/cmd/tui/*"], "@test/*": ["./test/*"] }`.
The vendored `account.ts` **exists** (`…/src/account/account.ts`), so this is not a
vendoring gap — it is a resolver gap. rifty's resolver
(`packages/runtime-js/src/module-loader/resolver.ts`) implements the Node algorithm
(relative / absolute / bare-`node_modules` walk / `exports` / `imports`#-map) but has
**no notion of tsconfig `paths`**: `@/account/account` falls into the bare-specifier
branch, is mis-parsed as scope `@/account` + subpath `./account`, finds no
`node_modules/@/account`, and reports `MODULE_NOT_FOUND`.

**Relationship to ADR-0053.** ADR-0053's Context prose used `import { Session } from
"@/session/session"` as its motivating example and said it "lands on `session.ts`".
That ADR only delivered the **extension** half — `.ts`/`.tsx` became resolvable. The
**alias** half — mapping `@/` to the package's `src/` — was silently assumed by that
example but never implemented. This ADR completes the missing alias half. It does
**not** contradict ADR-0053 (whose D1–D3 are purely about extensions); it is the
mechanism that example presupposed.

**Why Node doesn't do this.** Node — even with `--experimental-strip-types` — does
NOT read tsconfig and does NOT resolve `paths` aliases. opencode relies on Bun (and
tsc/esbuild/tsx in other tools) reading `compilerOptions.paths`. rifty has already
taken a deliberate, ratified TS-on-import posture (ADR-0052 transform hook, ADR-0053
`.ts` resolvable) that goes beyond vanilla Node for TS targets. Resolving tsconfig
`paths` is the next step on that same posture: a TS-on-import runtime that wants to
run real TS/Bun projects must honour their alias maps. This decision is made under
ADR-0063/0064 standing authority (the need is verified by the live smoke wall — an
inflection, not a stop).

## Decision

- **D1 — Path aliases are an explicit, opt-in `paths` option on
  `ModuleLoaderOptions`, NOT auto-read from tsconfig.** The resolver gains a
  `paths?: PathAliases` option (a map `pattern → target | target[]`, where targets
  are **absolute** VFS path patterns). The core resolver does pure pattern matching
  + file resolution; it does **not** discover `tsconfig.json`, follow `extends`
  chains, or interpret `baseUrl`. Reading a project's tsconfig and resolving its
  `paths` targets to absolute patterns is a **caller concern** (the opencode smoke
  harness does it; a future playground "open a TS project" flow would do it). This
  keeps the core resolver Node-faithful by default (rule below) and keeps the thorny
  `extends`/`baseUrl` semantics out of the layer that must stay small and correct.

- **D2 — Off by default = Node-faithful.** With no `paths` option, resolution is
  byte-identical to today (Node algorithm + the ADR-0053 `.ts` extension set). A
  bare `@/foo` with no `paths` map is `MODULE_NOT_FOUND`, exactly as Node reports it.
  No project that does not opt in is affected.

- **D3 — tsc-faithful matching semantics.** Patterns may contain at most one `*`.
  An **exact** (star-less) pattern matches only the whole specifier and outranks any
  wildcard. Among wildcard patterns, the **most specific** wins: longest static
  prefix, tie-broken by longest static suffix (the same longest-base/longest-trailer
  rule the `exports`/`imports` `findWildcard` already uses, for one consistent
  specificity model across the resolver). The chosen pattern's targets are tried in
  declared order; the `*` capture is substituted into each, and the **first** target
  that resolves to an existing file (via the normal file/dir/extension resolution)
  wins.

- **D4 — Alias miss falls through, never hard-fails.** If a pattern matches but no
  candidate target resolves to a file, the resolver falls through to normal
  resolution (bare `node_modules` walk), so a genuine miss still surfaces as
  `MODULE_NOT_FOUND` on the original specifier — matching tsc's paths-then-fallback
  behaviour and avoiding a misleading alias-specific error. Aliases are attempted
  only for non-relative, non-absolute specifiers (a `@scope/pkg` real package is
  unaffected unless a `paths` pattern actually matches it).

## Consequences

- `resolver.ts`: new `PathAliases` type, `createResolver(vfs, { paths })` gains an
  optional second argument, and `resolve()` attempts `resolvePathAlias` before the
  bare branch for non-relative/non-absolute specifiers. No change to any existing
  call path when `paths` is absent.
- `loader.ts`: `ModuleLoaderOptions` gains `paths?: PathAliases`, forwarded to
  `createResolver`. `index.ts` re-exports `PathAliases`. Additive, optional.
- The opencode smoke harness reads `packages/opencode/tsconfig.json`'s
  `compilerOptions.paths`, resolves each target relative to the opencode package dir
  into absolute `/workspace/...` patterns, and passes them as `paths`. This clears
  the **entire `@/` (and `@tui/`/`@test/`) alias class at once**, not just
  `@/account/account` — every remaining wall past it is then a genuine
  missing-module (vendoring) or missing-builtin, found by re-running the smoke.
- Conformance: `tests/conformance/modules/resolver.test.ts` `describe('tsconfig path
  aliases')` pins wildcard resolution, extension resolution through an alias,
  longest-prefix specificity, exact-over-wildcard, ordered-candidate fallback, the
  off-by-default Node-faithfulness guard, and the no-false-positive guard (a real
  `@scope/pkg` still resolves through `node_modules` with a `@/*` alias present).

## Reversibility

IRREVERSIBLE (reversibility rule 1 — adds a public field to `ModuleLoaderOptions`,
cross-package API). No new external dependency (rule 2 — pure in-resolver string
matching). Does not contradict an existing ADR (it completes the alias half ADR-0053
presupposed). Recorded as a ratified ADR per ADR-0063/0064 standing authority.

The REVERSIBLE follow-on — **automatic tsconfig discovery** (locating
`tsconfig.json`, following `extends`, interpreting `baseUrl`, applying `paths`
without an explicit caller-supplied map) — is deferred under `Q-2026-06-01-305`. It
is purely additive over this option (it would compute the same `paths` map the
caller now supplies) and needs no ADR to add later.

## References

- ADR-0052 (TS-on-import transform hook on `ModuleLoaderOptions`) + ADR-0053
  (`.ts`/`.tsx` first-class resolvable — this completes the alias half its example
  presupposed).
- ADR-0004 (the Node resolution algorithm this extends; `paths` is a scoped
  deviation, opt-in and off-by-default, so ADR-0004 is not superseded).
- ADR-0063/0064 (record-and-continue; the live smoke wall is a verified need, an
  inflection not a stop).
- `docs/opencode/HANDOFF.md` / `docs/opencode/README.md` (the GRAPH-LOAD gate and the
  `@/account/account` wall this clears).
- `Q-2026-06-01-305` (deferred automatic tsconfig discovery — the reversible
  follow-on).
