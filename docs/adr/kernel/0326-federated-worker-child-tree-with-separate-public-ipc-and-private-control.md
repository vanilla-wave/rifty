# ADR 0326: Federated Worker child tree with separate public IPC and private control

Status: Accepted
Date: 2026-07-26

> TL;DR: one owner-root ProcessManager federates PID/tree state across recursive
> Workers while a dedicated physical port carries separate optional Node JSON
> IPC, worker-thread structured clone, and private typed process control.

## Context

Real nodemon must fork an application Worker, discover and signal descendants,
and keep host lifecycle traffic alive after public IPC disconnect. Today every
realm restarts ProcessManager PID allocation, recursive exec paths allocate
separate `0xC0000000+` identities, and no owner can answer one coherent process
tree. ADR-0045 also makes a physical port unconditionally look like public fork
IPC and uses structured clone, whereas Node's default fork serialization is
JSON and a plain spawn has no `process.send`.

The useful ADR-0045 premise remains: asynchronous child traffic belongs on a
dedicated MessagePort, not the synchronous SAB ring or byte stdio ports. Its
public/control frame contract and failure behavior cannot remain.

## Decision

### One validated launch plan

Runtime-js normalizes argv, cwd, inherited/replacement env, stdio descriptors,
and `ipc: 'none' | 'json'` into one child-process plan before PID, Worker,
MessagePort, or SAB allocation. Invalid/duplicate IPC slots and unsupported
descriptor forms fail synchronously and allocate nothing. Worker and
same-realm claimed surfaces consume the same plan.

`rifty.node-entry/v1` becomes `rifty.node-entry/v2` atomically. V2 carries the
exact public IPC discriminator and continues ADR-0267's launch role,
`remoteFsRoot`, `previewScope`, terminal shape, and exact guest env. There is no
dual reader, env fallback, or permissive v1 growth. Recursive Node children
inherit the existing owner-backed sync-FS relay/root; missing provenance fails
before allocation.

### One federated process authority

The owner-root kernel ProcessManager allocates a monotonic PID namespace and is
the sole live `{pid, ppid, state}` tree ledger. PIDs are not reused during that
owner lifetime. Nested ProcessManagers own their direct physical Workers but
reserve, commit, abort, settle, and snapshot records through the existing
parent SAB sync-RPC chain.

Each SAB ring is attached to the parent PID known at spawn. Dispatch supplies
that trusted attachment context; guest payloads, mutable `process.pid`, and
hard-coded PPIDs cannot claim ancestry. Reservation and attachment complete
before guest entry. Failed launch aborts the reservation and every acquired
resource; kill while reserved prevents a late commit.

The recursive-runner and owner `0xC0000000+` counters are removed. Exec/spawn/
fork descendants use the same ledger. `worker_threads` keeps a separate
`threadId`, inherits its process PID/PPID as Node does, and does not create a
`ps` row.

### Separate logical lanes, one physical control lifetime

Every Worker process has one dedicated physical MessagePort for asynchronous
process traffic:

- a real `child_process.fork` enables runtime-js-owned Node default-JSON
  messages and logical disconnect;
- `worker_threads.parentPort` keeps structured-clone values under its distinct
  launch role;
- private typed frames carry PTY/resize, admission, listening/port removal,
  descendant settlement, and physical control.

Plain spawn, installed bins, direct Node, and host Workers expose no public
`process.send`, `disconnect`, or `'message'`. Private frames never reach guest
events and are validated before affecting state. Public JSON serialization
failure is synchronous and leaves the channel usable. Logical public
disconnect never closes private control; physical exit closes all lanes.
Advanced IPC serialization, handles, callbacks/options, and channel
`ref()`/`unref()` remain directed loud gaps.

### Finite process and terminal contract

The root snapshot backs only the forcing consumer forms: `exec('ps')`,
`spawn('ps', ['-A', '-o', 'ppid,pid'])`, `child.kill('SIGUSR2')`, and
`exec('kill -USR2 <pid>')`. Each query reads one coherent snapshot. Other
formats, signals, process groups, job control, and `/proc` are loud gaps.

One terminal state machine owns signal/natural exit, final stdout/stderr drain,
public disconnect, private-control close, ledger removal, and physical Worker
death. An ancestor close fences new reservations, terminates the actual
subtree, and settles every record once; recording descendants dead without
physical termination proof is forbidden.

> **Specified (2026-07-27, ADR-0332):** one kernel-owned output cut admits
> writes process-wide, snapshots exact stdout/stderr targets, and makes abrupt
> peer death a finite no-drain-claim outcome.

> **Specified (2026-07-27):** ancestor termination fences new reservations
> before child-first control. A physical owner's output cut waits for every
> successfully signalled exact remote/forwarded route to settle after its local
> close-callback checkpoint or prove peer death. Authenticated owner death
> bypasses an unresolved barrier. Teardown attempts every local cleanup before
> surfacing listener/upstream failures; no route or output ledger is duplicated.

Workbench binds private descendant events to its existing owner token, captured
PTY admission, and `previewScope`. Kernel owns no preview route or port claim;
the existing PreviewRegistry remains that authority. Old process/scope events
cannot clear a successor.

## Consequences

- Recursive Workers have truthful owner-visible identities, shared VFS
  provenance, finite `ps`/kill behavior, and exact subtree teardown.
- The physical port and SAB ring are reused and deepened; no Workbench PID
  mirror, second preview generation, capability-port inheritance, or process
  ledger is introduced.
- Cross-package kernel/runtime-js launch and wire contracts change atomically;
  Node entry protocol v2 has no compatibility bridge.
- Real-Worker fault tests must cover reserve/commit cancellation, missing FS
  relay, responder/peer death, invalid frames, JSON failure survival, output
  drain, stale preview events, parent death, and duplicate settlement.
- Crash/reload reconstruction is not promised; a current-session peer death is
  visible and invalidates readiness rather than fabricating exit or recovery.

Supersedes ADR-0045. Corrects the recursive private PID allocation clauses of
ADR-0011, the realm-local unified-registry clause of ADR-0012, PTY transport in
ADR-0146, P6b control transport in ADR-0150, public
`rifty:node-listening` in ADR-0155, unconditional fork IPC and
`postListening` in ADR-0157, worker-thread lane wording in ADR-0162, and the
v1-only bootstrap clause of ADR-0267. ADR-0225, ADR-0230, ADR-0257, ADR-0265,
ADR-0278, and ADR-0313 otherwise stand.
