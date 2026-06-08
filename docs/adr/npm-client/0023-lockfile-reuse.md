# ADR 0023: Lockfile reuse on subsequent `install()`

Status: Implemented (2026-05-26)
Date: 2026-05

**Decision (2026-05-26) — A-031 nested install:** Deferred to **M12**. Until then the installer keeps its flat-tree linker schema: one `node_modules/<name>/` per package and a hard `EVERSIONCONFLICT` on any version disagreement (implemented per A-031; `packages/npm-client/src/installer.ts`). Nested install (`node_modules/<a>/node_modules/<b>/…`) needs the linker-schema rewrite plus a lockfile-shape extension — both fit the M12 toolchain pass that also rewires `@riftydev/net` for cross-realm streaming. Real packages with conflicting transitive deps fail loudly rather than silently picking a winner.

## Context

`@riftydev/npm-client.install()` re-resolves every dependency from the registry on every call, even when `<cwd>/package-lock.json` exists — the lockfile is written but never read back. Repeated installs are slow and non-deterministic across registry-state changes. Flagged by REVIEW_ACTIONS A-030; the call site already has a TODO(ADR) marker pointing here.

## Decision

Read and honour `package-lock.json` on subsequent installs.

- When `<cwd>/package-lock.json` exists and parses cleanly: for each lockfile-graph entry (direct + transitive) whose pinned version satisfies the requested range, use the lockfile's `resolved` URL and `integrity` to fetch from a tarball cache.
  - Cache at `/.rifty/tarball-cache/<sha-prefix>/<name>-<version>.tgz` in the VFS. Hits skip the network; misses fetch, verify integrity, then populate.
  - If a request range no longer matches any pin (range change, new dep), re-resolve only that subgraph from the live registry.
- Missing/unparseable lockfile: behaviour unchanged (full resolve).
- Any registry roundtrip updates the lockfile; format stays npm-compatible (external `npm install` can read it).
- Implementation deferred to M11.

## Consequences

- Repeated installs become fast (no network on hit) and deterministic (lockfile pins the version graph).
- M9 acceptance for `npm install` gains a "second run is cached" path.
- Negative: cache lives in the VFS → OPFS quota becomes a real constraint for large dep graphs.
- Negative: lockfile churn under partial range changes needs care to avoid invalidating unrelated subgraphs.
- Follow-up: M11.

## Acceptance criteria

- [x] Two consecutive `install()` with the same `package.json` + existing lockfile → N network calls, then 0.
- [x] A 1-char change in one `dependencies` range triggers re-resolution; transitive deps still matching their pin are served from cache.
- [x] Cache at `/.rifty/tarball-cache/` is populated on first install, consulted on second; hits verify integrity before use.
- [x] Corruption in a cached entry forces refetch (integrity mismatch = cache miss, then rewrite).

## Implementation notes (2026-05-24)

- `buildLockfile` records `resolved` (tarball URL) + `integrity` (SHA-256 SRI) per package; v3 shape stays npm-compatible.
- `install()` reads `<cwd>/package-lock.json` first; when every top-level dep's pin still satisfies its range, it replays the closed subgraph (`lockfileSubgraph`) through the cache without touching the registry. On-disk lockfile left byte-identical when no new entry is pulled.
- `VfsTarballCache` at `/.rifty/tarball-cache/<sha-prefix>/…` (`<sha-prefix>` = first two hex chars of integrity hash). `get()` re-verifies integrity; mismatch returns `null` → caller refetches and rewrites.
- Live-resolve path also consults the cache: looks up integrity from the existing lockfile when the manifest lacks one, so a partial re-resolve (e.g. one range bump) still avoids network for unchanged transitive deps.
- Coverage: 4 conformance tests in `tests/conformance/npm/lockfile-reuse.test.ts`.

## Implementation notes (2026-05-26) — overrides re-applied on fast path

P1 semantic-divergence fix: the original fast path replayed lockfile pins verbatim, ignoring `package.json#overrides`. Adding an override (user or baked-in) after the lockfile was on disk silently no-op'd until a full live resolve was forced.

The fast path now runs every top-level request through `resolveOverride()` before `lockfileCovers`, and every transitive name in the closed subgraph through `resolveOverride(name, undefined, …)`. If an override would change a name, or tighten a range past the locked pin, the fast path falls through to live resolve (treated as a cache miss).

The transitive check uses the global (no-parent) `resolveOverride` form because the v3 flat lockfile loses parent context — slightly more aggressive than necessary, but the cost is one extra live-resolve and the win is never silently ignoring an override.

Coverage: 3 unit tests in `packages/npm-client/src/installer-lockfile.test.ts` (override redirects locked dep to a new name; override changes the locked range; no override touches the locked subgraph → fast path still hits).

## Follow-ups

- Per-subgraph partial reuse (recompute only the changed top-level dep's subgraph) instead of falling back to full live-resolve when any top-level pin no longer matches. The cache already softens the cost; the current full-fallback invariant is simpler to reason about.
