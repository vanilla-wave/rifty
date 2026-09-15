# Workbench prerequisite pickup

Authority: original user answers in `workbench-sandbox-support-refine.md`;
implementation hand-off: PR #340, same PR, green CI. ADR-0437 owns the API.
Fresh read-only source audit: `/root/requirements_audit`, 2026-09-15.

## Composition mapping

| Operation | Existing authority / consequence |
|---|---|
| DOM / COI / Worker / page locks | `workbench/open-workbench.ts:706`; exclusive admission at :636. Probe a private lock, never the origin lease. |
| Module Worker + cloned ports / SAB | `kernel/src/worker-like.ts:43`, `spawn-worker.ts:351`; `runtime-js/src/host.ts:310`. |
| Nested Worker | `workers/owner-child-node-executor.ts:278`, `owner-child-dev-server.ts:148`; COI owner-to-child path. |
| Dynamic import + JS eval | `kernel/src/worker-entry.ts:271` indirect eval importer; `runtime-js/src/module-loader/cjs.ts:1823` and `repl/eval.ts:19` use Function, independently of VM selection. |
| SAB / Atomics wait, notify, waitAsync | `workbench-browser-owner-spawn.ts:51`; `kernel/src/ipc/capabilities.ts:25`; `sab-ring.ts:141/277/291`. COI only. |
| WASM | COI default QuickJS: `workers/kernel-worker-entry.ts:40`, `runtime-js/src/ipc/install-process.ts:125`, `builtins/vm/engine-config.ts:32`. Non-COI rewrite default (`rifty/src/sandbox.ts:292`); QuickJS/workload selection requires WASM. |
| BroadcastChannel | `net/src/cross-realm/preview-port.ts:278/682`; both compositions' preview path. |
| SW | COI register then control proof `open-workbench.ts:193`; SDK SW denial retained as swError and boot continues `rifty/src/sandbox.ts:676`. Probe both classic and module registration; deployment control remains unverified. |
| OPFS | `workers/owner-storage.ts:46/61`, `vfs/src/opfs-replica-store.ts:62/92/173/271`: sync handle guard plus createWritable/write/close, getFile/read, deletion. Private directory only. Existing replica admission errors are not browser incompatibility. |
| UUID | `workbench-owner-storage.ts:50/192`; OPFS proof path. Probe ownership also needs an unpredictable private name. |
| Sync XHR | `glue/sqlite-wasm-provider.ts:14/29`; optional SQLite workload, not ordinary JS/QuickJS boot. Asset-specific SQLite setup remains deployment/workload evidence. |

## Native reference and RED

Existing native Chromium reference scripts/versions/results live in refine and
CSP evidence; no oracle claims inferred from API presence. Current browser suite
`tests/browser-unit/sandbox-support.spec.ts` serves native HTTP CSP on Worker
responses and native SW requests. Faults decorate unavailable browser/storage
boundaries only; no rifty package is mocked. Baseline public module loads; the
missing callable export is an explicit assertion failure, not an import failure.

Command: `RIFTY_PLAYGROUND_PORT=5539 pnpm exec playwright test --config
playwright.browser-unit.config.ts tests/browser-unit/sandbox-support.spec.ts
--workers=1 --reporter=line`. Raw run: `/tmp/pr340-red.log`.

Current-session rerun (port 5540): 23 RED (missing callable export), 1 GREEN
(legacy synchronous passive API), 18.6 s; `/tmp/pr340-red-final.log`.
Native reference scripts re-executed unchanged via `node
/tmp/rifty-support-probe.mjs` and `node /tmp/rifty-pr340-csp-probe.mjs`;
same COI/non-COI OPFS and CSP discriminator outcomes as the committed reference.

## Mechanism sweep

`workbench/service-worker-control.ts:48–151`: real controller proof owns listeners,
ports and deadline. `runtime-js/src/host.ts:196–218/429–442`: real runtime handshake
and pending calls. `workbench-owner-storage.ts:80/114–166`: native proof and cleanup
failures. `vfs/src/opfs-replica-store.ts:35–80`: late sync handle closure after
deadline. `service-worker/src/register.ts:38–48`: registration itself unbounded.
None can safely own disposable whole-invocation teardown. ADR-0437 selects one
per-call deadline, separate bounded cleanup and late native cleanup; no shared
queue, correlation owner or lease acquisition.

## Contract+RED reception

`/root/contract_red_review` at `9fc492bf6`: FIX, live-session carrier used
paths outside /scratch and compared structured reads to strings. Both pairs
corrected; source-confirmed page lock realm replaces the unsupported Worker
lock requirement. Added negative WASM/BC/UUID cases. Actual COI UUID authority
also includes `workbench/workbench-browser-owner-spawn.ts:43` operation IDs.
Native OPFS probe includes SHA-256 (`vfs/src/opfs-replica-codec.ts:27`).

## Implementation verification

- Initial native suite: 25/27; two concurrent/live-session calls left BC
  incomplete while all other required checks passed. Isolated run: 1/2 same
  outcome. Native diagnostic trace retained at `/tmp/pr340-bc-trace.log`.
- Replaced the cross-port BC readiness assumption with greetings on the native
  channel itself (receiver-not-attached boundary model). Concurrent/live-session
  cases: 10/10; then full native suite: 27/27, 17.1 s. No retry timer or cache.
- Additional private-lock contention RED: expected incomplete, received failed
  (`/tmp/pr340-lock-red.log`). Private occupied names now remain incomplete;
  they cannot establish browser incompatibility.

Production and published probe assets are separate bundles, preserving the
existing runtime chunk graph. SDK source changes clarify documentation only.

## Gate contract reception (PR-4)

Full pr:check: 24/25 PASS; test:run RED, 3 failures in 2 files, 0 timeouts.
Both files rerun in isolation: same 3 failures. Old sealed-root expectation
excluded the requested new export; old reachability criterion counted 164 files
and only the eight library entries. ADR-0437 intentionally adds one root export
and four independently built static assets (171 production files total).
The updated gate retains exact exports/count/full source reachability across
eight library + four asset entries, with no source exclusions. A native browser
case executes assets built by the real publishing script. Independent Final+GREEN
compares both criteria against BASE. No product defect was hidden by a retry.

Final native browser suite: 29/29 PASS, 17.7 s; includes published assets,
private-lock collision and live-session preservation (`/tmp/pr340-green-final.log`).
Corrected legacy contracts: 23/23 PASS across both previously failing files.
