# Workbench storage-namespace evidence — 2026-09-09

Baseline for this compile: `67496f8ca7cdbd881d286741be5bbd841bd21cb8`
(I3 Final+GREEN + rechart). Goal I4 and intake:
`docs/backlog/distribution/reference/embedder-gaps-evidence.md` (I4:
`installOpfsFs` has no root; init gets origin root and preloads all files).

## Current pairing

`packages/vfs/src/sync-mirror.ts` `installOpfsFs()` takes no options.
`OpfsVfs.init()` and `OpfsFsSync.init()` each call
`navigator.storage.getDirectory()` and bind that origin handle. Sync
`init` then `refreshIndex` + `preloadContent()` over the whole tree.

```text
$ wc -l packages/vfs/src/sync-mirror.ts packages/vfs/src/opfs.ts packages/vfs/src/opfs-sync.ts
     177 packages/vfs/src/sync-mirror.ts
     344 packages/vfs/src/opfs.ts
    1195 packages/vfs/src/opfs-sync.ts
```

`packages/workbench/src/workers/workbench-owner-storage.ts` default
`openOpfs` is `installOpfsFs` with no argument.
`runWorkbenchOwner` passes only `config.storage.persistence`.

## Current admission

`WorkbenchOptions.storage` is `{ persistence }` only.
`validateWorkbenchOptions` does not `exact()` storage keys: an extra
`namespace` is ignored and `ValidatedOptions.storage` is the persistence
string. `open-workbench` then sends `{ persistence }` only.

`inspectBootConfig` `exact(storage, ['persistence'])`: an extra
`namespace` is rejected as invalid owner boot storage policy.

```text
$ pnpm exec vitest run packages/workbench/src/workbench/open-workbench.contract.test.ts \
  --testNamePattern 'passes one normalized owner input'
✓ uses the exact 3s default for SW proof and passes one normalized owner input
  (Vitest 2.1.9; Node v24.16.0)
```

No public `storage.namespace`. No namespaced `installOpfsFs`. A host
sentinel at the origin root is in the preload set.

## I4 REDs

Vitest 2.1.9, Node v24.16.0, 17 failed for unimplemented namespace
behavior (not import/typecheck):

```text
$ pnpm exec vitest run \
  packages/workbench/src/workbench/workbench-storage-namespace.contract.test.ts \
  packages/workbench/src/workers/workbench-storage-namespace.contract.test.ts \
  packages/vfs/src/opfs-storage-namespace.contract.test.ts \
  packages/vfs/src/opfs-storage-namespace.fault.test.ts \
  packages/workbench/src/workbench/open-workbench.contract.test.ts \
  --testNamePattern 'storage.namespace|storage namespace|OPFS storage namespace'
17 failed | 39 skipped
- admitted.storage is the persistence string 'required'
- invalid namespace does not throw
- owner.start storage is { persistence: 'required' } only
- openOpfs() called with no arguments
- OpfsVfs.init({ namespace }) still lists origin host.txt
- init({ namespace: '..' | 'blocked' | 'ns-b' }) resolves instead of rejecting
```

Playwright 1.60 Chromium, `RIFTY_PLAYGROUND_PORT=5411`:

```text
$ pnpm exec playwright test --config playwright.browser-unit.config.ts \
  opfs-storage-namespace.spec.ts
1 failed: invalidThrew is false — installOpfsFs({ namespace: '..' }) is
ignored and binds the origin root (not import/NotFound).
```
