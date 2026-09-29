# PR #353 repair evidence — 2026-09-29

Authority: user handoff `/tmp/handoff-pr353-mergeable.md`; observed baseline
`e97ad98c4896400c213ffb4936d1171f65d2ac1f`, Node v24.16.0.
Scope: constructor-accessor IPC corruption, rejected Worker stdio leakage,
review nits; preserve vitest-run-in-browser acceptance. No merge authorized.

## Baseline and RED

Executed original handoff repros with `node --import tsx`:

- `review-ipc-353.mts`: Node `[2]`, rifty `[1]`. Getter on a view's
  `constructor` changes its first byte before Node copies it, after rifty does.
- `review-worker-353.ts`: Node stdout listener delta `[0,0,0]`; rifty
  stdout/stderr `[1,1,1]` after one rejected env getter, `[2,2,2]` after two.
  Events: drain/error/close. `WorkerStdio` pipes before env snapshot throws.

Committed regression carriers, executed before production edits:

| Command (`pnpm`) | RED |
|---|---|
| `test:run tools/node-parity-runner/cases/child_process/public-ipc-advanced-constructor.fault.test.ts` | own/inherited getters invoked, messages delivered with `[1]`; Node `[2]`; expected named refusal/no dispatch |
| `test:run packages/runtime-js/src/builtins/worker_threads-keepalive.fault.test.ts` | 3 new cases fail: env getter/coercion and workerData getter leave six owner listeners |
| `test:run packages/runtime-js/src/builtins/worker_threads-stdio.fault.test.ts` | 2 failures: missing/throwing stderr leaves stdout's three listeners |
| `test:parity env-semantics` | `env: null` throws `Cannot convert undefined or null to object` |
| `test:parity fork-exec-argv-invalid` | Node `TypeError: execArgv is not iterable`; rifty `NotImplementedError` |

The first draft of new tests followed two incorrect handoff assumptions.
Corrected **before production edits**, from executed Node oracle:
`env: null` is accepted/inherits; non-iterable fork execArgv throws a plain
TypeError, not ERR_INVALID_ARG_TYPE. A string is iterable; do not assert it
is rejected as a type error. Node itself attaches stdio before a workerData
getter throws; that row asserts rifty's no-leak construction, not Node's
listener counts. Env getter/coercion compare both native streams directly.

## Fault matrix

| Row / trace | Boundary and fault | Honest outcome / carrier |
|---|---|---|
| F1 → ADR-0480; observed Node bytes | Owned in-process graph projection, observable-order/provenance-lie | One shared advanced codec refuses own/inherited constructor accessors; no invocation/dispatch; next send succeeds. Constructor fault test + Chromium advanced-ipc + same-realm ceiling test |
| F2a → ADR-0446 construction takes no holds; observed env throw | Worker admission, torn-state/observable-order | Read env before piping; read workerData after stdio/id and unpipe on throw; no listeners/holds after rejection. worker_threads-keepalive.fault.test.ts |
| F2b → same construction obligation, sibling stdio setup | WorkerStdio admission, torn-state | stderr validation/getter failure unpipes stdout; worker_threads-stdio.fault.test.ts |
| F2c → Node null environment baseline | Worker admission, corrupt-input | null inherits like omitted env; env-semantics parity |
| N1 → Node fork baseline | Owned startup projection, corrupt-input/sibling-drift | Spread tokens before compile; non-iterables carry Node TypeError; fork-exec-argv-invalid parity |

Boundary exclusions (F1/F2/N1): no network/storage operation at the point
of failure; transport loss/duplicate/reorder, cache poisoning, quotas,
unbounded reads and concurrent writers cannot cause these synchronous traces.
Later Worker transport faults remain covered by existing keepalive and IPC
fault suites; this exclusion does not apply to peer death after admission.

Sweep: `encodeAdvancedIpcMessage` has one caller, `serializeNodeIpcMessage`,
shared by parent Worker, same-realm parent and child process sends. Own and
inherited accessors are sibling F1 instances handled by one descriptor lookup.
`new WorkerStdio` has one production caller; options snapshot, workerData
read, and sequential stdout/stderr setup were the reachable admission faults.
After setup, own-field assignments and the existing reference attachment /
queued start carry lifecycle; no new coordination mechanism.
`forkExecArgv` has one caller; Worker has separate Node non-array validation
(`worker_threads-launch.ts`), intentionally different from fork's iterable rule.

## Decision and residual disposition

ADR-0480: named refusal, as handoff option (b), extended to inherited
accessors. Independent DEC-2 review recommended it over a serializer rewrite
or early getter reads. Original ADR-0448 remains historical with dated
correction; compat distinguishes successful-send corruption from error order.

Nits: stale acceptance comment points at durable evidence; execArgv uses the
actual Node baseline. Existing no-COI reassigned-exit and late-rejection drafts
both present with owners/triggers and compat warnings; no duplicate items.
Five previously reviewed mechanisms unchanged: no evidenced simpler equivalent.

Proxy prototype is a separate unclaimed shape, recorded in
`docs/backlog/runtime-js/advanced-ipc-proxy-prototype.md` (rifty-to-backlog).

## Proxy prototype

Executed with Node v24.16.0, production `encodeAdvancedIpcMessage` /
`decodeAdvancedIpcMessage` and native `node:v8` serialize/deserialize:

```js
function input() {
  const view = new Uint8Array([1]);
  Object.setPrototypeOf(view, new Proxy(Uint8Array.prototype, {
    get(target, key) {
      if (key === 'constructor') view[0] = 2;
      return Reflect.get(target, key, view);
    },
    getOwnPropertyDescriptor(target, key) {
      if (key === 'constructor') view[0] = 3;
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
  }));
  return view;
}
// [...deserialize(serialize(input()))] → [2]
// [...decodeAdvancedIpcMessage(encodeAdvancedIpcMessage(input()))] → [1]
```

This is not ordinary subclass/accessor parity and is not called repaired.

## Verification

- Targeted GREEN: F1 physical-worker test, F2 faults and old IPC ceilings;
  fork-invalid and env-null differential parity pass on Node v24.16.0.
- Chromium `RIFTY_PLAYGROUND_PORT=5397 pnpm test:browser-unit tests/browser-unit/advanced-ipc.spec.ts`: 6/6 pass, including live Node constructor oracle, no refused dispatch, ordinary Buffer/subclass sends.
- Revert checks / full gate / final review: results appended below.

### Revert checks and integration

- Reverted each production owner to `e97ad98c4` independently, restored in
  `finally`: IPC 3 REDs (physical + own/inherited same-realm); Worker 3 REDs;
  stdio rollback 2 REDs; fork-invalid parity RED. Original tests unchanged.
- First full gate: parity passes; 3/25 lanes red. Compat check ran before the
  edited compat document was committed; exact worker fingerprint needs repin.
  `test:run` reran 3 failed files once in isolation: the two Workbench timeout
  files pass (one test timeout, one hook timeout); startup-options ceiling
  still fails on string `'--require'` being split into `'-'`. Retained the
  existing string named ceiling in production; did not weaken its test.
- GitHub reported CONFLICTING against main `5f4e109b8`. Merge `c34cbc67c`
  combines ADR-0470 native WebAssembly removal and no-COI Worker refusal with
  ADR-0444 runtime global-key checks and ADR-0449 launch options. Conflicts
  resolved in an isolated tree while the first gate ran; merged tree then
  fast-forwarded into the original PR worktree. No merge of PR #353 performed.

Independent RDY-6 draft check (2026-09-29): no blockers/concerns; Proxy finding
reproduced on Node v24.16.0, dedup/owner/trigger accurate. Deferral matches
handoff F1(b)'s accessor-ceiling scope; not a claim of full Proxy parity.

Merged build fingerprint: `typescript-worker.js` 10,022,694 bytes,
SHA-256 `ae8fe6379a4574959d064b563cf3c4d907747b7ab4ee2cf34bd3269eef299950`.
Compared pre-/post-main-merge generated assets: identical after normalizing
`(chunk|module-loader)-[A-Z0-9]{8}.js` names. Normalized SHA-256
`97b7e399d4b04d72d2c0601034fb7fb39e3c270ea7fa795e28761875556a2703`.
Exact retirement gate passes; its negative tests and byte ceiling unchanged.

### Merged full gate

`pnpm pr:check --all` @ `50b889df1`: **25/25 PASS**. Unit/integration
`test:run` 224.4 s, first attempt; parity 116.8 s. Log in this session:
`/tmp/pr353-pr-check-merged.log`. Browser integration rerun follows separately.


### Main test reconciliation — ADR-0445 + ADR-0470

Merged browser-unit: 8/8 PASS (advanced IPC, Worker stdio/startup, keepalive).
No-COI native-WebAssembly lane: 8 pass; Vite 8 failure repeats in isolation.
The main-origin test expected host Promise rejection; merged runBin instead
returns `{exitCode:1}`, printing the exact original WASI-loader Error and the
preceding named Worker diagnostic. No timeout or silent success.

Raw authority: ADR-0445 Decision 5's corrected first-terminal settlement;
`no-coi-toolchain-worker.ts` runInstalledBin maps process exit signals to
exitCode but still throws a retained declared-gap cause. Rolldown prints the
Worker gap then replaces it with its own loader Error (ADR-0470 Decision 4).
The original error is preserved on stderr; no fabricated cause is attached.
Independent final reviewer inspected both authorities and the executed output:
stale host-rejection criterion, not a missing Worker refusal.

Update only that integration assertion to require exit 1, exact loader-error
text, the named Worker diagnostic, absent dist, bounded settlement and unchanged
package provenance. This reconciles already accepted lifecycle behavior; it does
not loosen either error-preservation or no-silent-success obligation. No product
code change. Logs: `/tmp/pr353-no-coi-merged.log`, `/tmp/pr353-no-coi-isolated.log`.


No-COI reconciliation GREEN: the same 9 browser cases pass, including real
Vite 7 COI/no-COI byte equality and Vite 8's exit 1 + diagnostics + absent dist.
Log: `/tmp/pr353-no-coi-final.log`. Independent reviewer inspected the changed
criterion under PR-4 and found no weakened accepted obligation.

### Final committed proof

At `33e77389e30a55e320c9fe4cf003dbe83072f966`:

- `pnpm pr:check --all`: 25/25 PASS; test:run 195.4 s (first attempt),
  parity 126.6 s. `/tmp/pr353-pr-check-final.log`.
- Chromium IPC/Worker stdio/startup/keepalive: 8/8 PASS.
- no-COI native WebAssembly / actual Vite build boundaries: 9/9 PASS.
- `RIFTY_PLAYGROUND_PORT=5398 pnpm test:e2e:heavy tests/e2e/vitest-run.spec.ts`:
  2/2 PASS (2.3 min), both pools fail→1/fix→0, reporter and named ceilings.
- Independent Final+GREEN: 15/15 coverage, no blockers or required residuals;
  `docs/backlog/runtime-js/reference/pr-353-repair-final-green.json`.
  One advisory NOTE: a throwing guest newListener hook can retain partial pipe
  effects; native Worker also retains effects for that fault. Extra hook
  transactional hardening is not the observed env-admission parity repair.
  No product change made for this advisory.

PR branch pushed; no PR merge performed. CI binding is restored by this final
review artifact, not by changing the gate or suppressing its earlier failure.

### CI-only stale fault stimulus after main integration

CI run `36503121263`, no-coi job `109198470366`: 121 PASS, one failure in
`no-coi-agent-sdk.spec.ts` “project command names a declared gap behind a fatal
rejection”. Reproduced once isolated: `/tmp/pr353-agent-gap-red.log`.
The fixture tried to capture `toolchain.threaded-wasm` by allocating shared
WebAssembly.Memory; ADR-0470 now makes that allocation native, so no gap existed.

Keep the same obligation: a retained real declared-gap cause survives fatal
rejection. Replace only the retired stimulus with actual no-COI Worker
construction and its canonical `worker_threads.Worker` feature. The existing
`status: failed`, NotImplementedError and original outer stderr assertions stay.
Whole owning browser spec: 6/6 PASS (`/tmp/pr353-agent-sdk-final.log`). No product
code change. Retired-marker sweep: remaining SDK `toolchain.threaded-wasm` is
capability metadata pointing at Worker; process-exit unit uses an arbitrary
NotImplementedError identity. Neither expects Memory allocation to throw.

CI-stimulus correction verified at `3fa05776215ced754ee6da0f799309b04abfa656`:
`pnpm pr:check --all` 25/25 PASS (unit 193.2 s first attempt; parity 118.0 s).
Independent verification rebinds the same verdict: 16/16 coverage, zero blockers,
same one advisory NOTE. Previous CI run completed with every other job green;
only the now-replaced no-COI stimulus failed. Updated run follows the final push.

### Concurrent main advance — browser support floor

While waiting on CI, main advanced to `e3a6620a9` (PR #362), making the next
head conflicting. Merge `17724d25a` preserves both ADR correction tables and
the extracted compat README generator; the browser matrix link moves into
`readme.js` beside the existing vitest link. No duplicate renderer.
Existing no-COI runBin and declared-gap fixtures survive the automatic merge.
Independent inspection confirms both links render once and match the README.

Upstream ES-floor/OPFS boot changes remain; the full gate now has 27 checks
including build:playground and check:es-floor. Compiler repin `c4a8742fe`:
10,022,694 bytes, SHA-256
`b0ff9c1aed9e7017b52286b09417d6e8eb0be7346c96db242b59d786e027adbe`;
still import-name-only drift under the earlier normalization. Exact retirement
gate passes. Reverification follows on this merged product tree.

### ES-floor integration repair (ADR-0481)

First 27-lane gate: 26 PASS, only check:es-floor RED. Runtime IPC's optional
Float16Array lookup/filter is absence-safe (independent real codec import after
removing the host intrinsic still round-trips Uint8Array). The new gate rejected
that lookup and even a typeof availability probe; bare identifier extraction
also escaped it. Root: named-feature/guard classification, not missing runtime
serialization. Boundary: owned graph projection; frozen-assumption/sibling-drift.

| Fault row / trace | Operation | Carrier |
|---|---|---|
| F3 → ADR-0469 + ADR-0481 | Optional constructor acquisition/direct invocation in source and emitted JS | es-floor-float16.test.ts: positive availability/read-table forms; absent/wrong/shadowed/deferred guards and bare extraction refused; callable guard required for direct invocation, including final sequence operands; real codec guard-removal mutant |

Reuse the existing guard analyzer with exact feature identity. Add only
Float16Array; keep all original 101 negative/positive cases. Runtime table gets
an explicit callable guard. No source/bundle waiver or polyfill. Rebuilt output
also exposed get-intrinsic's safe readonly typeof-undefined table and minified
`>"u"` equivalent; support reads separately from constructor invocation.

RED logs: `/tmp/pr353-float16-red.log` (7 new failures),
`/tmp/pr353-float16-isolated.log` (minifier discards an unused typeof probe),
`/tmp/pr353-float16-vendor-red.log` (actual emitted intrinsic-table shape),
`/tmp/pr353-float16-sequence-red.log` (transparent final callee operand).
GREEN: 129/129 checker tests; all 329 rebuilt shipped bundles pass ES floor.
Revert/mutants: original checker, invocation/read-role conflation, unsafe bare
extraction, wrong typeof threshold all RED. The threshold mutant first survived;
added the discriminating `>"z"` lookup case, then it failed. Existing tests never
weakened. Independent probes confirm the real absence path, guard-removal RED,
false guards refused, and function-guarded sequence calls allowed.
Logs: `/tmp/pr353-floor-mutant-*.log`, `/tmp/pr353-float16-green-final.log`,
`/tmp/pr353-es-floor-green.log`.


### F2 ordering correction — 2026-09-29

New executed evidence reopens the earlier PASS: reading workerData before stdio
changed its successfully returned value. Native getter sees error/close listener
deltas `[[1,1],[1,1]]`, first F2 repair returned `[[0,0],[0,0]]`. Nested Worker
creation also consumed the outer id too late. Preserve Node order: env before
effects; stdio + thread id before workerData; catch a workerData getter throw
and unpipe both streams before propagating. Existing no-hold/no-listener fault
assertions stay unchanged. Thread id is consumed at Node's point.

Carrier: `worker_threads/worker-data-construction-order.case.ts`, real Node and
two physical rifty Workers; same program added to Chromium startup programs.
It captures the id relation synchronously after construction: an initial draft
compared it after messages, when Node may already expose threadId -1, so that
measurement was corrected rather than accepting its racy result.
Stable reverted-tree RED (`9a09140c8`): Node outerBeforeInner=true/deltas1;
rifty false/deltas0. Restored code GREEN. Removing just catch/unpipe makes the
unchanged workerData-getter fault RED. Logs:
`/tmp/pr353-worker-data-order-red-stable.log`,
`/tmp/pr353-worker-data-order-green-stable.log`,
`/tmp/pr353-worker-data-rollback-red.log`.
Independent reviewer reproduced the regression and then verified the stable
Node/rifty GREEN. Earlier PASS records remain historical; new verdict will bind
this corrected result.

| Fault row / trace | Operation | Carrier |
|---|---|---|
| F2d → observed Node Worker constructor baseline | workerData getter observes installed stdio and reserved id; failure retires pipes | worker-data-construction-order parity/browser program + unchanged keepalive workerData fault |

### Final ordering-repair proof

Final reviewed product/test SHA `f83509f7c12f7c060491e8549360aa3cd4795a21`:

- Full gate 27/27 PASS, including ES2022 floor over rebuilt artifacts;
  unit 189.7 s first attempt, parity 115.7 s
  (`/tmp/pr353-pr-check-construction-final.log`).
- Chromium 8/8 PASS, including the shared workerData/stdio-observation and
  synchronous id-order carrier (`/tmp/pr353-browser-construction-final.log`).
- vitest acceptance 2/2 PASS, both pools fail→1/fix→0 and named ceilings
  (`/tmp/pr353-vitest-construction-final.log`).
- Production Worker stdio/startup and keepalive 2/2 PASS
  (`/tmp/pr353-prod-construction-final.log`).
- Latest-main no-COI memory/SDK/storage-boot 16/16 and Vite boundaries 7/7,
  production owner-boot/Buffer identity 2/2 already PASS on unchanged paths.
  Selected no-COI Worker refuses before the changed workerData branch.
- Independent Final+GREEN rebound: 24/24 coverage; no blockers/required
  residuals; original arbitrary-newListener advisory retained.

Last worker fingerprint: 10,022,694 bytes,
`8e175378ea88ad76f74ed3c01503ed16a94c0d53191066a972039117f3c13ba8`,
import-name-only change under the recorded normalization. Main verified still
`e3a6620a9` immediately before final browser completion. No PR merge performed.
