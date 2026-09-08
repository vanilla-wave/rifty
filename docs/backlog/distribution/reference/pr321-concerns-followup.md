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
