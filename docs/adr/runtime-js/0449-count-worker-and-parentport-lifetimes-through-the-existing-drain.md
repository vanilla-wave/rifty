# ADR 0449: Count Worker and parentPort lifetimes through the existing drain

Status: Accepted
Date: 2026-09

Worker and parentPort use the existing realm keepalive count. Extends the
named handle set in ADR-0152/0158; preserves ADR-0270's EventEmitter-only parent
Worker events and ADR-0267's typed recursive-worker bootstrap.

## Evidence and alternatives

Native Node v24.16.0 + exact shared sources and Chromium RED/GREEN:
`docs/backlog/runtime-js/reference/worker-thread-lifecycle-evidence.md`.

- Keep serve:true / await a Vitest startup promise: rejected. Child natural-exit
  RED hangs; package-specific promises cannot supply Node handle authority.
- Parent Worker ref alone: rejected. Existing serve:true child never exits,
  so its parent ref becomes permanent even after completed top-level work.
- Count both existing resource owners: selected. Parent Worker holds one ref;
  child parentPort holds one while referenced. Existing drain observes both;
  no second exit registry, timer, promise tracker or transport.

Sweep: timers.ts, child_process.ts and process.ts stdin/IPC already acquire and
release event-loop-keepalive refs. They own different resources; the shared
realm counter remains the single drain authority. Worker ref state belongs to
its parent realm, parentPort ref state to the physical child. Their booleans
record independent native handles, not competing settlement owners.

## Decision

Worker acquires its parent ref after constructor validation, before queued
startup. Native Node24 exposes two ref factors: native Worker handle and public
message port. ref/unref set both; first/last message-listener transitions alter
only the message factor. Their OR owns one aggregate realm ref. A new first
listener re-refs after unref; an additional listener does not. ref/unref return
undefined, as in Node. The shared MessageListenerEmitter owns transitions for
Worker and parentPort, preserving once/removeAll/prepend semantics.
Terminal finish releases once. Existing
observeProcessTerminalOutcome owns physical terminal observation. Explicit
empty execArgv overrides inherited eval arguments; nonempty unsupported
execArgv retains its named ceiling.

A small WorkerPort module owns listener transitions: first message/onmessage
listener refs, last removal unrefs; explicit ref/unref override the current
state; close releases and drops later messages without re-buffering them in
the private process IPC lane. Same-realm fallback ports
do not count a second child realm they do not have.

Kernel Workers use serve:false. The Workbench Worker entry waits for real
runtime/port drain without a time cap, then calls its existing process.exit.
This preserves indefinitely message-driven Rolldown workers while allowing
run-to-completion Workers to exit. Runtime-js port semantics stay outside kernel.

Worker stdout/stderr are real Readables fed by existing kernel output streams.
Defaults forward to captured owner fd writers; stdout/stderr:true suppress that
forwarding. Terminal finish sends EOF before emitting the parent exit event;
stream end callbacks may run later, as in Node. Existing stdout/stderr extension
events stay compatible. No extra IO channel or synthetic output.

## Consequences

- A plain parent survives until its late Worker message and exit; unref opts out.
- Finished children no longer pin parents; close/remove/unref settle child ports.
- Generic Worker acceptance is proven in hermetic Chromium; Vitest-main
  acceptance remains with the driver's fresh-server check.
- Same-realm fallback retains its existing loud degradation warning; browser
  acceptance rejects shared parent globals and uses physical Workers.
- Worker eval/data entries, nonempty execArgv, transferList/workerData clone
  gaps and runtime-error event identity remain existing explicit ceilings/gaps.
