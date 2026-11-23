# ADR 0547: Frozen prepared dependency snapshots

Status: Accepted
Date: 2026-10

## Context

Prepared no-COI editors build installed dependencies without reinstalling them.
ADR-0346/0386 replay archives add transport bytes unused by that scenario.
Goal compact-dependency-snapshots I1–I3 preserves ordinary replay guarantees.

## Decision

- Public `produceDependencySnapshot({ ..., profile?: 'replay' | 'frozen' })`.
  Omitted profile remains replay; unknown values reject before acquisition.
- Frozen uses tar manifest version 5 with required `profile: 'frozen'`.
  Same payload/identity rules as v4; no `rifty/replay-cache` entries. Internal
  decoded frozen snapshots and JSON serialization also use version 5. V3 JSON
  and v4 tar remain replay-only; they cannot carry a frozen marker.
- Bake uses the same installer, caller pins, preparation and verified replay
  closure, then omits that closure from transport. No new resolver or installer.
- Shared preflight still validates lock structure, install identity, payload
  paths and prepared files. Frozen requires an empty cache; restore/apply skip
  cache import and cache flush entirely. Existing shared entries survive.
- SnapshotId authenticates the complete uncompressed envelope as before.
  V5 is deliberately unsupported by old readers; no ambiguous optional v4 flag.
- No saved-state marker/migration, install prohibition, registry fallback,
  offline reinstall guarantee, reset semantics or added crash atomicity.

## Compatibility evidence

BASE f37bfc517613d0e3618519ccbeeb3ed15fd5cc39: compact contract tests reject v5
with `Unsupported dep snapshot version 5`; v3 with an unknown compact marker
is accepted for a real ms tree. Old tar decoder accepts only manifest v4.
The packed same-input Vite 7.3.6 pair and no-COI journey carry I1–I2.
Existing replay closure/SRI and malformed-container suites retain I3.
2026-11-23 — I3 tar carriers: system-tar v5 without/unknown profile, v4 with a
compact marker and a v5 replay namespace reject before mutation
(`dep-snapshot-compact.contract.test.ts`). COI owner apply (permitted, not
required by the goal) proves the same no replay-cache access
(`workbench-snapshot-apply-validation.contract.test.ts`); COI first-materialization
restore now also skips its cache-persistence flush (`PreparedDepSnapshotRestore.applyCache`
absent for v5). System-tar carriers include a directory-only replay namespace.

## Alternatives

Optional v4 marker: old readers either ignore it or misclassify missing replay.
Remove ordinary replay bytes: violates I3. New installer/persistence owner:
unnecessary; existing tier projection and payload overlay already own application.

## Consequences

Frozen reduces the measured Vite pair, not every possible tree. Readers must
upgrade before consuming frozen; ordinary producers/readers remain compatible.
Explicit install retains existing cache-miss and replay behavior. 2026-11-23 —
concretely: shadow-substituted pins replayed from the lock read bytes only from
the shared cache and are never fetched. Real Vite 7.3.6 after compact on a cold
cache, live registry (`no-coi-compact-vite-install.contract.test.ts`): install
over the lock, `npm install esbuild` and adding `ms` each fail `EBROKENLOCK …
esbuild.v2 is missing its pinned cache bytes`; the ordinary tarballs fetched
first (11, or 12 with `ms`) stay in the shared cache; project files stay
byte-exact (installer level; directories, `installManifest` and the stamp not
observed). Mechanism (`no-coi-compact-install.contract.test.ts`, one LightningCSS
pin): naming in `npm install` a dependency of the root `package.json` whose lock
pin is shadow-substituted re-resolves it through the registry (ADR-0361 request
admission) — no route for Vite 7 while its lock is kept, since `esbuild` is
transitive and stays lock-replayed. Deleting `package-lock.json` re-resolves from
the registry (fetches `esbuild-wasm`; pins may move). A replay snapshot or warm
cache restores the exact install. Vite 8 is not covered by these carriers.
2026-11-23 (PR #426) — exact-reinstall route for the host, with its
condition: the replay-profile snapshot of the same dependencies applies without
`force` only while `package.json` and `package-lock.json` are unchanged since
the frozen snapshot; then `toolchain.install` reinstalls the lock byte-exact
from its replay cache. A changed `package.json` (or lock) conflicts by default;
`force` applies but reverts the project edit (`no-coi-frozen-vite-install.contract.test.ts`,
packed Chromium proof). The refusal text names only the lockless exit.

## Decisions

- 2026-11-23 — profile renamed `compact` → `frozen`; user: «отправь сессию
  переименовать на frozen» (the contract is "use as is, no reinstall", not size).
  `compact` was never published (`@riftydev/workbench`/`sdk`/`npm-client@0.11.0`
  carry no such profile): renamed in place, same v5, no alias; `'compact'` is
  an unknown profile (producer, JSON and tar carriers). This file was
  `0547-compact-prepared-dependency-snapshots.md` (cited by the PR #388 verdict).
  Earlier dated lines keep pre-rename names; their carriers are now
  `dep-snapshot-frozen.contract.test.ts`, `no-coi-frozen-install.contract.test.ts`,
  `no-coi-frozen-vite-install.contract.test.ts`. Goal id, #388 verdict and
  ledger keep `compact` as history.
- 2026-11-23 — the cold-cache refusal names its cause and only the exit every
  reader can run; user: «давай тоже сделаем». `EBROKENLOCK`, `reason:
  'shadow-replay-cache-miss'` (was `shadow-trace-drift`; kept by the manager:
  the terminal branches on it). Disk lock, both terminals and `toolchain.install`
  (terminals prefix `npm: `): `package-lock.json installs <pkg>@<v> from its
  substitute <src>@<v> (shadow recipe <id>), but the tarball cache holds no
  intact copy of it`; replay never downloads substitutes, so the lock cannot be
  reinstalled exactly there; exit: delete `package-lock.json` and install again
  (re-resolves, versions may change). A host-only replay-snapshot exit was
  dropped from the text (it fails on a changed project, §Consequences
  2026-11-23 PR #426): its route lives in §Consequences. Eddy-staged lock (no
  file on disk): the cache lost its intact copy after Eddy seeded it; exit: run
  install again. Each exit is executed by its carrier (Vite node carriers,
  `services/eddy` client test, packed Chromium proof). The prod cache returns
  null for corrupt bytes (`VfsTarballCache.get`), so on-disk corruption gets
  this text and reason; the `has corrupt pinned cache bytes` and `has an
  invalid replay-cache integrity` texts (non-verifying caches, malformed lock
  integrity) are unchanged. Lock-preserving network route stays `owner: user`
  (`docs/backlog/npm-client/shadow-pin-replay-bytes-cold-cache.md`).
