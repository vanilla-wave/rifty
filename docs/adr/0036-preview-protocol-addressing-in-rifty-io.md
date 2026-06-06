# ADR 0036: Preview-protocol addressing in `@riftydev/io`

Status: Accepted
Date: 2026-05-26

## Context

The `/preview/<port>/...` URL convention and the synthetic `preview.local` host are addressing primitives shared by three packages, each holding its own hand-copied version:

- `@riftydev/service-worker` — `preview-bridge.ts:63` declares `PREVIEW_PREFIX_RE = /^\/preview\/(\d+)(\/.*)?$/` and exports `matchPreviewUrl(pathname)`; `route-preview.ts:74` synthesises `http://preview.local${path}`.
- `@riftydev/net` — only documents the convention in `registry.ts:4`; no code reference, so the comment can drift from the regex silently.
- `apps/playground/src/adapters/hmr-bridge.ts:55` builds `ws://preview.local:<port>/__hmr`; `realVite.ts:216` references `Host: preview.local`. Both use the literal host without a shared constant.

ADR-0031 pinned the SW wire *frame format* via `version` validation, but not the *addressing scheme*: changing the path shape or host today means touching three packages and trusting the reviewer to find every inlined copy. A single source of truth is the right-sized fix.

## Decision

New module `@riftydev/io/src/preview-protocol.ts` owns the addressing primitives; both `@riftydev/service-worker` and `@riftydev/net` import from it. Public surface:

- `PREVIEW_PREFIX_RE` — `/^\/preview\/(\d+)(\/.*)?$/`.
- `PREVIEW_LOCAL_HOST` — `'preview.local'`.
- `synthesizePreviewUrl(path)` — returns `http://preview.local${path}`.
- `parsePreviewPath(path)` — `{ port: number; rest: string } | null` via the regex with the port parsed to a number.

Re-exported from `@riftydev/io/src/index.ts`.

Lives in `@riftydev/io` because:
- `io` is the cross-package contracts home (ADR-0035 put the `node:` builtin registry here for the same reason).
- `service-worker/package.json` has zero workspace deps; adding `@riftydev/io` is lowest-friction — no new package, no SW↔net same-layer edge.
- `io` is the lowest layer, so the import direction stays top-down for both consumers.

### Alternatives considered

- **Option A — new package `@riftydev/preview-protocol`.** Rejected: a 30-LOC constants module doesn't earn the package overhead (workspace decl, tsconfig, CHANGELOG, README, install-graph node).
- **Option B — co-locate in `@riftydev/net`.** Rejected: SW doesn't depend on `net`; that edge is horizontal (both are `io` consumers), which ADR-0012 and ADR-0035 specifically avoid.
- **Option C — status quo with code-comment cross-referencing.** Rejected: the `net/src/registry.ts:4` comment and the `service-worker/src/preview-bridge.ts:63` regex already exist and have drifted for months unnoticed. Comments aren't enforceable; only shared symbols are typechecked.

## Consequences

- `service-worker/package.json` gains `"@riftydev/io": "workspace:*"` (was zero deps); forward import direction preserved (`io` is its lowest layer).
- `preview-bridge.ts` drops its inline `PREVIEW_PREFIX_RE`; `matchPreviewUrl` now calls `parsePreviewPath` and remains a thin shape-adapter (`{port, path}` vs `{port, rest}`) for back-compat with `index.ts` consumers.
- `route-preview.ts` calls `synthesizePreviewUrl(match.path)` instead of inlining the literal.
- `net/src/registry.ts` doc comment now points at `@riftydev/io/preview-protocol` as canonical.
- SW's `protocol.ts` (`SW_PROTOCOL_VERSION`, wire-frame versioning) stays — a different concern (frame format vs addressing).
- Future scheme changes (`/preview/<port>/`→`/p/<port>/`, `preview.local`→`preview.invalid`) become a single-touch edit in `io` + CHANGELOG note; consumers can't drift.
- (Negative / follow-up) The playground literals in `hmr-bridge.ts` and `realVite.ts` remain on the playground side — it builds `ws://preview.local:<port>/__hmr` and only *mentions* `preview.local` in a comment, never parsing `/preview/<port>/`. Wiring them to `@riftydev/io` is a follow-up; `PREVIEW_LOCAL_HOST` is exported to make it a one-line swap when the HMR adapter graduates from the playground.

## References

- ADR-0012 — `@riftydev/io` shared primitives layer; this ADR builds on it.
- ADR-0031 — SW protocol versioning (wire frame `version`); orthogonal to addressing, this ADR fills that gap.
- ADR-0035 — builtin registry in `@riftydev/io`; same pattern (cross-package contract at the lowest shared layer).
- 2026-05-26 architecture review session — the silent-drift hazard between the SW regex and the `net` registry doc-comment prompted this ADR.

## Acceptance criteria

- [x] `packages/io/src/preview-protocol.ts` exports `PREVIEW_PREFIX_RE`, `PREVIEW_LOCAL_HOST`, `synthesizePreviewUrl`, `parsePreviewPath`.
- [x] `packages/io/src/index.ts` re-exports the full surface.
- [x] `packages/service-worker/src/preview-bridge.ts` imports the regex from `@riftydev/io`; no inline copy.
- [x] `packages/service-worker/src/route-preview.ts` calls `synthesizePreviewUrl`; no inline `http://preview.local${...}`.
- [x] `packages/service-worker/package.json` lists `@riftydev/io` in `dependencies`.
- [x] `packages/net/src/registry.ts` doc comment cross-references the shared protocol module.
- [x] Unit suite `packages/io/src/preview-protocol.test.ts` pins the regex and host behaviour.
- [x] Existing SW unit tests (`preview-bridge.test.ts`, `preview-handshake-sw.test.ts`, `preview-handshake-main.test.ts`) pass without assertion changes.
- [x] `pnpm typecheck` / `pnpm lint` / `pnpm check:deps` / `pnpm test:run` clean.
- [x] CHANGELOG entries in `@riftydev/io`, `@riftydev/service-worker`, `@riftydev/net`.
