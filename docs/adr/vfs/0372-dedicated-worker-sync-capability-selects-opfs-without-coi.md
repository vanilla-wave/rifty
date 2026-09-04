# ADR 0372: Dedicated-Worker sync capability selects OPFS without COI

Status: Accepted
Date: 2026-09-01
Corrects: ADR-0072 inherited backend-selector clause; ADR-0165 generic detector description only

> TL;DR: Select the paired OPFS backend from dedicated-Worker sync-access-handle capability, not COI or async OPFS presence.

## Context

`detectVfsBackend()` currently selects OPFS only when
`crossOriginIsolated === true` and `OpfsVfs.isSupported()`. That predicate was
grafted from ADR-0013 into ADR-0072 and restated as an isolated-only detector
in ADR-0165.

It does not describe the backend being installed. `installOpfsFs()` always
pairs `OpfsVfs` with `OpfsFsSync`; the latter requires a dedicated Worker with
`FileSystemFileHandle.prototype.createSyncAccessHandle`. The async support
probe sees only `navigator.storage.getDirectory`, including in main windows
where the sync mirror cannot exist. COI is a Playground policy and SAB
requirement, not an OPFS sync-access-handle capability.

Executed current-source evidence (`e924531ba`, Playwright 1.60.0, Chrome for
Testing 148.0.7778.96):

```sh
RIFTY_PLAYGROUND_PORT=5314 pnpm exec playwright test --config playwright.browser-unit.config.ts tests/browser-unit/opfs-no-coi-policy.spec.ts -g preservation
# 4 passed
# no-COI main: async=true, sync=false, memory
# no-COI Worker: async=true, sync=true; direct OPFS flush total=0; after page
# reload a fresh Worker read [0,1,2,127,128,254,255,13,10]
# COI Worker kept OPFS; injected getDirectory denial threw NotAllowedError

RIFTY_PLAYGROUND_PORT=5314 pnpm exec playwright test --config playwright.browser-unit.config.ts tests/browser-unit/opfs-no-coi-policy.spec.ts -g "no-COI capable"
# 1 intended failure: capable Worker detected/installed memory; reload read ENOENT
```

## Corrections (active)

- 2026-09-04 — the landed exact no-COI reload carrier moved intact to
  `tests/no-coi/no-coi-opfs-reload.spec.ts`, so the required no-COI CI lane
  executes I5. The decision and Worker fixture are unchanged.

## Decision

1. `detectVfsBackend()` returns `opfs` iff the current realm satisfies
   `OpfsFsSync.isSupported()`. That method's Worker + sync-access-handle check
   is the one backend-selection authority. Otherwise it returns `memory`.
2. `OpfsVfs.isSupported()` remains the async implementation's own guard. It
   does not select the paired sync backend.
3. Selection is realm-local. Node, main-window and missing-sync-handle realms
   select memory. COI and no-COI capable dedicated Workers both select OPFS.
4. Capability selection does not claim storage permission or durability.
   `installOpfsFs()`/`initBackend()` still reject an init failure; consuming
   realms may apply their existing visible memory fallback. A clean durability
   claim still requires `flush().total === 0`.
5. ADR-0002 and ADR-0165's Playground/Workbench COI hard gate remain. Generic
   VFS capability no longer implies Playground reachability. Page code cannot
   use its main-realm detector result as a proxy for a Worker owner's storage;
   owner-reported state remains authoritative.
6. Public API shape, paired backend, cache/preload/write-through machinery and
   dependencies do not change.

## Alternatives considered

- **Keep COI default; add force/opt-in.** Rejected: the executed browser proof
  shows COI does not discriminate OPFS capability. A knob preserves the silent
  memory trap and adds policy machinery.
- **Select from `OpfsVfs.isSupported()`.** Rejected: async OPFS is true in a
  main window where `OpfsFsSync.init()` must throw, so it authorizes a backend
  the realm cannot install.
- **Optimistically install OPFS and catch every failure as memory.** Rejected:
  it collapses unsupported capability with permission/storage failure and can
  hide a real durability loss. Capability chooses; operation failure remains
  observable.

## Consequences

- Headerless dedicated Workers gain the already-working persistent backend;
  Node and unsupported realms retain memory.
- Main-window calls now describe their own inability to host sync OPFS, not a
  future Worker. Existing owner-backed UI must consume owner state.
- The no-COI lane carrier proves selection, exact bytes and realm recreation
  without weakening the Playground's COI assertion.
- ADR-0072 and ADR-0165 stay active; only the named historical descriptions
  are corrected. The superseded table and D-001→ADR-0002 map do not change.
