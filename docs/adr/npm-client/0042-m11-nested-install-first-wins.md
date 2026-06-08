# ADR 0042: M11 nested install — first-wins flat + nest-on-conflict

Status: Accepted
Date: 2026-05-27

## Context

ADR-0023 ratified lockfile-reuse for `@riftydev/npm-client.install` but deferred *nested* installs to M11. Pre-M11 the linker was flat-only: every (name, version) lived at `node_modules/<name>/`, and any second version of a name aborted with `EVERSIONCONFLICT` (A-031). Fine for M9's small fixtures; the 2026-05-27 opt-in live `express@^4` install proved it insufficient for real transitive graphs:

```
[express-live] install threw: code=EVERSIONCONFLICT
  msg=Conflicting versions of ms: 2.1.3 vs 2.0.0
```

Classic diamond: `express → debug → ms@^2.1` vs `express → finalhandler → ms@2.0`. A real express install needs multiple versions of three transitive deps (post-fix: `ms × 5`, `debug × 3`, `statuses × 3`, etc.). Without nested placement, none of `express`/`vite`/`opencode` — the three reference targets `docs/large-targets-readiness-2026-05-27.md` gates M11 on — can install.

## Decision

Replace flat-only with **first-wins-flat, nest-on-conflict** placement, driven by `walkAndPin` in `installer.ts`:

1. Resolve the pin for `(name, range)` via the existing `ResolutionSource` (no sibling awareness — diamond detection moves to the walk).
2. Look up the *flat* (hoisted) slot for `name`:
   - **Absent** → install at `node_modules/<name>`; record as flat slot.
   - **Present, same version** → dedupe (no fetch, no recursion, no new lockfile entry).
   - **Present, different version** → install at `<parentInstallPath>/node_modules/<name>`. Both coexist on disk and become distinct lockfile entries keyed by actual install path.
3. Recurse into deps with the package's own install path as the new `parentInstallPath`.

Code fallout:

- `ResolvedPackage` gains optional `installPath` (project-root-relative). `link()` writes by it; `buildLockfile` keys by it.
- `PinnedPackage` (internal walk type) requires `installPath`.
- `createRegistrySource.resolve` no longer throws `EVERSIONCONFLICT` — diamond detection removed from the source. "No matching version" throw and override-resolution stay (independent failures).
- Fast-path `createLockfileSource` keeps bare-name lookup (`node_modules/<name>`). When the lockfile contains any nested entry (key with a *second* `/node_modules/` segment), `chooseSource` opts out and falls to live resolve — fast path can't replay nested placement yet. Parent-aware replay is a follow-on; cost today is one extra packument round-trip per package for installs with nested entries, bounded by the cache.

## Alternatives considered

- **Full npm-v3 hoisting** (place each package as high as possible, sharing nested copies between sibling-ancestors). Better disk usage but far more bookkeeping (walk must track what's visible from each candidate placement). Win is bounded ("a few duplicate copies in deeply-shared subgraphs") and recoverable later by upgrading `walkAndPin` with the visibility check. Chose the simpler placement for a smaller M11 surface.
- **Throw on conflict + `allowMultipleVersions` opt-in.** Rejected: it would have to be *on by default* for any real install to work, so not actually an opt-in.

## Trade-offs

- **Disk:** deeply-shared deps may install more than optimal. Bound: each conflicting `(name, version)` installs once per immediate parent that introduced it, not once per ancestor.
- **Lockfile fast-path temporarily disabled** with nested entries present — subsequent installs of the project go through live resolve (still cache-warm). Next ADR slice re-enables fast-path replay for lockfiles with nested keys.
- **EVERSIONCONFLICT is now dead code.** Export removed in the same PR; any external caller catching it (none exist outside the package) must migrate to the success path.

## Consequences

- Closes M9's "Nested install for version conflicts" open-acceptance item and unblocks every reference target in `docs/large-targets-readiness-2026-05-27.md` (Express verified end-to-end on 2026-05-27: 86 packages resolved, expected diamond placements on disk and in lockfile).
- ADR-0023 still holds for the cache + lockfile-reuse contract; this ADR amends only the placement rule and fast-path opt-out condition.
- ADR-0011's "spawn worker as process" remains the M11 north star; this ADR covers the parallel installer track that ADR-0023 deferred.

## References

- `docs/large-targets-readiness-2026-05-27.md` — outcome B of the opt-in live express install + execution order.
- `docs/follow-ups-2026-05-27.md` — item #1 (live express experiment).
- `ADR-0023` — lockfile reuse + tarball cache.
- `tests/integration/express-live.opt-in.test.ts` — operator-run verification.
- `packages/npm-client/src/installer.test.ts` — diamond + express-shape unit tests pinning the placement contract.
