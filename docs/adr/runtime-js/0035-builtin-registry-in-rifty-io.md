# ADR 0035: Builtin registry in `@riftydev/io`

Status: Accepted
Date: 2026-05-26

> TL;DR: `node:` builtin registry moves verbatim into `@riftydev/io`, killing the `net → runtime-js` reverse import while keeping the public API unchanged

## Context

ADR-0012 moved `EventEmitter`, `Buffer`, streams, and `NotImplementedError` into the shared-primitives layer `@riftydev/io`, but consciously left the `node:` builtin **registry** in `@riftydev/runtime-js/src/builtins/registry.ts`, calling the residual `@riftydev/net → @riftydev/runtime-js` link a forward-direction wiring call, not a reverse import.

Against the layer rule `vfs → kernel → runtime-* → net/shell → npm-client → playground` and `pnpm check:deps`, that link is in fact a reverse import. `packages/net/package.json:21` declares `"@riftydev/runtime-js": "workspace:*"`, used at exactly one site, `packages/net/src/register-builtins.ts:8`:

```ts
import { registerBuiltin } from '@riftydev/runtime-js';
```

The architecture review (`docs/review/2026-05-26-architecture-review.md`, Tier 1) and `TASKS.md:18` ("reverse imports `kernel → runtime-js`, deep paths into `runtime-js/src/builtins/*` from `net`") trace the same problem.

The registry (`packages/runtime-js/src/builtins/registry.ts`) is a generic key → factory cache with no Node-specific behaviour — it strips the `node:` prefix and looks up a factory in a `Record`:

```ts
export type BuiltinFactory = () => Record<string, unknown>;
export function registerBuiltin(name, factory): void;
export function isBuiltinSpecifier(specifier): boolean;
export function loadBuiltin(specifier): Record<string, unknown> | null;
export function listBuiltins(): string[];
```

It needs no worker, loader, or runtime-js internal — the same pure-primitive category as `NotImplementedError`/`EventEmitter`, so ADR-0012's rationale applies verbatim.

## Decision

Move the registry implementation into `@riftydev/io`. Both `@riftydev/runtime-js` (calls `loadBuiltin`/`listBuiltins`) and `@riftydev/net` (calls `registerBuiltin`) already depend on `@riftydev/io`, so import direction stays top-down.

- New `packages/io/src/builtin-registry.ts` holds the implementation verbatim — same public API (`registerBuiltin`, `isBuiltinSpecifier`, `loadBuiltin`, `listBuiltins`, `BuiltinFactory`), same behaviour and cache semantics.
- `@riftydev/io`'s `src/index.ts` re-exports the surface.
- `packages/runtime-js/src/builtins/registry.ts` is deleted. It was internal — not in runtime-js's subpath exports (`./builtins/{fs-watch,process,timers,buffer,module}` only) — so no external consumer reached it.
- `packages/runtime-js/src/builtins/{index,module}.ts` import the registry from `@riftydev/io` instead of `./registry.ts`.
- `packages/net/src/register-builtins.ts` imports `registerBuiltin` from `@riftydev/io`.
- `packages/net/package.json` drops the `@riftydev/runtime-js` dependency.

Public-API shape is unchanged. Existing tests (runtime-js `builtins/*` suites, conformance for `Module.builtinModules`) are the contract and continue to pass with import paths updated.

## Consequences

- Layer diagram is truthful end-to-end: `pnpm check:deps` shows no `net → runtime-js` edge. The TASKS.md "one reverse import traded for another" note is closed.
- `@riftydev/io`'s public surface gains four functions + one type (~40 lines), with one module-level mutable map (`factories` + `cache`) — the same process-wide singleton scope as before, just in a different package.
- `@riftydev/runtime-js`'s top-level re-exports (`registerBuiltin`/`isBuiltinSpecifier`/`listBuiltins`/`BuiltinFactory` in `src/index.ts`) are preserved verbatim via `src/builtins/index.ts` re-exporting from `@riftydev/io`. No breaking change for external callers.
- `registry.ts` is deleted, not stub-shimmed. `runtime-js/package.json` subpath-exports never listed `./builtins/registry`, so no public path is affected. No `// TODO(ADR)` carryover.
- The `register-builtins.ts` side-effect pattern is unchanged: registration still happens from `net` (preserving top-down layering); only the import source changes.

### Alternatives considered

**Option B: registry in `@riftydev/kernel`.** Kernel sits between `io` and `runtime-*`, so it also yields a forward-only graph. Rejected: kernel's scope is processes / IPC / sync RPC (ADR-0011, ADR-0032), not a generic key-value registry; `io`'s "shared Node-compatible primitives" scope (ADR-0012) is the precise fit.

**Option C: leave registry in `runtime-js`, remove the import another way.** Either (a) inline `registerBuiltin` calls in runtime-js for `net`/`http`/`https`, or (b) a callback-injection scheme where runtime-js registers hooks `net` calls at bootstrap. Both reintroduce a `net` dependency inside runtime-js — syntactically (a, runtime-js must know `net` shapes) or semantically (b, every new registrant needs a matching hook) — contradicting the side-effect-entrypoint design (higher layers plug in, lower layers expose a registry). Rejected.

**Option D: defer to M11.** The reverse edge has been live since ADR-0012; `madge` only catches cycles, not directional violations, so CI does not flag it. Deferring risks a true cycle via a future `net → io → ... → net` route or another runtime-js-only API in `net`'s deps. Rejected — fix now.

## References

- ADR-0012 — original `@riftydev/io` promotion; this ADR builds on its scope decision.
- `docs/review/2026-05-26-architecture-review.md` — review recording the residual reverse import as open.
- `TASKS.md:18` — historical "one reverse import was traded for another".
- CLAUDE.md "Hard rules → Architecture → No reverse imports".

## Acceptance criteria

- [x] `packages/io/src/builtin-registry.ts` contains the implementation; `@riftydev/io` `src/index.ts` re-exports the surface.
- [x] `packages/runtime-js/src/builtins/registry.ts` deleted; no caller in/outside the package references it.
- [x] `packages/runtime-js/src/builtins/{index,module}.ts` import the registry from `@riftydev/io`.
- [x] `packages/runtime-js` `src/index.ts` re-exports (`registerBuiltin`, `isBuiltinSpecifier`, `listBuiltins`, `BuiltinFactory`) preserved via `src/builtins/index.ts` — external callers see no change.
- [x] `packages/net/src/register-builtins.ts` imports `registerBuiltin` from `@riftydev/io`.
- [x] `packages/net/package.json` no longer lists `@riftydev/runtime-js` in `dependencies`.
- [x] `pnpm typecheck` clean across workspaces.
- [x] `pnpm lint` clean.
- [x] `pnpm check:deps` clean (no cycle; reverse edge gone).
- [x] `pnpm test:run` clean — unit + conformance + integration tests pass unchanged against the new location.
- [x] `CHANGELOG.md` entries in `@riftydev/io`, `@riftydev/runtime-js`, `@riftydev/net`.
