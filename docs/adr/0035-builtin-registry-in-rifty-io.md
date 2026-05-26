# ADR 0035: Builtin registry in `@rifty/io`

Status: Accepted
Date: 2026-05-26

## Context

ADR-0012 promoted `@rifty/io` to the shared-primitives layer and moved
`EventEmitter`, `Buffer`, streams, and `NotImplementedError` out of
`@rifty/runtime-js`. Its implementation note (line 42) consciously left
the `node:` builtin **registry** itself in `@rifty/runtime-js/src/builtins/registry.ts`
and called the residual `@rifty/net → @rifty/runtime-js` link "a
forward-direction wiring call from a higher-layer side-effect entrypoint,
not a reverse import of primitives."

Re-reading the layer rule in CLAUDE.md
(`vfs → kernel → runtime-* → net/shell → npm-client → playground`) and
`pnpm check:deps` against the current tree, that residual link is in fact
a reverse import. `packages/net/package.json:21` declares
`"@rifty/runtime-js": "workspace:*"`, used at exactly one site —
`packages/net/src/register-builtins.ts:8`:

```ts
import { registerBuiltin } from '@rifty/runtime-js';
```

The architecture review (`docs/review/2026-05-26-architecture-review.md`,
Tier 1) and the historical note in `TASKS.md:18` ("Typecheck was broken
(workspace-wide): reverse imports `kernel → runtime-js`, deep paths into
`runtime-js/src/builtins/*` from `net`...") trace the same problem: the
registry's *implementation* sits in the wrong package.

The registry implementation itself
(`packages/runtime-js/src/builtins/registry.ts`) is a generic
key → factory cache. It has no Node-specific behaviour:

```ts
export type BuiltinFactory = () => Record<string, unknown>;
export function registerBuiltin(name, factory): void;
export function isBuiltinSpecifier(specifier): boolean;
export function loadBuiltin(specifier): Record<string, unknown> | null;
export function listBuiltins(): string[];
```

Strips the `node:` prefix and looks up a factory in a `Record`. Nothing
in there requires Node-shape knowledge, the worker, the loader, or any
runtime-js internal. It is the same kind of pure-primitive utility as
`NotImplementedError` or `EventEmitter` — the rationale ADR-0012 used for
those applies verbatim.

## Decision

Move the registry implementation into `@rifty/io`. Both `@rifty/runtime-js`
(which calls `loadBuiltin` from the module loader and `listBuiltins` from
the `node:module` shape) and `@rifty/net` (which calls `registerBuiltin`
in its side-effect entrypoint) already depend on `@rifty/io`, so the
import direction stays top-down through every consumer.

Concretely:

- New file `packages/io/src/builtin-registry.ts` holds the implementation
  verbatim — same public API (`registerBuiltin`, `isBuiltinSpecifier`,
  `loadBuiltin`, `listBuiltins`, `BuiltinFactory`), same behaviour, same
  cache semantics.
- `@rifty/io`'s `src/index.ts` re-exports the surface.
- `packages/runtime-js/src/builtins/registry.ts` is deleted. It was an
  internal module not listed in `runtime-js`'s subpath exports
  (`./builtins/{fs-watch,process,timers,buffer,module}` only), so no
  external consumer reached it directly.
- `packages/runtime-js/src/builtins/index.ts` and
  `packages/runtime-js/src/builtins/module.ts` import the registry from
  `@rifty/io` instead of `./registry.ts`.
- `packages/net/src/register-builtins.ts` imports `registerBuiltin` from
  `@rifty/io` instead of `@rifty/runtime-js`.
- `packages/net/package.json` drops the `@rifty/runtime-js` dependency.

The registry's public-API shape does not change. Existing tests (the
runtime-js `builtins/*` test suites and conformance tests for
`Module.builtinModules`) are the contract; they continue to pass against
the new location with the import paths updated.

## Consequences

- Layer diagram is now truthful end-to-end: `pnpm check:deps` shows no
  `net → runtime-js` edge. The historical TASKS.md note ("one reverse
  import was traded for another") is closed.
- `@rifty/io`'s public surface gains four functions + one type. The
  surface is small, the implementation is ~40 lines, and there is one
  module-level mutable map (`factories` + `cache`) which is the
  process-wide registry singleton — same singleton scope as before, just
  in a different package.
- `@rifty/runtime-js`'s public surface (the top-level
  `registerBuiltin`/`isBuiltinSpecifier`/`listBuiltins`/`BuiltinFactory`
  re-exports in `src/index.ts`) is preserved verbatim by re-exporting
  from `@rifty/io` through the existing `src/builtins/index.ts` barrel.
  External callers of `@rifty/runtime-js` see no breaking change.
- `packages/runtime-js/src/builtins/registry.ts` (the internal module)
  is deleted, not stub-shimmed. The subpath-exports list in
  `runtime-js/package.json` does not include `./builtins/registry`, so
  no public path is affected. No `// TODO(ADR)` carryover.
- The `register-builtins.ts` side-effect pattern is unchanged — the
  comment in that file ("registers `node:net`, `node:http`, `node:https`
  shapes with runtime-js's builtin loader. Keeping registration here,
  rather than in runtime-js, preserves the top-down layering rule")
  remains accurate: registration still happens from `net`, the only
  thing that changes is *where* the registration function is imported
  from.

### Alternatives considered

#### Option B: put the registry in `@rifty/kernel`

`kernel` sits between `io` and `runtime-*` in the layer order, so it
would also produce a valid forward-only import graph (kernel → both
runtime-js and net depend on it). Rejected because `kernel`'s declared
scope is processes / IPC / sync RPC (ADR-0011, ADR-0032), not a generic
key-value registry. Putting an unrelated key → factory map there would
muddy that scope. `io`'s "shared Node-compatible primitives" scope
(ADR-0012) is the precise fit.

#### Option C: leave the registry in `runtime-js` and remove the import some other way

The two options for keeping the registry in `runtime-js` are
(a) inline `registerBuiltin` calls in `runtime-js` itself for the
`net`/`http`/`https` builtins, or
(b) introduce a callback-injection scheme where `runtime-js` registers
its own hooks that `net` calls during bootstrap.

Both reintroduce a `net` source dependency inside `runtime-js`, either
syntactically (option a — `runtime-js` would have to know about `net`
shapes) or semantically (option b — every new higher-layer registrant
needs a matching hook). Both contradict the design goal of the
`register-builtins.ts` side-effect entrypoint: higher layers plug
themselves in, lower layers expose a registry. Rejected.

#### Option D: defer to M11

The reverse-import edge has been live since ADR-0012 landed and CI
(`pnpm check:deps`) does not currently flag it because `madge` only
catches circular cycles, not directional violations. The longer we
defer the edge, the more risk of a true cycle slipping in via a future
`net → io → ... → net` route or a follow-up that adds another
`@rifty/runtime-js`-only API to `net`'s deps. Fixing it now closes the
window. Rejected.

## References

- ADR-0012 — original `@rifty/io` promotion; this ADR builds on its
  scope decision.
- `docs/review/2026-05-26-architecture-review.md` — architecture review
  that recorded the residual reverse import as still open.
- `TASKS.md:18` — historical note "one reverse import was traded for
  another".
- CLAUDE.md "Hard rules → Architecture → No reverse imports".

## Acceptance criteria

- [x] `packages/io/src/builtin-registry.ts` contains the registry
      implementation; `@rifty/io`'s `src/index.ts` re-exports the public
      surface.
- [x] `packages/runtime-js/src/builtins/registry.ts` is deleted; no
      caller inside or outside the package references it.
- [x] `packages/runtime-js/src/builtins/{index,module}.ts` import the
      registry from `@rifty/io`.
- [x] `packages/runtime-js`'s public `src/index.ts` re-exports
      (`registerBuiltin`, `isBuiltinSpecifier`, `listBuiltins`,
      `BuiltinFactory`) are preserved through the
      `src/builtins/index.ts` barrel — external callers see no change.
- [x] `packages/net/src/register-builtins.ts` imports `registerBuiltin`
      from `@rifty/io`.
- [x] `packages/net/package.json` no longer lists `@rifty/runtime-js`
      in `dependencies`.
- [x] `pnpm typecheck` clean across workspaces.
- [x] `pnpm lint` clean.
- [x] `pnpm check:deps` clean (no cycle; reverse edge gone).
- [x] `pnpm test:run` clean — existing unit + conformance + integration
      tests pass unchanged against the new registry location.
- [x] `CHANGELOG.md` entries in `@rifty/io`, `@rifty/runtime-js`, and
      `@rifty/net`.
