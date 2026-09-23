---
area: runtime-js
status: ready
title: A ref'd `MessagePort` keeps the Node program alive, as in Node
created: 2026-09-23
why: emnapi holds the Node loop for pending napi async work with `new MessageChannel().port1.ref()`; rifty's MessagePort is the browser one with no `ref`/`unref`/`hasRef`, so the call is skipped and a program whose only pending work is rolldown async napi work (vite 8 config bundle, `parseAstAsync`) drains and exits 0 — the observed silent `vitest run`
epic: vitest-run-in-browser
blocked_by: []
sources: [docs/backlog/runtime-js/reference/message-port-ref-keepalive-evidence.md, docs/adr/runtime-js/0447-count-referenced-messageports-in-child-realm-keepalive.md, docs/backlog/runtime-js/reference/vitest-run-in-browser-evidence.md, docs/adr/runtime-js/0152-child-realm-event-loop-drain-loud-fail-exit-contract.md, docs/backlog/runtime-js/keepalive-residual-gaps.md]
code: [packages/runtime-js/src/internal/event-loop-keepalive.ts, packages/runtime-js/src/ipc/worker-realm-compat.ts, packages/runtime-js/src/ipc/install-process.ts]
---

## Context

Prior draft attempts at this goal (PRs #351, #352; evidence only, not
authority) both found the same wall after items 1–11: `vitest run` still
exits 0 with no output while vite 8.0.16 bundles `vitest.config.ts` through
the rolldown wasm32-wasi binding. `@emnapi/runtime` 1.10.0
`NodejsWaitingRequestCounter` creates `new MessageChannel().port1` and calls
`ref()`/`unref()` only when they exist; rolldown unrefs its own pool Workers
on purpose, so in Node the ref'd port is the one holder. Node v24.16.0 (their
oracle runs): `port1.ref()` alone holds the process, a fresh port has
`hasRef() === false`, a port with a `'message'` listener holds, `unref()`
releases. Carrier is a handle class in event-loop-keepalive (ADR-0152
correction or a short ADR citing it) — never an emnapi/rolldown patch. The
instrumented vitest-main run at pickup confirms this is the drained wait
(map open question). Traces to I4 (`vitest run` never exits 0 with empty
output), not a widened I2.

Pickup (2026-09-23): a rifty vitest run on BASE stops earlier, at the I6 walls,
so the open question was answered in real Node instead. If only the global
`MessageChannel` ports lose `ref`/`unref`/`hasRef`, `vitest run` exits 0 with
0 bytes of output, and a detached rolldown build prints nothing
(evidence §Holder, §Real package). The carrier is ADR-0447.

## Challenge

challenge: 2026-09-15 — reuse epic vitest-run-in-browser (6 problems, resolved in goal.md; P3 root cause = narrow keepalive handle set)

## Reference contract

- Oracle: Node v24.16.0 `MessagePort`/`MessageChannel` (`ref`/`unref`/`hasRef`/
  `close`, transfer), running `@emnapi/runtime` 1.10.0 and rolldown 1.0.3 with
  its wasm32-wasi binding. These are the versions npm 11.17.0 resolves for the
  goal's scenario manifest (vitest 4.1.11, vite 8.0.16).
- Mechanism: in Node a MessagePort is a libuv handle with a boolean ref flag.
  `ref`/`unref` set and clear it, `hasRef` reads it, and closing either end of
  a pair closes both. emnapi sets the flag when the count of waiting napi
  requests goes 0→1 and clears it at 1→0. Rifty maps one referenced port to one
  ADR-0152 keepalive ref, and records locally created pairs so a peer close is
  seen (ADR-0447). emnapi, rolldown and vitest are not changed.

## Acceptance

1. In a real Chromium child realm (`tests/browser-unit/message-port-ref-keepalive.spec.ts`), each program in Parity cases 1–7 prints the same `PORT|` rows and exits with the same code as a live Node run of the same source (the Playwright host's `process.execPath`). → ADR-0447
2. On the vite 8 template (rolldown 1.0.3 wasm32-wasi, `@emnapi/runtime` 1.10.0), `NAPI_RS_FORCE_WASI=1 node rolldown-detached.mjs` is a detached build with no top-level await. It must print `ROLLDOWN|start` and the bundle row, then exit 0, as in the Node artifact (Parity case 8). Today it prints only `ROLLDOWN|start` and exits 0; this is the silent drain `vitest run` hits while bundling `vitest.config.ts`. → I4, ADR-0447
3. `docs/public/compat/process.md` gets a ✅ row for referenced-MessagePort keepalive and ❌/⚠️ rows for each ADR-0447 explicit gap: moved or received ports cannot be referenced, listener referencing, NodeEventTarget surface, close timing, and reflection. → ADR-0447

## Parity cases

The parity runner can't host these cases. It runs rifty builtins in the Node
host, where the global `MessagePort` is Node's own, so a runner case would just
compare Node with Node (traps `parity-runner-in-process`). Instead, the
browser-unit specs run each source verbatim in live Node and in rifty. Sources:
`tests/browser-unit/fixtures/message-port-ref-cases.ts`. Node rows: evidence
§Oracle cases.

1. `api-shape` (Node rows `alias=true`, `constructor=true,true,MessageChannel,0`, `native=true`, `types=function,function,function,function`, `fresh=false,false,false`, `ref-return=undefined`, `referenced=true,false`, `unref-return=undefined`, `double-ref-single-unref=false`, `builtin-ref=true`, `builtin-unref=false`, and `illegal=` giving `TypeError:Illegal invocation` for each of the three methods). The global and `node:worker_threads` MessageChannel are the same constructor, and `.constructor`, `name` and `length` match Node. Ports are native `MessagePort`s, and `ref()` affects only its own port. → ADR-0447
2. `reference-holds-until-unref` (Node rows `start`, `late=timed-out,true,false,false`, `after-unref=false`, exit 0). The port gets emnapi-style optional `ref()` calls. It holds the program while a 300 ms `Atomics.waitAsync` settles, and that wait holds nothing in either runtime. Fresh ports and ports that were ref'd then unref'd do not hold. → ADR-0447
3. `emnapi-waiting-request-counter` (Node rows `queued=2`, `done=a,count=2`, `done=b,count=1`, exit 0). This is the verbatim `NodejsWaitingRequestCounter` (`emnapi.cjs.js:120-128, 1182-1205`) over two overlapping waits. It holds until the count reaches 0, then releases. → ADR-0447
4. `close-releases` (Node rows `before-close=true` only, exit 0). After an own `close()`, work that holds nothing does not run. → ADR-0447
5. `peer-close-releases` (Node rows `after-peer-close=false,false` only, exit 0). Closing the peer releases the referenced port, and a later `ref()` neither holds nor reports `true`. → ADR-0447
6. `ref-after-close-does-not-hold` (Node rows `ref-return=undefined`, `closed-ref=false,false`, exit 0). → ADR-0447
7. `unreferenced-transfer-stays-native` (Node rows `detached=0,reads=1`, `clone=true,true`, `received=true,true,1.2.3`, `through-transferred=ping`, exit 0). Moving unreferenced ports keeps native behavior. This covers a `Set` transfer list read through a getter exactly once, ArrayBuffer detachment, a received port that still carries messages, and `structuredClone` with frozen options returning the clone. → ADR-0447
8. `rolldown-detached` real package (Node artifact rows `ROLLDOWN|start` and `ROLLDOWN|chunks=1|entry=entry.js|code="//#region src/entry.js\nconst answer = 42;\nconsole.log(42);\n//#endregion\nexport { answer };\n"`, exit 0). The precondition `rolldown-awaited.mjs` prints `ROLLDOWN|awaited|chunks=1|entry=entry.js` and exits 0. → I4, ADR-0447

## Fault matrix

| axis × operation | honest outcome | artifact / fault target | trace |
|---|---|---|---|
| `torn-state` × redundant `ref`/`unref`/`close` on one port while a timer is live | A port adds at most one keepalive ref and releases only its own. Output as in Node: `late=true`, `released=false`, `timer`, then exit 0 | `message-port-ref-keepalive.fault.spec.ts` "one port contributes exactly zero or one keepalive hold" (live Node) | → ADR-0447 |
| `provenance-lie` × transfer of a referenced port, or of a referenced port's peer, through `MessagePort#postMessage`, `structuredClone`, `Worker#postMessage` or global `postMessage` (after that, release is unobservable: no close/detach signal, evidence §Chromium) | `NotImplementedError('MessagePort.transfer.referenced')` before anything detaches: the ArrayBuffer companion keeps 4 bytes, and the pair still delivers messages while the port keeps holding. The program never hangs or exits early. | fault spec "transfers that would hide a referenced port release fail by name" (`transferCeilingRows`) | → ADR-0447 |
| `provenance-lie` × `ref()` on a port whose release can't be seen (its pair was split by a transfer, or it arrived through one) | `NotImplementedError('MessagePort.ref.transferred')`, and `hasRef()` stays `false` | same fault spec | → ADR-0447 |

## Out of scope

- Referencing moved or received ports. Node lets a referenced port, or its peer,
  be transferred, and lets you `ref()` the other end or the copy. Rifty throws
  `NotImplementedError('MessagePort.transfer.referenced')` /
  `NotImplementedError('MessagePort.ref.transferred')` (Fault matrix rows 2–3).
  Compat ❌.
- Listener-driven referencing. In Node, a `'message'` listener or `onmessage`
  refs and starts the port, and removing the last one unrefs it. Rifty listeners
  never reference a port (unchanged), and `hasRef()` reports only manual refs.
  Messages still queued when the last ref drops are not waited for. Compat ❌,
  ADR-0447 §Explicit gaps.
- NodeEventTarget methods on ports: `on`, `once`, `off`, `addListener`,
  `removeListener`, `removeAllListeners`, `emit`, `eventNames`, `listenerCount`,
  `setMaxListeners`, `getMaxListeners`. Also the `'close'` event. These are
  absent (unchanged): calling one throws `TypeError: port.on is not a function`,
  and no `'close'` fires. Compat ❌.
- `hasRef()`/`ref()` between `close()` and Node's close-callback phase. Rifty
  reports `false` at once, while Node reports `true` until that phase. The
  program still ends at the same point. Compat ⚠️.
- Reflection. `Function.prototype.toString` on `MessageChannel` and on the
  wrapped `MessagePort`/transfer methods shows the Proxy or wrapper, not native
  code. Compat ⚠️.
- `MessagePort#postMessage` return value. Node returns `true`; Chromium returns
  `undefined`. This was already different, and the wrapper keeps whatever the
  native call returns. Not claimed here.
- Retiring vite's install-time `__riftyTrackCliPromise` patch
  (`tools/shadow-registry/src/runtime/vite-cli-install-policy.ts`). It stays
  unchanged and is not claimed here.

## Decisions

- 2026-09-23 — pickup: the map open question (which handle `vitest run` drains on) is answered by a Node control. With browser-shaped global ports, vitest exits 0 with 0 bytes; evidence §Holder. A rifty-side instrumented run is impossible on BASE because the I6 walls come first.
- 2026-09-23 — carrier: ADR-0447, a short ADR citing ADR-0152 (ADR-0158 is the precedent). It records local pairs through a `MessageChannel` Proxy, adds prototype `ref`/`unref`/`hasRef`, releases the pair on `close()`, and refuses transfers of referenced pairs by name. Rejected: own-release-only (it hangs the uncapped terminal drain on peer close), #351's make-every-port-untransferable approach with close emulation, and any emnapi/rolldown/vitest patch.
- 2026-09-23 — scope: listener referencing and the NodeEventTarget surface stay explicit gaps. I4 does not need them (evidence §Claimed-path sweep), and they would need a kernel primordial-constructor seam. The land step should re-cut map item 13's "listener auto-ref" wording.
- 2026-09-23 — no parity-runner case: in the Node host it would compare Node with Node. The carrier is browser-unit with a live Node oracle, plus the captured rolldown artifact.
