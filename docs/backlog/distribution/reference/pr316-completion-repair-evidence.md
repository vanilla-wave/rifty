# PR316 — completion repair evidence

Authority: accepted self-hosted-snapshot-workbench goal at 666b2687b;
observed PR316 baseline 82fc9a08a. Main integration 6e0c2b9f9 includes accepted
main a1c9fdb61. New facts reopen the claimed whole-goal completion, not its scope.
Original goal/ledger and previous reviews remain in git history.

## Preparation and decisions

- B1: real public producer Vite7.3.6 → fresh or same-ID apply/overwrite → real
  npm run build exits1: `vite CLI files must be prepared by acquisition before promotion`.
  Initial-mode control builds. Chromium 148.0.7778.96; all 43 copied runtime assets
  equal source 82fc9a08a assets. Source probe also reports ready + trusted before refusal.
- Source birth: dep-snapshot-producer install→serialization omits finalization;
  initial restore/registry acquisition finalize, explicit overlay does not.
  Siblings: first-party baker; Vite CLI/root-watch; pinned hoisted/nested emnapi CJS;
  no-COI generic-only preparation. ADR-0412 records the independent decision.
- Class: sibling-drift/provenance-lie at owned in-process installed-file projection.
  This boundary physically excludes transport loss/duplicate/reorder; no transport
  mechanism is added. Existing snapshot network and catalog storage fault tests remain.
- Main merge: ADR-0393 strict preload supersedes ADR-0406 best-effort; goal I4/I6/I8
  unchanged. Native getFile/arrayBuffer refusal → preferred empty memory owner;
  required refusal and source/outside bytes remain. Class provenance-lie/quota-perm-fail at storage
  selection, no physically excluded storage faults. ADR-0411 records the DEC-2 decision.
- Independent read-only decision researcher snapshot_preparation_decision compared
  raw goal/ADRs/current sources and original source/native logs. Planners preserve
  I8 literal bytes; no live-target finalizer or ambient filesystem switch.

## Native preload RED

`RIFTY_PLAYGROUND_PORT=5607 pnpm exec playwright test --config playwright.browser-unit.config.ts --workers=1 tests/browser-unit/opfs-preload-honesty.spec.ts tests/browser-unit/workbench-preload-honesty.spec.ts tests/browser-unit/workbench-storage-namespace.spec.ts --grep 'preload|uncached rename|genuine empty|namespace proof refusal|namespace occupied|native namespace file conflict'`

2026-09-09: 15 cases, 13 PASS/2 RED, 12.5s. Only preferred getFile/arrayBuffer cases
returned success with backend memory; real injected error reason remained in fallback.
Required 2, cold-cache 7, namespace acquisition/proof 4 controls passed. Exact output:
/tmp/rifty316-fix-merge-preload-red.log. No product guard changed before this run.

## PR-4 integration criteria

The old cold-cache fixture expected a second getFile and successful partial init.
Main ADR-0393 performs one traversal and rejects any failed acquired-tree read.
Replaced that obsolete preparation assumption with real constructor/metadata-only
refresh plus failed explicit preload; healthy/empty/copy/cp/rename byte custody
and error ordering retained. New public native tests require refusal and safe retry.
Extraction inventory 152 + 4 main modules + 1 source-readiness owner = 157; exact source-closure equality remains.

## Snapshot RED

`pnpm exec vitest run --project unit packages/workbench/src/workers/workbench-snapshot-apply-preparation.contract.test.ts`:3RED/1PASS,12.64s. Fresh/same-ID apply fails actual Vite startup preparation. Original npm Vite files in JSON/tar both pass legacy initial startup but incorrectly apply as ready, mutate prior files and omit the rebake error. Untargeted malformed saved Vite survives ms apply (positive I8 control).

Output: /tmp/rifty316-fix-snapshot-apply-preparation-red-isolated.log. An earlier combined run exhausted Vitest memory while formatting failing spy arguments; assertion diagnostics changed to booleans/counts, same predicates retained. That aborted run is not counted as a complete RED battery.

`pnpm exec vitest run --project unit packages/workbench/src/glue/dep-snapshot-preparation.contract.test.ts`:1RED,12.57s; emitted producer payload fails existing Vite startup preparation; ambient owner bytes remain unchanged. Output: /tmp/rifty316-fix-snapshot-producer-preparation-red-isolated.log.

Implementation selects explicit-Fs registry planners; producer/baker prepare before serialization and explicit apply validates source-only readiness. Existing full/generic finalizers share these transforms; no post-apply mutation or recipe identity change. Preferred storage rethrows typed acquired-tree preload failures.

## Repair GREEN and counterfactuals

Real fixture contract battery: 4 files/100 tests PASS, 28.18s
(/tmp/rifty316-fix-preparation-green.log). Includes actual installed Vite startup,
unchanged literal payloads/untargeted saved bytes, concurrent producer filesystem
isolation, JSON/tar legacy-initial compatibility, and both genuine emnapi CJS
forms at hoisted/nested paths.

Removing only producer finalization: 1 test RED, actual Vite acquisition-preparation
refusal. Removing only incoming source validation: 3 selected tests RED;
JSON/tar and all four emnapi forms incorrectly become ready and mutate prior
payload/cache/claim bytes. Both product lines restored in finally. Logs:
/tmp/rifty316-fix-revert-producer-preparation.log and
/tmp/rifty316-fix-revert-source-readiness.log. The runner's final log-pattern
assertion expected literal `rebake`, whereas Vitest printed `/re-?bake/i`;
manual inspection confirms semantic failures, not infrastructure RED.

Native preload/namespace/cold-cache battery: 15/15 PASS, 11.3s
(/tmp/rifty316-fix-merge-preload-green.log), same command as RED above.

Guard counterfactual for preferred persistence: removing only the typed rethrow
produces 2 preferred RED/2 required PASS, 7.4s
(/tmp/rifty316-fix-merge-preload-counterfactual.log). Restored source: 4/4 PASS,
7.1s (/tmp/rifty316-fix-merge-preload-restored-green.log).

New contract imports use the existing public runtime entry (Vite --version) and
generic finalizer; no cross-package source import or test-only public export.
After import correction: 2 files/6 tests PASS, 16.23s
(/tmp/rifty316-fix-preparation-public-import-green.log); Workbench typecheck PASS.
Existing exact emnapi transform assertions remain in the integration suite.

## Fault matrix

| Boundary / axis | Required outcome and carrier | Trace |
|---|---|---|
| Installed-file projection / sibling-drift | Both concurrent producers emit real startup-ready Vite; ambient owner bytes unchanged. dep-snapshot-preparation.contract.test.ts | → I1 + ADR-0412 |
| Source admission / provenance-lie, observable-order | Unprepared JSON/tar and four real emnapi CJS locations/forms refuse before live payload/cache/claim effects; legacy initial control works. workbench-snapshot-apply-preparation.contract.test.ts | → I3 + I8 + ADR-0412 |
| Source admission / sibling-drift | Prepared fresh/same-ID apply preserves archive bytes; applying ms leaves unrelated malformed saved Vite untouched. Same contract file and packed scoped-preview carrier | → I8 |
| Concurrent producers / concurrent-same-key | Private explicit filesystems preserve the ambient owner during simultaneous registry awaits; no shared publication state. dep-snapshot-preparation.contract.test.ts | → I1 + ADR-0412 |
| Acquired OPFS tree / quota-perm-fail, provenance-lie | getFile/arrayBuffer failure rejects required and preferred owners without touching native bytes; retry succeeds. workbench-preload-honesty.spec.ts | → I4 + I8 + ADR-0411 |
| Cold-cache OPFS / provenance-lie, observable-order | Missing bytes cannot read/copy as empty; genuine empty bytes, cp partial effects, rename custody and writes remain honest. opfs-preload-honesty.spec.ts | → ADR-0406 + ADR-0411 |

No new network/cache identity/write-transaction mechanism: existing snapshot
corruption/caps/replay, overlay interruption, namespace and orphan preservation
carriers remain obligations and run in the full/source or native suite. The
projection row alone excludes transport loss/duplicate/reorder; native persistence
retains its full fault surface. This repair creates no new concurrency authority.

## Packed composition and emitted criteria

`node tests/integration/workbench-packed-consumer.mjs --keep`: PASS on Chromium
148.0.7778.96; 15 first-party + 83 external tarballs; fresh offline consumer
install, TypeScript and production build; public producer CLI and ordinary tar
restoration. Expanded scoped proof: 6 actual build/dev opens, 4 HMR edits,
3 durable default reopens, same-ID overwrite and fresh apply; literal Vite
package edit restored by overwrite, unrelated project edits retained. Existing
asset/API/query/SW-stop-restart/outside-host and zero registry/Eddy assertions
remain. Output: /tmp/rifty316-fix-packed-green.log. Consumer retained under
/var/folders/db/686y1tsx0cj84rn_2jmrf9680000gn/T/rifty-workbench-packed-consumer-ZqzsmR/consumer.

PR-4 emitted compiler inventory: typescript-worker.js remains exactly 10,022,664
bytes. Old SHA cddf156d671c4b39abeae202b84cd907b6d936974e9537481da6a30773b07e58;
new SHA 3587a112e6f0bbae3bb9ca4565404c8ce572a5cbb146440ee2e7a4ecf7b02cf6.
Byte comparison is identical after replacing only emitted relative chunk and
module-loader import basenames (six changed references). No compiler body,
size ceiling, other compiler/WASM pin or inventory exception changed. Exact
old/new diff: /tmp/rifty316-compiler-asset.diff; frozen old artifact:
/tmp/rifty316-pre-repair-typescript-worker.js. This updates one fingerprint;
the exact carrier gate rejected it before the update.

PR-4 package acquisition gate: the new producer-owned preparation call is now
allowed only in dep-snapshot-producer.ts / produceDependencySnapshot, matching
ADR-0412 private-Fs acquisition. Claim writes retain their separate authority;
sibling/top-level preparation and a same-named function in another module are
still rejected. New positive/negative gate test: 1 RED before context registration;
13/13 GREEN after, repository scan PASS. Logs:
/tmp/rifty316-fix-producer-gate-red.log and
/tmp/rifty316-fix-producer-gate-green.log. No broad source exclusion added.

First full source gate: 24/25 PASS; test:run229.7s, parity62.8s.
Only the producer's previously unregistered acquisition context failed;
its independently exercised positive/negative gate repair is recorded above.
Full output: /tmp/rifty316-fix-prcheck.log. This run is not called an overall PASS.

## Native current-tree persistence

`RIFTY_PLAYGROUND_PORT=5607 pnpm exec playwright test --config playwright.browser-unit.config.ts --workers=1 tests/browser-unit/opfs-storage-namespace.spec.ts tests/browser-unit/workbench-storage-namespace.spec.ts tests/browser-unit/workbench-web-lock.spec.ts tests/browser-unit/workbench-orphan-scratch-recovery.spec.ts tests/browser-unit/workbench-legacy-receipt.spec.ts tests/browser-unit/workbench-snapshot-application.spec.ts tests/browser-unit/operation-storage-budget.spec.ts tests/browser-unit/opfs-preload-honesty.spec.ts tests/browser-unit/opfs-preload-handles.spec.ts tests/browser-unit/install-mirror-proof.spec.ts tests/browser-unit/workbench-preload-honesty.spec.ts`

Full62: 60 PASS/2 observer FAIL, 39.4s (/tmp/rifty316-fix-native-full.log).
Both failures: strict preload rejected before the orphan fixture's old try/finally,
so its reply lost deniedReads/custody. Native trace shows actual OpfsPreloadError;
/tmp/rifty316-fix-orphan-observer-red-proof.json. Expanded only that fixture's
observation/cleanup lifetime across initialization; all original assertions remain.
Entire affected orphan spec: 18/18 PASS, 18.7s
(/tmp/rifty316-fix-orphan-lifecycle-green.log); other44 passed and were not repeated.
Thus all62 current-tree cases covered, including native crash/reopen, exact custody,
namespace/default isolation, IO fencing and strict all-or-error preload.
Fixture standalone tsc/Biome/diff-check PASS. This is PR-4 carrier reconciliation
with ADR-0411, not a change to preservation criteria or a product bypass.
