# No-COI recovery copy evidence

Baseline: 59df0c0a3, Node v24.16.0, pnpm 11.5.2, Vitest 2.1.9,
Playwright 1.60.0 Chromium, macOS arm64. 2026-09-06.

## RED

`pnpm exec vitest run packages/runtime-js/src/host-recovery.fault.test.ts`

2 failed, 6 passed. Write copy counter: expected 3, actual 1048581;
same-OPFS restore expected no files, actual full 2-file recovery tree.
Other backend pairs, ordered writes, caller isolation, quota rejection and
peer-death preservation passed on baseline.

`RIFTY_NO_COI_PORT=5511 RIFTY_NO_COI_ORACLE_PORT=5512 RIFTY_NO_COI_RESOURCE_PORT=5513 pnpm test:no-coi -g 'recovery copies scale'`

1 failed on three cost assertions; Vite installed, served, restarted, served
its saved marker. Public source edit copied 29,528,068 untouched bytes
(expected 0). Same-OPFS restore posted 269 files (expected 0). Install copied
59,056,136 bytes; restart copied 88,584,213 bytes. With one input snapshot and
one restore-input copy, restart must equal twice the sole install copy plus
the exact source-byte delta. All failures were assertion failures, no
import/typecheck/timeout failures.

No Node filesystem behavior changes: restart is SDK-specific, owned by
ADR-0377 D2. Existing alias tests and real memory Vite restart are regression
oracles. Byte copies at external caller boundaries remain deliberate.

## Journal

2026-09-06 — runtime-js/no-coi-recovery-copy band 3–4 rounds 2; standalone pickup.

2026-09-06 — Contract+RED PASS @ 3262ac8d6; 0 blockers, 4 advisory concerns.
C1 constructor counter misses slice; C2 page counter misses Worker pre-copy;
C3 install count needs independent byte size; C4 replacement boot/restore
failure needs its own recovery test. All addressed before implementation:
count slice too, observe real mirror byte identity at Worker postMessage,
compare page copy bytes to Worker tree size, exercise boot/restore/beforeStart
failure and two subsequent retries against the real SDK/host.

Strengthened browser RED (same command): 5 assertion failures. Worker mirror
identity false (expected true); install 59,056,136 vs 29,528,068; edit
29,528,068 vs 0; restore 269 files vs 0; restart 88,584,213 vs 59,056,142.

## GREEN and mutation proof

61 host/SDK tests passed after implementation. Recovery fixtures reduced from
1 MiB to 1 KiB to avoid expensive deep-array comparisons; allocation assertions
still discriminate a single untouched byte. Typechecks for runtime-js and SDK
pass after annotating spy `this` and importing protocol types via the package.

Chromium recovery cost test passed: install page copy 29,528,068 bytes (one
independently observed Worker tree), source edit 0 untouched bytes, same-OPFS
restore 0 files, restart 59,056,142 bytes (two detached boundary copies).
Worker outgoing file data has the same identity as actual OPFS mirror bytes.

C1 mutation recheck: Vitest pre-transform adds `.map(file => ({...file,
data: file.data.slice()}))` after the host's recovery file filter; command
`pnpm exec vitest run --workspace /tmp/rifty-recovery-slice-mutant.workspace.mjs -t 'copies only the written bytes'`
→ 1 failed / 7 skipped, expected 3, received 1027. No tracked code changed.
The strengthened test kills the reviewer's demonstrated full-copy bypass.

Full no-COI Chromium: 40/40 passed (3.9m). Decisive committed-tree rerun at
c070fca4e: `pnpm test:no-coi -g 'recovery copies scale|memory-backend restart|real Vite HMR survives'`
with the same dedicated port assignments → 3/3 passed (32s).

First pr:check ran before the test type fixes: test:run passed; typecheck found
spy-this and cross-package source-import errors, fixed at c070fca4e. A fresh
full committed-tree pr:check follows; no behavioral test was weakened.

## Final review round 1

2026-09-06 — Final+GREEN @ f773b91aa: B1 HOLDS after fresh adjudication.
Host restore retained the previous source label; OPFS→memory→ACK write→OPFS
then stripped required bytes, and memory→OPFS→OPFS resent the tree. Worker and
SDK consume the host label; the host's successful-restore commit is the single
provenance owner. No new coordination mechanism or wire/API shape.

2026-09-06 — re-cut: clarify Acceptance 3's current-owner provenance; the newly
added pair-matrix equality incorrectly froze the original label after a flip.
Only that new assertion is corrected to target-backend equality; exact file
assertions and all pre-existing tests remain. Trace: ADR-0377.

Committed cycle targets: host `successive restores` → 2 RED; real Chromium
`successive OPFS-memory` → stale [1,2] after memory ACK [9,8] (expected [9,8]).
Both are assertion failures, not imports/timeouts. Same dedicated-port command.

Advisories addressed in the batch: count sized Uint8Array allocation and
restart slice; seed files outside cwd and inside /.rifty before memory install,
then assert their exact bytes after real memory restart. No scope reduction.

## Round 1 repair proof

At 6c7f22d10: host/SDK 63/63; full no-COI Chromium 41/41. The real sequence
OPFS→memory→ACK [9,8]→OPFS→OPFS now reads [9,8] on both OPFS generations;
wire carries files for the two flips and none for the last same-OPFS restart.
Memory Vite recovery also preserves pre-install files outside cwd and in /.rifty.

Sized-allocation mutant: the host filter is followed by `.map(file => {
const data = new Uint8Array(file.data.byteLength); data.set(file.data);
return {...file, data}; })`. `pnpm exec vitest run --workspace
/tmp/rifty-recovery-sized-mutant.workspace.mjs -t 'copies only the written bytes'`
→ 1 failed, 9 skipped, expected 3, received 1027. No tracked source mutation.
Constructor+slice+sized-allocation counters keep the real copy-cost scenario
GREEN while rejecting both demonstrated full-copy mutants.

## Closure

2026-09-06 — re-chart after runtime-js/no-coi-recovery-copy (final-green PASS @ 16b1e93de15a93490a0fc598e626e3e1ba8de4a4): 15/15 coverage pass; 0 blockers, concerns or residuals; round 1/2. Full committed pr:check 24/24, Chromium 41/41, host/SDK 63/63. Completed standalone contract deleted; history retains it at the reviewed SHA.

The separate static OPFS preload-failure finding remains an independent draft;
no preload correctness repair or latency guarantee is claimed by this unit.
