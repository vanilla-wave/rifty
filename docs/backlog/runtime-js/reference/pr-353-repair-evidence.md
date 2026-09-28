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
| F2a → ADR-0446 construction takes no holds; observed env throw | Worker admission, torn-state/observable-order | Read options/env before piping; no listeners/holds on rejected env/coercion/workerData. worker_threads-keepalive.fault.test.ts |
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
