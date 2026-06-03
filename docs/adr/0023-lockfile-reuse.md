# ADR 0023: Lockfile reuse on subsequent `install()`

Status: Implemented (2026-05-26)
Date: 2026-05

**Decision (2026-05-26) — A-031 nested install:** Deferred to **M12**. Until then, the installer keeps its current flat-tree linker schema: a single `node_modules/<name>/` directory per package and a hard `EVERSIONCONFLICT` (already implemented per A-031 resolution; see `packages/npm-client/src/installer.ts`) on any version disagreement. Nested install (`node_modules/<a>/node_modules/<b>/...`) requires the linker schema rewrite plus a corresponding lockfile-shape extension — both fit naturally in the M12 toolchain pass that also rewires `@riftydev/net` for cross-realm streaming. Until then, real packages with conflicting transitive deps fail loudly rather than silently picking a winner.

## Context

`@riftydev/npm-client.install()` re-resolves every dependency from the registry on every call, even when a `package-lock.json` exists in `<cwd>`. The lockfile is written but never read back. Repeated installs are slow and non-deterministic across registry-state changes.

REVIEW_ACTIONS entry A-030 flags it. The relevant call site already has a TODO(ADR) marker pointing here, added in parallel with this ADR.

## Decision

Read and honour `package-lock.json` on subsequent installs.

- When `<cwd>/package-lock.json` exists and parses cleanly:
  - For every entry in `dependencies` (and transitively in the lockfile graph) whose pinned version satisfies the requested range, use the lockfile's `resolved` URL and `integrity` to fetch from a tarball cache.
  - The tarball cache lives at `/.rifty/tarball-cache/<sha-prefix>/<name>-<version>.tgz` inside the VFS. Cache hits skip the network entirely; cache misses fetch the tarball, verify the integrity hash, then populate the cache.
  - If a request range no longer matches any lockfile pin (range change, new dep), re-resolve only that subgraph from the live registry.
- When `<cwd>/package-lock.json` does not exist or fails to parse: behaviour is unchanged (full resolve).
- On any registry roundtrip the lockfile is updated; the file format stays npm-compatible so an external `npm install` can read it.
- Implementation deferred to M11.

## Consequences

- Repeated installs become fast (no network on cache hit) and deterministic (lockfile pins the version graph).
- M9's acceptance for `npm install` gains a "second run is cached" success path.
- Negative: the tarball cache lives in the VFS, which means OPFS quota becomes a real constraint for large dep graphs.
- Negative: lockfile churn under partial range changes needs careful handling to avoid invalidating unrelated subgraphs.
- Follow-up: M11.

## Acceptance criteria

- [x] Two consecutive `install()` calls with the same `package.json` and an existing lockfile make N network calls + 0 network calls.
- [x] A 1-character change in a single `dependencies` range triggers re-resolution; transitive deps whose pin still matches are served from the cache.
- [x] The tarball cache at `/.rifty/tarball-cache/` is populated on first install and consulted on second install; cache hits verify integrity before use.
- [x] Corruption in a cached entry forces a refetch (integrity mismatch is treated as a cache miss, then re-written).

## Implementation notes (2026-05-24)

- `buildLockfile` now records `resolved` (tarball URL) and `integrity` (SHA-256 SRI) per package; the v3 shape stays npm-compatible.
- `install()` reads `<cwd>/package-lock.json` first; when every top-level dep's pinned version still satisfies the requested range, it replays the closed subgraph (`lockfileSubgraph`) through the tarball cache without touching the registry. The on-disk lockfile is left byte-identical when no new entry was pulled.
- `VfsTarballCache` lives under `/.rifty/tarball-cache/<sha-prefix>/<name>-<version>.tgz` where `<sha-prefix>` is the first two hex chars of the integrity hash. `get()` re-verifies integrity on read; mismatch returns `null` so the caller refetches and rewrites.
- The live-resolve path also consults the cache: it looks up integrity from the existing lockfile when the manifest doesn't carry one, so a partial re-resolve (e.g. one range bump) still avoids network for unchanged transitive deps.
- Coverage: 4 conformance tests in `tests/conformance/npm/lockfile-reuse.test.ts`.

## Implementation notes (2026-05-26) — overrides re-applied on fast path

P1 semantic-divergence fix: the original fast-path replayed lockfile pins
verbatim, ignoring `package.json#overrides`. Adding an override (user or
baked-in) after the lockfile was already on disk silently no-op'd until
something forced a full live resolve.

The fast path now walks every top-level request through `resolveOverride()`
before consulting `lockfileCovers`, and every transitive name in the closed
subgraph through `resolveOverride(name, undefined, …)` to detect any
redirection. If an override would change a name (or would tighten a range
past what the locked pin satisfies), the fast path falls through to live
resolve — treated as a cache miss.

The transitive check uses the global (no-parent) form of `resolveOverride`
because the v3 flat lockfile loses parent context. That's slightly more
aggressive than strictly necessary, but the cost is one extra live-resolve
and the win is never silently ignoring an override.

Coverage: 3 new unit tests in `packages/npm-client/src/installer-lockfile.test.ts`
(`falls through to live-resolve when a user override redirects a locked dep to
a new name`, `falls through when an override changes the locked range`,
`still hits the fast path when no override touches the locked subgraph`).

## Follow-ups

- Per-subgraph partial reuse (recompute only the changed top-level dep's subgraph) instead of falling back to a full live-resolve when any top-level pin no longer matches. The cache already softens the cost; the current invariant is simpler to reason about.
