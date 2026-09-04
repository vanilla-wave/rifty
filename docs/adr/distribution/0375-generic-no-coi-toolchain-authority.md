# ADR 0375: Generic no-COI toolchain authority

Status: Accepted
Date: 2026-09-01

> TL;DR: the no-COI Worker installs an exact manifest and runs any admitted
> installed bin; package identity is never policy, and actual shared memory is
> rejected by one realm-local WebIDL guard.

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

## Consequences

- Shared-memory-free packages receive one honest generic authority; identity
  cannot silently narrow the admitted class.
- Vite 7/8 remain real ecosystem proofs without becoming public control-plane
  design.
- Existing COI Workbench Vite preparation remains application-specific and is
  not generalized or duplicated.
- Resident dev/HMR, restore/death lifecycle and the unflushed boot marker are
  owned by ADR-0377/0378/0379 at tier `works`.

## Supersedes

ADR-0374. Explicit Worker ownership, API shapes, registry-twin authority,
report, overlap and terminal semantics are grafted above. Vite identity/lifecycle
policy and the build-only finalizer are removed.
