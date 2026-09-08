# Snapshot application-policy proof

## Baseline / current gap — 2026-09-08

HEAD after static-assets Final+GREEN `214d95d861bf47922db8a4fb8e8836ada5930f92`
(rechart `7dbce1fe7`). Product catalog behavior is unchanged from the
2026-09-07 probe at `1f5a932fe` / baseline `333224fe`.

`playground-project-definition.ts` `identityFields()` includes
`snapshot-id:` in baseline identity. `createScratch` preserves dirty bytes
only when `preserveDirtySameStarter` and `baselineMatches`. `openProject`
throws `ProjectDefinitionMismatchError` when `proofMatches` fails.

Recorded disposable catalog probe (embedder-gaps-evidence Re-fit):

```text
pnpm exec vitest run packages/workbench/src/workers/temporary-refine-scope-audit.test.ts -t 'scope audit:'
Vitest 2.1.9: 1 passed, 50 skipped.
Before: dirty=true, user.txt contains "user edit".
REFINE_SCOPE_SNAPSHOT_UPDATE {"dirty":false,"userFileExists":false}
```

Temporary probe removed. Same-definition reload preservation still stands
because it never changed snapshotId.

No `snapshotApplication` field exists on `PlaygroundProjectCatalog.createScratch`
or open options. No `SnapshotApplicationConflictError`.

## RED — 2026-09-08

Node v24; Vitest 2.1.9.

```text
pnpm exec vitest run \
  packages/workbench/src/workers/workbench-snapshot-application.contract.test.ts \
  packages/workbench/src/workers/workbench-snapshot-application.fault.test.ts
13 failed / 0 passed.
```

Failures are the missing I8 policy, not import/typecheck:

- default/`initial-deployment-only` `createScratch` reseeds dirty Scratch when
  only snapshotId changes (`dirty=false`, `user.txt` ENOENT)
- named `openProject` throws `ProjectDefinitionMismatchError` on snapshotId drift
- apply error does not throw `SnapshotApplicationConflictError`
- apply overwrite and identical-payload cases wipe extras
- unused new snapshot is fetched after reseed
- `SnapshotApplicationConflictError` is absent from `@riftydev/workbench`

`tsc -p packages/workbench/tsconfig.json --noEmit` reports no errors in these
files. First URL-validation failures used `https://host.test/...`; carriers now
use same-origin `/snapshots/*.json.gz` resolved against the playground client.
