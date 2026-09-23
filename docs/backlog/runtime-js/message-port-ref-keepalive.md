---
area: runtime-js
status: draft
title: Manual MessagePort refs keep Node programs alive for pending NAPI work
created: 2026-09-23
why: emnapi's NodejsWaitingRequestCounter conditionally refs a global MessageChannel port; browser ports have no ref/unref so Vitest exits 0 while NAPI work remains
epic: vitest-run-in-browser
blocked_by: [runtime-js/worker-threads-handle-keepalive]
sources: [docs/backlog/runtime-js/reference/message-port-ref-keepalive-evidence.md, docs/adr/runtime-js/0452-reference-locally-owned-native-messageports-without-counting-infrastructure-listeners.md, docs/adr/runtime-js/0152-child-realm-event-loop-drain-loud-fail-exit-contract.md]
code: [packages/runtime-js/src/ipc/worker-realm-compat.ts, packages/runtime-js/src/internal/event-loop-keepalive.ts, packages/runtime-js/src/builtins/worker_threads.ts, packages/kernel/src/shared-globals.ts, packages/kernel/src/index.ts, packages/kernel/src/spawn-worker.ts]
---

## Context

The goal's pending-handle fog resolved to a class beyond Worker (I2 is unchanged).
Rolldown intentionally unrefs its pthread Worker; emnapi runtime keeps pending
work alive separately through `new globalThis.MessageChannel().port1.ref()`.
Its optional-method check skips this silently in Chromium. The repair is generic
manual MessagePort lifetime support, not a CLI promise wait or package patch.

Chromium 148 provides native channels/transferable ports but no observed close
events in page or dedicated Worker. Native Node has asynchronous own AND peer
close transitions. Local pair ownership and an explicit transfer ceiling are
needed to avoid inventing peer/transfer lifetime evidence. ADR-0452 selects that
bounded carrier and a shared primordial constructor owner across bundles.

## Challenge

challenge: 2026-09-23 — reuse accepted I4 scenario; driver traced missing NAPI waiting-counter ref and assigned this generic handle repair; no new user scope choice

## Reference contract

- Node v24.16.0, identical parent/child source in native process and real
  Chromium Workbench. Global constructor is used before builtin fallback.
- Initially hasRef=false. Ref/unref return undefined, are idempotent, and use
  the existing drain owner. Own/peer close stays referenced through sync,
  microtask and immediate observations, then close event exposes false.
- A queued message and immediate may swap order; both precede close. Ref after
  close event remains false. Exact commands/outputs in evidence.

## Acceptance

1. A manually referenced global MessageChannel port holds a CJS parent while an
   explicitly unref'd Worker supplies a later result; releasing the port permits
   natural exit. Repeated ref plus one unref leaves no hidden ref. → I4
2. Default channels and raw kernel/infrastructure ports preserve existing drain,
   identity and transfer behavior; public global and builtin MessageChannel are
   aliases. No listener-only infrastructure keepalive is introduced. → I4
3. Own and peer close of a locally owned non-transferred pair produce one async
   close notification, release references, preserve earlier queued bytes and
   Node's observed partial order; ref after that notification cannot revive it. → I4
4. Owned endpoint transfer fails with MessagePort.transfer.managed before any
   port/companion detachment. ArrayBuffer transfer and real native port identity
   remain intact. → I4
5. Kernel and runtime use one primordial constructor pinned before shimming;
   second-bundle imports and repeated installation cannot recapture the public
   wrapper, double-count, or classify raw kernel init ports as managed. → I4

## Parity cases

Carrier: `tests/browser-unit/message-port-keepalive.spec.ts` and shared source in
`fixtures/message-port-keepalive-cases.ts`; live native Node oracle for supported
rows, browser ceiling assertion for the deliberately unsupported transfer.

1. manual-ref-holds / idempotent-unref-drains: NAPI-shaped optional ref, sole
   counted handle, idempotence, return values, hasRef transitions. → I4
2. global-and-builtin-channel-alias / default-infrastructure-remains-unrefed:
   global-first entry and real unref'd Worker/kernel ports preserve drain. → I4
3. own-close-transition / peer-close-transition /
   queued-message-before-peer-close: async close, late ref, native identity,
   exact bytes, callback counts and partial order. → I4
4. managed endpoint transfer ceiling plus array-buffer-transfer-remains-native:
   no partial detach; primitive native transfer unaffected. → I4
5. second kernel bundle after public shim installation: pinned constructor
   identity and once-only public installation. → I4

## Fault matrix

| axis × operation | honest outcome | carrier | trace |
|---|---|---|---|
| torn-state × repeated ref/unref/close | count once, release once, closed handle cannot revive | idempotent-unref / close cases | → I4 |
| observable-order × queued send then close | data and immediate precede close; no fabricated total order | queued-message-before-peer-close | → I4 |
| provenance-lie × ownership-losing transfer | named throw before all detachment | transfer ceiling | → I4 |
| sibling-drift × global/builtin and raw/private channels | same guest API; raw infrastructure unchanged | alias / default-infrastructure / buffer transfer | → I4 |
| frozen-assumption × second-bundle primordial capture | same original constructor after public replacement | dual-module fault case | → I4 |

## Out of scope

Remote/transferred manual-ref ownership, GC/peer-death inference, full MessagePort
EventEmitter surface and automatic listener-driven keepalive. Owned transfers
have the named ceiling above; no remote-close protocol or emnapi-specific patch.
This item does not claim that merely attaching a browser message listener keeps
the Node realm alive.

## Decisions

- re-cut: 2026-09-23 — new I4-required handle class found by actual Vitest-main tracing; I2 Worker promise unchanged; acceptance waits for this unit — trace: none
- 2026-09-23 — ADR-0452 chosen carrier: native local pairs + manual refs + observed local closure + explicit transfer boundary; shared primordial owner, never module-local recapture.
- 2026-09-23 — new parity/stateful promise: prepare Contract+RED before any production code (RDY-8).
