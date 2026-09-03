# ADR 0376: No-COI toolchain operation lifecycle authority

Status: Accepted
Date: 2026-09-03

> TL;DR: one Worker-local binary slot is the sole outer admission authority
> for no-COI `install`/`runBin`; the host validates, correlates and settles
> peer loss but never schedules operations.

## Context

ADR-0375 made that authority package-generic but carried its `busy`
coordination without the class inventory and forcing constraint required for a
ported mechanism.

One toolchain Worker owns the install/run mutable state: install changes its
single VFS tree and activated runtime bindings; run changes singleton
`process.cwd()`, `argv` and `exitCode`, executes from that tree, drains and
flushes it. These two operations have no transaction or rollback isolation.
The slot covers only toolchain install/run frames: the public runtime/fs
surfaces have separate contracts and are not silently claimed as serialized.

Repo-wide sweep:

- runtime host `pendingRequests` correlates requests and rejects promises on a
  signalled peer end; it is not admission;
- terminal, ProjectSession, Node-runtime and owner-PTY active-run gates own
  different UI/project/session scopes;
- owner/materializer/catalog FIFOs and package/stamp queues own project
  lifecycle or durable-tree transitions and wait rather than reject;
- npm-client semaphores and in-flight maps bound/deduplicate acquisition
  inside one install; they deliberately admit concurrency;
- Git, TypeScript and OPFS schedulers own separate repository, service-init or
  per-path persistence boundaries.

Candidates:

1. Keep the Worker boolean beside the mutable state. One claim, immediate
   rejection before dispatch, result publication, then release.
2. Move admission to a host boolean. Rejected: authority becomes remote from
   raw delivered frames; retaining Worker defence creates two owners.
3. Reuse a package/project FIFO. Rejected: it queues and imports unrelated
   durability/lifecycle semantics instead of immediate rejection.
4. Spawn a Worker per operation. Rejected: it loses the one VFS, loader and
   activated-binding authority and creates an unproven cross-realm coherence
   problem.

## Decision

1. The existing Worker-local boolean is the sole outer admission owner for
   `install` and `runBin`. Claim precedes dispatch/effect. An occupied slot
   posts one correlated `SandboxToolchainBusyError`; zero dispatch, output,
   mutation, network, queue or retry follows.
2. Install/run inputs are exact-validated and copied by the host before its
   first await/post. The host owns correlation and public-promise settlement:
   a result resolves/rejects once; dispose, Worker error or the intercepted
   explicit `self.close()` frame rejects all pending work. It never owns
   admission or scheduling.
3. Worker stdout/stderr and the terminal result use one Worker→host channel.
   Run posts its result only after entry, drain and VFS flush; the slot releases
   after that post. MessagePort FIFO supplies order while both peers live. No
   replay, acknowledgement, sequence or rollback layer is added.

## Consequences

- Toolchain install/run cannot race each other's shared realm state.
- Peer loss is loud but cannot prove non-application; no retry or rollback is
  claimed at tier `works`.
- An alive-but-blocked Worker cannot service BusyError or terminal frames;
  agent timeout and the later restart slice own that case.
- No new lock, FIFO, queue, map, scheduler, protocol field or state owner.
