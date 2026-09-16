# checkSandboxSupport follow-up — observed defects, RED and GREEN

Baseline: PR #340 at `69bd0dd6c` (merged). Suite command, all runs below:

```sh
RIFTY_PLAYGROUND_PORT=5539 pnpm exec playwright test --config playwright.browser-unit.config.ts \
  tests/browser-unit/sandbox-support.spec.ts --workers=1 --reporter=line
```

Baseline before any change: `29 passed (18.9s)`.

## D1 — deadline inside the OPFS phase leaks the scratch directory

Boundary: Storage (OPFS) × dedicated Worker teardown. Axis: `concurrent-same-key`
(`docs/process/rules/fault-classes.md`) — the terminated Worker's sync access handle and
the cleanup remover reach the same key. Fault injected at the browser boundary only:
host fixture variant `/storage-slow/` holds `createSyncAccessHandle` open for 1800 ms;
caller `timeoutMs: 300`.

RED at `69bd0dd6c` + the new test (`-g "deadline inside the OPFS phase"`):

```
Error: cleanup: AggregateError: Cleanup failed: Failed to execute 'removeEntry' on
'FileSystemDirectoryHandle': An attempt was made to modify an object where modifications
are not allowed.
expect(received).not.toBe(expected) // Object.is equality
Expected: not "failed"
  403 |   expect(report.cleanup.status, report.cleanup.reason).not.toBe('failed');
  1 failed
```

Root cause: `worker.terminate()` returns before Chromium releases the Worker's OPFS sync
access handle, so the immediately following `root.removeEntry(name, {recursive:true})`
meets the lock. The single-attempt disposer then reports `cleanup: failed` and nothing
removes the directory afterwards — a permanent leftover in the caller's origin storage.

Sibling sweep (`rifty-fix` 2): `createSyncAccessHandle`/`removeEntry` call sites are
`packages/vfs/src/{opfs-sync,opfs,opfs-replica-store}.ts` and this probe. Only
`opfs-replica-store.ts` `acquireGuard` crosses a terminated Worker — ADR-0428 states the same
platform fact and waits it out with the same contention error and a 25 ms poll. Second
reachable instance, so it is recorded rather than consolidated (§Class-kill); ADR-0439 records
why the twins stay separate.

Fix: `removeScratch` in `packages/workbench/src/support/check-sandbox-support.ts` retries
only `NoModificationAllowedError`, only until the cleanup deadline ADR-0437 decision 5
already owns (ADR-0439). Every other rejection stays immediate; late uncancelable effects
run past that deadline and keep their single attempt.

## D2 — a late Worker failure retracted the observed module-worker load

Axis: `provenance-lie` — a passed observation replaced by a failure that did not disprove it.
Fixture variant `/late-error/`: the Worker throws from a timer after its load was already
reported, with the OPFS probe still pending.

RED at `69bd0dd6c` + the new test (`-g "late Worker failure"`):

```
Error: expect(received).toBe(expected) // Object.is equality
Expected: "passed"
Received: "failed"
  412 |   expect(row(report, 'module-worker').status).toBe('passed');
  1 failed
```

Root cause: `worker.onerror` called `workerFailed`, which unconditionally wrote
`failure('module-worker', …)`. Fix: once the load is observed, a later Worker failure only
rewrites the Worker-dependent rows still `incomplete` (`WORKER_EVIDENCE` in
`packages/workbench/src/support/report.ts`), naming that failure in their reason.

## Published-asset criterion (PR-4)

Before: the browser test shelled out to `tools/publishing/build-workbench-assets.mjs`,
rebuilding every runtime worker bundle and the WASM copies, and served `/published/` from
the half-written `packages/workbench/dist/assets` of the working tree.

After: `tools/publishing/build-support-assets.mjs` owns the support step; the publishing
script calls it and asserts the four documented filenames landed in `dist/assets`, and the
browser suite calls the same function into a `mkdtemp` directory it serves and removes.
The proof that the assets are produced by real publishing code is unchanged; the proof that
publishing emits them into the shipped directory moves from the browser test to that assert.

## GREEN

Whole suite on the fixed tree: `31 passed (19.5s)` (29 baseline + the two new fault tests).
