# ADR 0376: No-COI toolchain operation lifecycle authority

Status: Accepted
Date: 2026-09-03

> TL;DR: one Worker-local binary slot is the sole outer admission authority
> for no-COI `install`/`runBin`; the host validates, correlates and settles
> peer loss but never schedules operations.

## Context

ADR-0374 introduced the explicit SDK `toolchain:{workerUrl}` composition: one
Workbench-owned Worker, one VFS/runtime authority, registry-twin runtime
bindings, narrow install/run-bin control, immediate overlap rejection and
terminal settlement. Its implementation then coupled that generic control
plane to Vite: install patched Vite files, run inspected `.bin/vite` plus argv,
Vite 8 version identity rejected before execution, and resident Vite modes had
their own branch.

The goal destination is the shared-memory-free class, not Vite. User decision
2026-09-01 makes Vite 7.3.6 only the exact representative build oracle and
Vite 8.0.16 only a real threaded-WASM boundary fixture. SDK, runtime,
control-plane, package and distribution code cannot depend on Vite identity,
version, callbacks, paths, types or lifecycle.

ADR-0371 remains the installed-byte authority. The packed predecessor proves
the repo-only runtime `./internal` composition seam through real tarballs and
strict declarations while the runtime root stays closed. Existing COI
Workbench Vite project modules keep their application-specific preparation;
that policy no longer enters the no-COI Worker graph.

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

1. ADR-0374 decisions 1-5 and 7 carry forward: explicit nested Worker URL, one
   Workbench Worker/VFS/runtime, exact-manifest install, installed-bin
   run-to-completion control, immutable capability report, busy rejection and
   existing Worker terminal settlement.
2. `install({cwd,registryUrl})` reads the exact project manifest and uses the
   ordinary npm-client/ADR-0371 path. Shared installed-tree finalization may
   apply compatibility needed across project kinds; Vite file preparation is
   not in this graph.
3. `runBin({cwd,binPath,args})` validates the request, then runs that installed
   launcher. It does not inspect package names, manifests, versions, paths or
   argv semantics. Vite dev/HMR gets its own public lifecycle in the next goal
   child; this completion primitive does not infer resident intent.
4. The toolchain realm supplies a lexical `WebAssembly` binding. Its `Memory`
   proxy performs WebIDL ToBoolean on `descriptor.shared` and throws
   `NotImplementedError('toolchain.threaded-wasm')` before native construction.
   The Worker-global constructor and non-shared constructor/prototype identity
   stay native; no permanent global wrapper exists.
5. A dependency may wrap the named gap in its own loader error. Run-bin error
   projection walks at most eight `Error.cause` links and surfaces the first
   real `NotImplementedError`; cycles/deeper chains remain the outer loud error.
   This is bounded error provenance, not retry/recovery state.
6. Vite fixtures own their necessary oracle setup. The Vite 8 boundary fixture
   selects its real WASI binding and pins its detached CLI promise inside the
   installed fixture bytes; product infrastructure sees only the resulting
   actual shared-memory request. A Vite-8-named bin that does not request shared
   memory runs normally. Vite 7 proves exact COI/no-COI build bytes.
7. The existing Worker-local boolean is the sole outer admission owner for
   `install` and `runBin`. Claim precedes dispatch/effect. An occupied slot
   posts one correlated `SandboxToolchainBusyError`; zero dispatch, output,
   mutation, network, queue or retry follows.
8. Install/run inputs are exact-validated and copied by the host before its
   first await/post. The host owns correlation and public-promise settlement:
   a result resolves/rejects once; dispose, Worker error or the intercepted
   explicit `self.close()` frame rejects all pending work. It never owns
   admission or scheduling.
9. Worker stdout/stderr and the terminal result use one Worker→host channel.
   Run posts its result only after entry, drain and VFS flush; the slot releases
   after that post. MessagePort FIFO supplies order while both peers live. No
   replay, acknowledgement, sequence or rollback layer is added.

## Consequences

- Shared-memory-free packages receive one honest generic authority; identity
  cannot silently narrow the admitted class.
- Vite 7/8 remain real ecosystem proofs without becoming public control-plane
  design.
- Existing COI Workbench Vite preparation remains application-specific and is
  not generalized or duplicated.
- Resident dev/HMR, restore/death lifecycle and unflushed boot marker remain
  `distribution/no-coi-dev-hmr-restore` at goal tier `works`.
- Toolchain install/run cannot race each other's shared realm state.
- Peer loss is loud but cannot prove non-application; no retry or rollback is
  claimed at tier `works`.
- An alive-but-blocked Worker cannot service BusyError or terminal frames;
  agent timeout and the later restart slice own that case.
- No new lock, FIFO, queue, map, scheduler, protocol field or state owner.

## Supersedes

ADR-0375. Its generic package/runtime authority and exact WebIDL/cause
contracts are grafted above; lifecycle ownership now records the forcing
constraint, class sweep and host/Worker seam. ADR-0375 had superseded ADR-0374:
explicit Worker ownership, API shapes, registry-twin authority, report,
overlap and terminal semantics remain; Vite identity/lifecycle policy and the
build-only finalizer remain removed.
