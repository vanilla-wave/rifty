# ADR 0446: Count live `worker_threads` Workers in child-realm keepalive

Status: Accepted
Date: 2026-09

> TL;DR: A live `worker_threads.Worker` holds its parent through Node's own two reference objects, own `Symbol(kHandle)` and `Symbol(kPublicPort)` properties whose `ref`/`unref`/`hasRef` each hold one ADR-0152 keepalive ref. `Worker#ref()`/`unref()` call through them at call time, so napi-rs can neuter them as it does in Node. Inside the worker, `parentPort` is a reference of the same kind, driven by its `'message'` listeners. A worker-thread realm drains without a cap and then exits the Node way. No lifecycle owner's natural exit calls the reassignable `process.exit`. This adds a handle class to ADR-0152 §1 (like ADR-0158 and ADR-0447) and decides ADR-0445 rule 6's worker-thread clause.

Extends ADR-0152 §1 named handle set (Worker `kHandle`/`kPublicPort`
references; worker-realm `parentPort`). Partially supersedes ADR-0445 rule 6:
its worker-thread clause and the Consequences gap "worker-thread natural exit
stays with map item 8" (replaced by §5), and its "calls `exit()`" for the
program/eval lifecycle and execSync branch (now the `NodeProcess` exit
captured before user code, never the reassignable `process.exit`; evidence
§Natural exit ignores a reassigned `process.exit`, p15/p16/`node -e`; BASE
`node-entry-bootstrap.ts:189`/`:201`). ADR-0152 §4, ADR-0144, ADR-0155 §2 /
ADR-0385 and ADR-0447's listener gap stand.
Independent DEC-2 decision review, 2026-09-25: justified-with-fixes; dated
notes land in ADR-0152 §1, ADR-0445 rule 6 and README §Corrections.

## Context

`worker_threads.ts` takes no keepalive ref, and its `ref`/`unref` are no-ops
that return `this`. A program whose only pending work is a Worker drains and
exits 0 before the worker's message. Node prints `got hi true`, `wexit 0`,
`EXIT 0` (goal I2). The kernel Worker is spawned `serve: true` and never
drain-reaped (draft `runtime-js/worker-threads-kernel-run-to-completion-exit`),
so a counted Worker whose script finished would hang its parent.

The constraints come from real packages (evidence:
`docs/backlog/runtime-js/reference/worker-threads-handle-keepalive-evidence.md`):

- `@rolldown/binding-wasm32-wasi@1.0.3` finds the Worker's own
  `Symbol(kPublicPort)` and `Symbol(kHandle)`, replaces their `ref` with a no-op,
  and calls `worker.unref()`. `@emnapi/wasi-threads@1.2.1` then adds `'message'`
  listeners and calls `worker.ref()`. In Node, nothing holds after that. Pool
  Workers are never terminated, so any path around the neutered `ref` would pin
  vite and vitest forever.
- Node's hold is two flags. `kHandle` is referenced from construction.
  `kPublicPort` is referenced while the Worker has `'message'` listeners
  (`setupPortReferencing`). An `unref()`'d Worker is held again by its first new
  `'message'` listener.
- Inside the worker, `parentPort` is a `MessagePort`. Its first `'message'`
  listener (or `onmessage`) references it and removing the last one unreferences
  it. `removeAllListeners()` does not unreference it: vitest's threads pool
  relies on this at teardown, then calls `terminate()`.
- vitest's pool workers replace `process.exit` with a throwing function. In Node,
  natural exit never calls that property.

## Decision

1. **Worker references.** Each Worker gets two own enumerable, writable,
   configurable properties, keyed by `Symbol('kHandle')` and
   `Symbol('kPublicPort')`. Their values are instances of one small reference
   class. It has prototype methods `ref()` / `unref()` / `hasRef()` over one
   boolean flag, and a set flag is one ADR-0152 keepalive ref. Repeated calls
   change nothing, and an own `ref` assignment shadows the method, as it does on
   Node's objects. `kHandle` is referenced at the end of the constructor, after
   every synchronous validation, so a constructor that throws holds nothing.
   `kPublicPort` starts unreferenced. The constructor adds `'newListener'` /
   `'removeListener'` listeners that call `this[kPublicPort].ref()` when the
   `'message'` count goes from 0 to 1, and `.unref()` when it drops to 0
   (Node's `setupPortReferencing`, looked up at call time). The Worker's
   `removeAllListeners` releases `kPublicPort` as Node's `'removeListener'`
   emission does; `@riftydev/io`'s emitter clears silently, and its silent
   clear stays (ADR-0422 retirement and kernel teardown rely on it).
2. **`Worker#ref()` / `unref()`** do what Node does:
   `if (this[kHandle] === null) return; this[kHandle].ref(); this[kPublicPort].ref();`
   (`unref` is the same). Both return `undefined`. `Worker#hasRef` stays absent.
3. **Terminal release.** On every way a Worker ends, before `'exit'` is emitted,
   both references are released and set to `null` (Node's `kDispose`). Those
   ways are: a kernel exit, a peer error, a refused spawn, `terminate()`, and the
   same-realm end. After that, `ref()` / `unref()` do nothing. A failed start or
   peer error emits `'error'` from a Worker-owned microtask, then `'exit'` 1 on a
   later microtask. An unlistened `'error'` throws on as the parent's uncaught
   exception (never a rejection, never held back by the kernel's teardown);
   `'exit'` still follows and releases both, unless that exception began the
   parent's exit (Node `_exiting`). Node races that `'exit'` against the error:
   its place among the handling's microtasks, and whether it precedes a fatal
   uncaught exception, vary with loop timing (evidence §Final+GREEN r2
   reception). Rifty always takes the order an unloaded Node run gives.
4. **`parentPort` reference.** In a worker-thread realm, `parentPort` gets the
   same `ref()` / `unref()` / `hasRef()` over one keepalive ref in that realm.
   The first `'message'` listener references it. That covers
   `on`/`addListener`/`once`/`prependListener`/`prependOnceListener`, and
   `onmessage` going from null to a function. Removing the last listener
   unreferences it: `off`/`removeListener`, a `once` firing, or `onmessage = null`.
   `removeAllListeners()` leaves the flag as it is, as in Node. `close()`
   releases it for good.
5. **Worker-thread natural exit.** The kernel spec stays `serve: true`
   (ADR-0144). The Workbench node-entry bootstrap owns the worker-thread
   lifecycle the way it owns the terminal program's (ADR-0385). After the entry,
   it awaits the realm's drain without a cap (Node has none), then runs natural
   exit. The existing control port ends the kernel record after every earlier
   message. The parity runner's worker-env adapter runs worker-thread launches
   through the same bootstrap.
6. **Natural exit is Node's.** Every node-entry lifecycle owner exits the Node
   way: worker thread, `node <file>`, `node -e` and the execSync child. That
   means one `'exit'` with `exitCode ?? 0` (ADR-0445 rule 6), through the
   `NodeProcess` exit the bootstrap captured before any user code ran, never the
   user-reassignable `process.exit` property.
7. The same-realm fallback keeps its own worker lifetime (unchanged, not claimed).
   Its Worker still takes and releases the §1 references.

## Explicit gaps

Each gap is a named row in `docs/public/compat/process.md`:

- **Internal object shape.** The reference objects only have `ref`/`unref`/`hasRef`.
  Node's `kHandle` is a native Worker handle (`startThread`, `stopThread`,
  `getResourceLimits`, …) and `kPublicPort` is a `MessagePort`. Here,
  `instanceof MessagePort` is `false` and other members read `undefined`.
- **Public-port-only hold.** When the only hold is the listener-referenced public
  port (after `unref()`), whether Node delivers `'exit'` depends on its loop
  timing (evidence §Unref'd port hold). Rifty holds until the worker exits and
  always delivers it.
- **Kernel-path `'error'` for a worker-runtime throw** is still only `'exit'` 1
  (draft `runtime-js/worker-threads-kernel-error-event`).
- Node's listener cleanup at exit is unchanged: it removes the `'message'`
  listeners before `'exit'` and every listener after.
- **No-COI in-process project command.** Not a node-entry owner: its natural
  exit still calls the reassignable `process.exit` (`no-coi-project-command.ts:145`;
  compat ⚠️ "Handler dispatch in no-COI in-process project commands"; draft
  `distribution/no-coi-command-natural-exit-reassigned-exit`).

## Rejected

- One counted hold without Node's reference objects (draft PR #349). napi-rs
  finds nothing to neuter, so emnapi's `ref()` and listeners hold rolldown's
  pool. And #349 kept the kernel path's `serve: true` with no natural exit, so a
  finished Worker held its parent until the drain cap.
- A real `MessagePort` as `kPublicPort` (an ADR-0447 recorded pair). In Node-host
  realms (parity runner, unit tests) the native port's `ref()` holds the host
  loop, not rifty's count, so this would need a second mechanism, and the pair
  would carry nothing.
- `serve: false` plus the kernel drain hook (draft PR #351's worker path). The
  kernel's run-to-completion drain has the 30 s cap (ADR-0152 §4), which kills
  pool workers that listen, and it would add a second drain owner.
- Counting the IPC listener in the kernel: the kernel stays Node-API-agnostic
  (ADR-0039).

## References

- ADR-0152 (drain model, §1 handle set, §4 cap), ADR-0158 and ADR-0447
  (precedents: widened set), ADR-0445 rule 6 (natural exit), ADR-0385 (one
  foreground drain), ADR-0144 (serve), ADR-0011 (kernel Worker)
- `packages/runtime-js/src/builtins/worker_threads.ts`,
  `packages/runtime-js/src/internal/event-loop-keepalive.ts`,
  `packages/workbench/src/workers/node-entry-bootstrap.ts`
- `docs/backlog/runtime-js/worker-threads-handle-keepalive.md`
