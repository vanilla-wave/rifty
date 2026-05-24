# ADR 0023: Lockfile reuse on subsequent `install()`

Status: Implemented (2026-05-24)
Date: 2026-05

## Context

`@rifty/npm-client.install()` re-resolves every dependency from the registry on every call, even when a `package-lock.json` exists in `<cwd>`. The lockfile is written but never read back. Repeated installs are slow and non-deterministic across registry-state changes.

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

## Follow-ups

- Per-subgraph partial reuse (recompute only the changed top-level dep's subgraph) instead of falling back to a full live-resolve when any top-level pin no longer matches. The cache already softens the cost; the current invariant is simpler to reason about.
