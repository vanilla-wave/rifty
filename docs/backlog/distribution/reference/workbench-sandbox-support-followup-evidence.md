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

## Independent Final+GREEN round 1 — BLOCK at `bc371e9951`

Verdict: `docs/backlog/distribution/reference/workbench-sandbox-support-followup-final-green.json`
(round 1 record kept in the PR thread). Two blockers and one concern, all verified and fixed here:

1. A lock persisting past the cleanup deadline reported `cleanup: incomplete`, not the `failed`
   ADR-0439 decision 2 states: the retry's last attempt raced the phase timer and lost, so the
   error arrived after the immutable report. `removeScratch` now reserves the final poll interval.
2. The aggregated cleanup failure dropped the native exception *name* — reason carried
   `AggregateError: Cleanup failed: <message>` with no `NoModificationAllowedError`
   (ADR-0437 decision 1 keeps observed name/message). The aggregate message now carries both.
3. Concern: `cleanup rejection stays explicit` survived a mutant that retried non-lock errors too.

## Independent verify pass — BLOCK at `e7405dc1de`

Verdict: round-2 record in the PR thread. Finding 1's repair was wrong: reserving the final poll
interval does not bound the native call. With `removeEntry` rejecting after 40 ms and
`timeoutMs: 300`, rejections landed at 54/122/189/257 ms, the fifth attempt was issued at 283 ms and
rejected at 323 ms — after the 315 ms report — so the phase timer still published the generic
`incomplete`. Reviewer repro: 3 failed under `--repeat-each=3`.

Settled instead by removing the race from the decision: `removeScratch` reports each lock through
an `observe` callback as it happens, and the report is decided by what was actually observed —
an observed rejection first, then an observed-but-unremoved lock (`incomplete`, naming the native
error), then deadline expiry, then `passed`. Rejection latency can no longer change the status.
ADR-0439 decision 2 now states this; decision 3 records that an observed cleanup rejection outranks
deadline expiry, which also stops the pre-existing silent drop of a disposer error under timeout.

Regression tests committed: the terminal-lock test runs at 0 ms and 40 ms rejection latency and
asserts `cleanup: incomplete` with the native name and message and more than one attempt; the
non-lock test asserts exactly one attempt and its own native name.

Mutant check on the deciding branch (`scratchLock !== undefined` short-circuited to `false`):
both lock tests fail with `Received string: "Cleanup deadline expired; pending native effects
retain late cleanup, removal not yet established"`. Source restored.

## Independent verify pass round 3 — PASS @ `aded87e6e3`, two NOTEs closed

Verdict: `workbench-sandbox-support-followup-final-green.json`. No blockers, no residuals; both
advisory NOTEs were coverage gaps on decisions this PR records, so both were closed in place:

- ADR-0439 decision 3 (an observed rejection outranks deadline expiry) had no discriminating test:
  the reviewer's mutant `cleaned && cleanupErrors.length > 0` passed all 33 tests. Added a joint
  rejection + stalled-disposer test; that mutant now yields `incomplete` where the test wants
  `failed`.
- The non-lock cleanup test matched `/cleanup|denied/i`, which the constant `Cleanup failed:`
  prefix satisfies, so a mutant dropping `: ${error.message}` from the aggregate survived. Both
  non-lock tests now match `/NotAllowedError: cleanup denied/`; the mutant yields
  `cleanup: AggregateError: Cleanup failed: NotAllowedError` and fails.

## Landing Final+GREEN — PASS @ `09384630c9`

`workbench-sandbox-support-followup-final-green.json`: eight axes pass, nine coverage rows pass, no
findings, no residuals. The reviewer re-executed both mutants against byte-identical HEAD tests and
confirmed each dies, and compared the four support assets built by the old and new publishing paths
byte for byte (`PR-4`).

## GREEN

Whole suite on the fixed tree: `34 passed (20.7s)` (29 baseline + five new fault tests).
`pnpm pr:check` 25/25 on the committed tree.
