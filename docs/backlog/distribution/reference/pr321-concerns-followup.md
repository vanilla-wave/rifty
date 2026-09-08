# PR #321 review follow-up — 2026-09-08

Baseline: 0e065420ca0e67ac55480c64c09e2c87a03fd970.
User authorized evaluating the inline concerns, appropriate fixes, green CI and merge.

| Concern | Disposition |
| --- | --- |
| Sequential preload | Measured real Vite7/8 snapshot bytes against pre-PR code; retain implementation. Native lookups reduced; no consistent elapsed regression in these samples. Not a thousands-file or cold-page performance claim. See pr321-preload-measurement.md and raw comparison JSON. |
| Streams use guarded mirror | Keep Node-consistent immediate sync-write visibility; real native-pending browser carrier uses the same consumer as Node24. Add CHANGELOG. See pr321-concerns-carriers.md. |
| Unreadable entry refuses boot | Retain accepted ADR-0393. Clearing all storage is not the only recovery: transient retry or host-side repair of the entry can restore boot. Document guidance; no new recovery policy. |
| SDK/Worker protocol mismatch | SDK CHANGELOG and README now state v3 and upgrading the two artifacts together. |
| Edited esbuild.wasm error | Preserve the actual adapter/integrity error, instead of misclassifying compatible installation authority. Document explicit-install repair. |
| Named errors | Document `error.name`; no exported error subclasses or `instanceof` promise. |
| Unreadable equality proof | Direct getFile and arrayBuffer rejection carriers prove write/heal and honest quota ledger behavior; no product change needed. |
| EvalOptions comment | Keep concise comment: restoring the old block makes host.ts 803 lines (current 797), exceeding the 800-line cap. No semantic change. |

## CI recovery-copy defect

`no-coi-chromium` failed the existing `recovery copies scale with edits and
same-OPFS restart omits tree bytes` test. Snapshot construction had started using
the newly guarded guest reader, copying every file before structured clone.
Class: sibling-drift at owner/guest read semantics. Install and open share the
same snapshot producer; host-owned copy/patch budgets remain unchanged.

Repair: construction-local `readRecoveryFile` borrows owner bytes only for the
outgoing snapshot. Guarded guest reads still return detached bytes, preserving
stamp alias protection. Structured clone remains the ownership transfer.

PR-4 measurement adjustment: old observer compared snapshot bytes with a second
*guarded* read, which is now necessarily detached. Observe the forwarded raw OPFS
read result instead. All existing true/byte-count assertions stay unchanged.
The adjusted observer still reproduced RED before the product repair.

Command: `RIFTY_NO_COI_PORT=5571 RIFTY_NO_COI_ORACLE_PORT=5572 RIFTY_NO_COI_RESOURCE_PORT=5573 pnpm test:no-coi no-coi-dev-hmr.spec.ts -g 'recovery copies scale'`.
Real Chromium 148: RED `reusedMirrorBytes:false`; GREEN 1/1 (15.3s), including
unchanged install/edit copy counts and same-OPFS restart byte omission.

## CI drain performance failure

CI34243169765 passed exact-byte checks and 3.79x speedup but failed the separate
write-probe projection: 44834.69ms > 15036.3ms. The unchanged isolated test passed
3.209x, projected 6.70ms ≤4146.8ms. Preload occurs outside both timed drain windows;
one macOS pass cannot establish the Linux cause. Preserve every threshold and
await the new CI result; do not manufacture GREEN by editing the benchmark.

## Final verification

`VITEST_MAX_THREADS=4 VITEST_MIN_THREADS=1 VITEST_MAX_FORKS=4 VITEST_MIN_FORKS=1 pnpm pr:check`:25/25 PASS; test:run182.3s, parity61.1s. Assertions/timeouts unchanged.
Independent `/root/concerns_final_review`: Final+GREEN PASS at ba59f8a0d3fd47765cde66a3b2643a44caa30233, no findings. Independently executed stream1/1 and unreadable-dedup1/1; PR-4 confirms the recovery observer retains the no-copy criterion. Record: pr321-concerns-final-green.json.

## Linux CI stream-carrier race

CI34258496002 on 4e9a10ea8 passed all product suites, including the unchanged
browser-unit/performance lane and recovery-copy regression. Only the new stream
carrier failed with native NotReadableError;59 other no-coi cases passed.
The carrier polled getFile/arrayBuffer after releasing a pending replacement,
so a File snapshot could become unreadable between acquisition and consumption.

Readback now follows the existing runtime.eval flush acknowledgement. The full
and windowed stream comparisons still run while native persistence is held;
both old-durable-byte assertions, Node oracle, and final exact persisted bytes
are unchanged. No retry, sleep, threshold or product change added.
`pnpm test:no-coi no-coi-stream-visibility.spec.ts --repeat-each=3` with ports
5591/5592/5593 passed3/3. Full local pr:check evidence remains valid for unchanged
product; the edited browser carrier and lint are rechecked before push.
