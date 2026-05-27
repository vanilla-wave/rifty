# ADR 0042: M11 nested install — first-wins flat + nest-on-conflict

Status: Accepted
Date: 2026-05-27

## Context

ADR-0023 ratified the lockfile-reuse path for `@rifty/npm-client.install` but
explicitly deferred *nested* installs to M11. Pre-M11 the linker was flat-only:
every (name, version) pair lived at `node_modules/<name>/`, and any second
version of the same name aborted the install with `EVERSIONCONFLICT`
(A-031). The compromise was acceptable for M9's test set (small, controlled
fixtures); the 2026-05-27 opt-in live `express@^4` install proved it was
not acceptable for any real-world transitive graph:

```
[express-live] install threw: code=EVERSIONCONFLICT
  msg=Conflicting versions of ms: 2.1.3 vs 2.0.0
```

The conflict is the classic `express → debug → ms@^2.1` collides with
`express → finalhandler → ms@2.0` diamond. Three transitive deps
(`debug`, `ms`, `statuses`) end up with multiple versions in a real
express install (verified post-fix: the resolver pulled `ms × 5`,
`debug × 3`, `statuses × 3`, etc.). Without nested placement the
project cannot install `express`, `vite`, or `opencode` — exactly the
three reference targets `docs/large-targets-readiness-2026-05-27.md`
gates M11 readiness on.

## Decision

Replace the flat-only linker with a **first-wins-flat, nest-on-conflict**
placement, driven by `walkAndPin` in `installer.ts`. The algorithm is:

1. Resolve the pin for `(name, range)` via the existing `ResolutionSource`.
   This step does **not** know about siblings — diamond detection moves to
   the walk.
2. Look up the *flat* (hoisted) slot for `name`:
   - **Absent.** Install at `node_modules/<name>`; record as the flat slot.
   - **Present, same version.** Dedupe — no fetch, no recursion, no new
     lockfile entry.
   - **Present, different version.** Install at
     `<parentInstallPath>/node_modules/<name>`. Both placements coexist on
     disk; both end up as distinct lockfile entries keyed by their actual
     install path.
3. Recurse into the package's dependencies with **the package's own install
   path** as the new `parentInstallPath`.

Concrete fallout in code:

- `ResolvedPackage` gains an optional `installPath` (full project-root-
  relative path). `link()` writes by that path; `buildLockfile` keys by it.
- `PinnedPackage` (the internal walk type) requires `installPath`.
- `createRegistrySource.resolve` no longer throws `EVERSIONCONFLICT` —
  diamond detection is gone from the source. The "no matching version"
  throw and the override-resolution stay; those are independent failures.
- The fast-path `createLockfileSource` keeps its bare-name lookup
  (`node_modules/<name>`). When the existing lockfile contains any
  nested entry (a key with a *second* `/node_modules/` segment),
  `chooseSource` opts out of the fast path and falls through to live
  resolve — the fast path simply does not know how to replay nested
  placement yet. Lifting that limitation (parent-aware lockfile replay)
  is a follow-on; the cost today is one extra packument round-trip per
  package on installs whose lockfile happens to contain nested entries,
  which is bounded by the cache layer.

## Alternatives considered

- **Full npm-v3 hoisting** (each package placed as high in the tree as
  possible without conflict, including sharing nested copies between
  sibling-ancestors). Strictly better disk usage; significantly more
  complex bookkeeping (the walk has to know "what's visible from each
  candidate placement"). The win is bounded — the rough cost is "a few
  duplicate copies in deeply-shared subgraphs" — and is recoverable later
  by upgrading `walkAndPin` to do the visibility check. We opted for the
  simpler placement to land M11 with the smaller surface change.
- **Throw on conflict but offer an `allowMultipleVersions` opt-in.** Keeps
  M9 behaviour as the default. Rejected: the opt-in would have to be on
  *by default* for any real install to work, so it would not actually be
  an opt-in.

## Trade-offs

- **Disk:** deeply-shared transitive deps may install more than the
  optimum number of copies. Bound: each conflicting `(name, version)`
  installs once per immediate parent that introduced it, not once per
  ancestor.
- **Lockfile fast-path is temporarily disabled** when nested entries are
  present. After a first install that produces nested entries, the next
  install of the same project goes through live resolve (still
  cache-warm). The next ADR slice can re-enable fast-path replay for
  lockfiles with nested keys.
- **EVERSIONCONFLICT is now dead code.** The export is removed in the same
  PR; any external caller that catches it (none exist outside the
  package) would have to migrate to the success path.

## Consequences

- Closes M9's "Nested install for version conflicts" open-acceptance item
  and unblocks every reference target in
  `docs/large-targets-readiness-2026-05-27.md` (Express verified
  end-to-end in the 2026-05-27 second pass — 86 packages resolved, the
  expected diamond placements present on disk and in the lockfile).
- ADR-0023 still holds for the cache + lockfile-reuse contract;
  this ADR amends only the placement rule and the fast-path opt-out
  condition.
- ADR-0011's "spawn worker as process" remains the M11 north star;
  this ADR addresses the parallel installer track of M11 that ADR-0023
  deferred.

## References

- `docs/large-targets-readiness-2026-05-27.md` — outcome B of the
  opt-in live express install and the execution order.
- `docs/follow-ups-2026-05-27.md` — item #1 (live express experiment).
- `ADR-0023` — lockfile reuse + tarball cache.
- `tests/integration/express-live.opt-in.test.ts` — operator-run
  verification.
- `packages/npm-client/src/installer.test.ts` — diamond + express-shape
  unit tests pinning the placement contract.
