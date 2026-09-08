# Orphan Scratch recovery evidence — 2026-09-09

Baseline for this compile: `92ee86d98f4c8e65251b18fc62e645a963217d12`
(I4 Final+GREEN + rechart). Goal I6 and intake:
`docs/backlog/distribution/reference/embedder-gaps-evidence.md` (I6:
unjournaled orphan blocks createScratch; recovery handles owned
journals/stages, not this case).

## Current block

`createScratch` with `catalog.scratch === null` uses role `create`.
`assertCatalogMutationPreconditions` throws when
`/.rifty/workbench/v1/projects/scratch` already exists.

`PlaygroundProjectCatalog` has no retain/list/download methods.
`createPlaygroundProjectCatalog` and the page catalog proxy forward only
snapshot/subscribe/createScratch/saveScratch/activate/rename/reset/delete.

Intake Chromium probe (same throw): plant
`/.rifty/workbench/v1/projects/scratch/tree/user.txt` bytes `orphan bytes`
without catalog.json or transaction.json → hiddenEmptyBoot
`persistence:'required'` → `Catalog mutation target already exists: scratch`.

## I6 REDs

Vitest 2.1.9, Node v24.16.0, 6 failed for unimplemented retain/download
(not import/typecheck):

```text
$ pnpm exec vitest run \
  packages/workbench/src/workers/playground-orphan-scratch-recovery.contract.test.ts \
  packages/workbench/src/workers/playground-orphan-scratch-recovery.fault.test.ts
6 failed
- listRetainedOrphans is not a function (empty catalog)
- Catalog mutation target already exists: scratch (planted-orphan create,
  reopen, retry)
- expected already-exists message not to match /already exists/i; wanted
  quota|permission (persist-fail preserve)
```

Playwright 1.60.0 Chromium, `RIFTY_PLAYGROUND_PORT=5411`:

```text
$ RIFTY_PLAYGROUND_PORT=5411 pnpm exec playwright test \
  --config playwright.browser-unit.config.ts orphan-scratch-recovery.spec.ts
1 failed: firstBoot {ok:false, messages:["Catalog mutation target already exists: scratch"]}
  after planting the orphan under a host-selected OPFS namespace (not
  import/NotFound).
```
