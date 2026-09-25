---
area: runtime-js
status: ready
title: `child_process.fork` advanced IPC carries non-binary Vitest graphs with explicit binary ceiling
created: 2026-09-15
why: vitest's default forks pool calls `fork(entry, [], { env, execArgv, stdio: 'pipe', serialization: 'advanced' })`; rifty throws `NotImplementedError('child_process.serialization.advanced')` at spawn, so the default pool cannot start
epic: vitest-run-in-browser
sources: [docs/backlog/runtime-js/reference/vitest-run-in-browser-evidence.md, docs/backlog/runtime-js/reference/child-process-advanced-ipc-serialization-evidence.md, docs/adr/kernel/0326-federated-worker-child-tree-with-separate-public-ipc-and-private-control.md, docs/adr/runtime-js/0446-carry-advanced-fork-ipc-through-the-typed-node-launch.md, docs/public/compat/process.md]
code: [packages/runtime-js/src/builtins/child_process.ts, packages/runtime-js/src/internal/node-ipc-serialization.ts, packages/runtime-js/src/builtins/process.ts]
---

## Context

Historical native reference below includes binary values; the user2026-09-25
amendment narrows delivery to non-binary IPC plus explicit binary refusal.

Native Node v24.16.0: advanced fork IPC preserves cyclic/shared references,
Date, Map, Set, RegExp, typed arrays, Buffer, nested bigint, Error/cause and
undefined/special numbers. Both senders reject invalid top-level messages and
uncloneable nested values synchronously; failed serialization leaves the
channel connected and later messages ordered. Dedicated evidence carries
commands, exact results and callback ordering probes.

The initial child-side premise was wrong: `process.ts` selects JSON for every
program launch. Both senders and both receive paths need the selected codec.
The existing physical MessagePort already clones frames, but raw structured
clone loses Buffer identity and reports DataCloneError instead of Node's Error.
Public IPC liveness must depend on public IPC being enabled, not on JSON mode.

ADR-0326 owns the deliberate advanced ceiling and exact typed launch. Extending
its discriminator needs a short superseding ADR and the protocol migration
required by ADR-0267; retain the physical channel, private control, public
disconnect and existing process/drain owners. No new coordination mechanism.

## Challenge

challenge: 2026-09-15 — reuse epic vitest-run-in-browser (6 problems, resolved in goal.md; P4 cost shown)

## Reference contract

Native Node v24.16.0 executes identical sources in the two new `child-worker`
parity cases. Each requires one real kernel-backed physical Worker on rifty.
The public `send` boundary, not the transport catch, owns synchronous value
validation and clone failure. Successful sends snapshot their input.

## Acceptance

1. `fork(..., { serialization: 'advanced', stdio: 'pipe' })` carries the non-binary graphs needed by the accepted Vitest scenario in both directions, preserving cycles, shared references and send-time values. Buffer/typed arrays/DataView/ArrayBuffer/SharedArrayBuffer graphs, including nested occurrences, synchronously throw named `NotImplementedError('child_process.serialization.advanced.binary')`; no dispatch or disconnect. → I4, user2026-09-25
2. Both public senders reject invalid messages and getter/clone failures synchronously as Node within the non-binary scope; no failed message is delivered, and subsequent valid messages arrive in order on the still-connected channel. The user permits a documented opaque-brand ceiling for ambiguous locked-constructor records if required by the chosen carrier; it must not be invented where native cloning works. → I4, ADR-0326, user2026-09-25
3. Advanced public disconnect changes `connected` without disabling private child control; kill and terminal events remain observable. Default JSON semantics stay unchanged. → I4, ADR-0326

4. Typed producer and receiver retain `ipc: 'advanced'`; the extended envelope is v5 and rejects v4 atomically. → ADR-0267, ADR-0446

## Parity cases

1. `child_process/public-ipc-advanced`: child-originated graph, parent graph/echo, post-send mutation, disconnect then kill. → I4
2. `child_process/public-ipc-advanced-fault`: sender validation/clone/getter faults in both realms, identity of getter exception, healthy ordered sends afterward. → I4, ADR-0326
3. Existing `child_process/public-ipc-json` remains the default-mode regression carrier. → ADR-0326

## Fault matrix

| axis × operation | honest outcome | artifact / fault target | trace |
|---|---|---|---|
| corrupt-input × both advanced senders | sync native error; no dispatch/disconnect; healthy send survives | advanced-fault invalid/nested/getter rows | → I4, ADR-0326 |
| sibling-drift × parent/child codec selection | native graph retained on child-originated message and parent echo; JSON unchanged | advanced + existing json cases | → I4, ADR-0326 |
| observable-order × serialization/queued sends | getter failure thrown before return; admitted messages retain order and send-time snapshot | advanced-fault sequences 1/2; advanced mutation | → I4, ADR-0326 |
| corrupt-input × binary graph encounter | named binary ceiling before dispatch in both senders; channel survives | binary-ceiling unit census + owner-advanced-ipc-binary-ceiling browser case | → I4, user2026-09-25, ADR-0467 |
| sibling-drift × uncloneable intrinsic brands | native rejection independent of realm/prototype; ordinary frozen graphs clone | node-ipc-advanced intrinsic census + advanced-fault | → I4, ADR-0467 |
| provenance-lie × typed launch ownership | advanced survives producer/receiver; old protocol rejected | node-entry-advanced-ipc owner parser tests | → ADR-0267, ADR-0446 |
| torn-state × public disconnect/private control | connected false; private kill still terminates exact child | advanced disconnect/SIGUSR2 | → ADR-0326 |

## Out of scope

QuickJS Proxy-backed object/array mirrors fail native cloning; extending VM
mirror-to-IPC compatibility is outside the user-approved Vitest-only route.

Send handles, send callbacks/options and channel ref/unref retain existing
named ceilings (ADR-0326). Native callback probe records reference behavior;
it does not claim callback support. Any such call required by goal acceptance
stays goal work. No transport retries, duplicate/reorder injection, peer-death
recovery or second serializer/channel owner.

## Decisions

ready-verdict: 2026-09-23 — Contract+RED @ 57602c71af088f69e2f973aa54ae3334644e8150

- 2026-09-23 — source: user's whole-epic handoff + goal I4 default forks → generic advanced fork codec; native Node fixes value/error semantics. Existing ADR-0326 callback/handle ceilings stay explicit, not an invented user exclusion.
- 2026-09-23 — preparation: new parity promise; two physical REDs before production changes, Contract+RED pending. The pre-spawn ceiling prevents Worker allocation; same-source direct probe identifies it.
- 2026-09-23 — boundary: dedicated MessagePort is ordered/exactly-once while alive; inject real caller serialization failures, not physically excluded transport duplication/reorder. No coordination owner added.

- 2026-09-23 — Final B1: six uncloneable intrinsic brands lost by instanceof.
  Five slot repairs proven; Promise probe + locked-object named ceiling is a
  concrete candidate, not an accepted narrowing. User question pending;
  Acceptance2 and its frozen-Promise native-error RED remain unchanged.
  Evidence: `reference/advanced-ipc-intrinsic-brands-evidence.md`.

- 2026-09-25 — explicit user amendment supersedes full binary graph promise:
  Vitest sufficient; binary IPC explicitly prohibited. Native-clone candidate
  replaces the custom Buffer snapshot; prior REDs remain historical evidence.
  Binary-success criteria migrate to explicit synchronous ceiling checks;
  ordinary non-binary graph/native clone tests remain. User separately permits
  documented opaque-brand ceiling if technically necessary; no silent admission.

- re-cut: 2026-09-25 — fork: user explicitly chooses Vitest-only non-binary IPC + binary ceiling; ADR-0467 partially supersedes ADR-0446 binary preservation and ADR-0453 provenance mechanism. Accepted non-binary behavior, both senders, getter order, healthy channels and ADR-0326 private control remain; frozen plain records now native instead of opaque-brand refusal.
