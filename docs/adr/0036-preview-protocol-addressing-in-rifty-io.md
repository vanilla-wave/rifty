# ADR 0036: Preview-protocol addressing in `@rifty/io`

Status: Accepted
Date: 2026-05-26

## Context

The `/preview/<port>/...` URL convention and the synthetic `preview.local`
host are the addressing primitives that tie three packages together:

- `@rifty/service-worker` owns the SW-side intercept. Its
  `preview-bridge.ts` declares `PREVIEW_PREFIX_RE = /^\/preview\/(\d+)(\/.*)?$/`
  (line 63) and exports `matchPreviewUrl(pathname)`. Its
  `route-preview.ts` synthesises the upstream URL `http://preview.local${path}`
  (line 74) before forwarding the serialised request to the owning client.
- `@rifty/net` documents the convention in `registry.ts:4` ("the SW
  intercepts `/preview/<port>/...` and forwards via a `MessageChannel` to
  the listening Worker") but has no code reference — the comment can
  drift from the regex silently.
- `apps/playground/src/adapters/hmr-bridge.ts` builds
  `ws://preview.local:<port>/__hmr` (line 55) for the cross-realm HMR
  bridge, and `apps/playground/src/adapters/realVite.ts:216` references
  `Host: preview.local` for Vite's host allow-list. Both rely on the same
  literal host without importing a shared constant.

The convention was duplicated by hand. ADR-0031 added receive-side
`version` validation on every SW wire frame, but it pins the *frame
format*, not the *addressing scheme*: changing the `/preview/<port>/...`
path shape or the `preview.local` host today would require touching at
least three packages and trust the human reviewer to find every
inlined copy.

A single source of truth for the addressing primitives is the right
size of fix.

## Decision

A new module `@rifty/io/src/preview-protocol.ts` owns the addressing
primitives. Both `@rifty/service-worker` and `@rifty/net` import from
there. Public surface:

- `PREVIEW_PREFIX_RE` — the regex (`/^\/preview\/(\d+)(\/.*)?$/`).
- `PREVIEW_LOCAL_HOST` — the literal `'preview.local'`.
- `synthesizePreviewUrl(path)` — returns `http://preview.local${path}`.
- `parsePreviewPath(path)` — returns `{ port: number; rest: string } | null`
  by exec'ing the regex and parsing the captured port to a number.

Re-exported from `@rifty/io/src/index.ts` so callers reach the surface
through the package's main entrypoint.

The implementation lives in `@rifty/io` because:

- `io` is the cross-package contracts home. ADR-0035 moved the `node:`
  builtin registry here for the same reason — primitives shared by
  multiple consumers that sit at different layers belong here.
- `service-worker/package.json` currently declares zero workspace deps
  (the SW bundler follows TS imports). Adding `@rifty/io` is the
  lowest-friction option — we don't need a new package or a SW↔net
  same-layer edge.
- Both `net` and `service-worker` already need symbols from somewhere;
  `io` is the lowest layer, so the import direction stays top-down for
  every consumer.

### Alternatives considered

#### Option A: a new package `@rifty/preview-protocol`

Rejected. A 30-LOC constants module does not earn a package. The
package overhead (workspace declaration, tsconfig, CHANGELOG, README,
new `pnpm install` graph node) would outweigh the constants themselves.

#### Option B: co-locate in `@rifty/net`

Rejected. SW does not currently depend on `net`; adding that edge would
shift the contract's ownership in a direction that obscures it. `net`
is a same-layer peer to SW (both consume from `io`), so an SW→net edge
is a horizontal dependency we have spent ADR-0012 and ADR-0035
specifically avoiding.

#### Option C: status quo with code-comment cross-referencing

Rejected. The comment in `packages/net/src/registry.ts:4` already
exists, and the regex in `packages/service-worker/src/preview-bridge.ts:63`
already exists, and they have been drifting for months without anyone
noticing. Comments are not enforceable — typecheck only catches
shared symbols.

## Consequences

- `service-worker/package.json` gains `"@rifty/io": "workspace:*"` (was
  zero deps). The forward import direction is preserved
  (`io` is the lowest layer of the SW's dependency closure).
- `packages/service-worker/src/preview-bridge.ts` drops its inline
  `PREVIEW_PREFIX_RE` constant and `matchPreviewUrl` calls
  `parsePreviewPath` from `@rifty/io`. `matchPreviewUrl` remains as the
  public SW export (back-compat for `index.ts` consumers) and is now a
  thin shape-adapter (`{port, path}` vs `{port, rest}`).
- `packages/service-worker/src/route-preview.ts` calls
  `synthesizePreviewUrl(match.path)` instead of building the literal
  inline.
- `packages/net/src/registry.ts` doc comment points at
  `@rifty/io/preview-protocol` as the canonical reference for the URL
  scheme.
- SW's own `protocol.ts` (wire-frame versioning, `SW_PROTOCOL_VERSION`)
  stays — that is a different concern (wire frame format vs
  addressing).
- Future routing-scheme changes (e.g. `/preview/<port>/` → `/p/<port>/`,
  or `preview.local` → `preview.invalid`) are a single-touch edit in
  `io` plus a CHANGELOG note. Consumers cannot drift because they
  reference the constants.
- The duplicated string literals in `apps/playground/src/adapters/hmr-bridge.ts`
  and `apps/playground/src/adapters/realVite.ts` remain on the playground
  side. The playground builds `ws://preview.local:<port>/__hmr` for HMR
  and merely *mentions* `preview.local` in a comment in `realVite.ts`;
  it does not parse `/preview/<port>/` itself. Wiring those literals
  to `@rifty/io/preview-protocol` is a follow-up — the `io` module
  exports `PREVIEW_LOCAL_HOST` to make that a one-line swap when the
  HMR adapter graduates from the playground.

## References

- ADR-0012 — `@rifty/io` shared primitives layer. This ADR builds on
  the same rationale.
- ADR-0031 — SW protocol versioning (wire frame `version` field).
  Orthogonal to addressing; this ADR fills the orthogonal gap.
- ADR-0035 — builtin registry in `@rifty/io`. Same pattern: a
  cross-package contract that belongs at the lowest shared layer.
- 2026-05-26 architecture review session — the silent-drift hazard
  between the SW regex and the `net` registry doc-comment is what
  prompted this ADR.

## Acceptance criteria

- [x] `packages/io/src/preview-protocol.ts` exports `PREVIEW_PREFIX_RE`,
      `PREVIEW_LOCAL_HOST`, `synthesizePreviewUrl`, `parsePreviewPath`.
- [x] `packages/io/src/index.ts` re-exports the full surface.
- [x] `packages/service-worker/src/preview-bridge.ts` imports the regex
      from `@rifty/io`; no inline copy.
- [x] `packages/service-worker/src/route-preview.ts` calls
      `synthesizePreviewUrl`; no inline `http://preview.local${...}`.
- [x] `packages/service-worker/package.json` lists `@rifty/io` in
      `dependencies`.
- [x] `packages/net/src/registry.ts` doc comment cross-references the
      shared protocol module.
- [x] Unit suite `packages/io/src/preview-protocol.test.ts` pins the
      regex and host behaviour.
- [x] Existing SW unit tests (`preview-bridge.test.ts`,
      `preview-handshake-sw.test.ts`, `preview-handshake-main.test.ts`)
      pass without assertion changes.
- [x] `pnpm typecheck` / `pnpm lint` / `pnpm check:deps` / `pnpm test:run`
      clean.
- [x] CHANGELOG entries in `@rifty/io`, `@rifty/service-worker`,
      `@rifty/net`.
