# ADR 0023: Lockfile reuse on subsequent `install()`

Status: Accepted
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

## Acceptance criteria for the deferred implementation

- [ ] Two consecutive `install()` calls with the same `package.json` and an existing lockfile make N network calls + 0 network calls.
- [ ] A 1-character change in a single `dependencies` range triggers re-resolution only for that one package's subgraph.
- [ ] The tarball cache at `/.rifty/tarball-cache/` is populated on first install and consulted on second install; cache hits verify integrity before use.
- [ ] The TODO(ADR) marker in `packages/npm-client/src/installer.ts` is removed once the implementation lands.
