# ADR 0373: No-COI sandbox toolchain control plane

Status: Accepted
Date: 2026-09-01

> TL;DR: explicit `toolchain:{workerUrl}` boots one Workbench-owned toolchain
> Worker through the SDK and exposes only manifest install + run-to-completion
> `.bin` execution beside the existing runtime/fs handles.

## Context

`createSandbox({requireCrossOriginIsolation:false})` boots the generic runtime
Worker, but its public control plane can only eval and read/write known files.
The proven no-COI Vite loop needs npm-client, installed registry-twin admission, the
esbuild adapter and `runNodeEntry` in that same VFS/Worker realm. Page-side npm
cannot see the Worker mirror; a private eval global would be a hidden API; the
COI Workbench owner/kernel topology is the capability this tier cannot use.

This is additive published SDK API. ADR-0071 keeps deployment Worker URLs
caller-owned; ADR-0131 keeps the Worker mirror authoritative; ADR-0137/0174
make the installed `.bin` launcher, not a curated Vite callback, the execution
authority; ADR-0316 keeps registry-attested `esbuild-wasm@0.28.0` the sole
product adapter.

Mechanism sweep (`rg "BusyError|busy =|inFlight|pendingFs|command overlap"
packages apps`) found Workbench/PTY active-run rejection, npm fetch dedupe and
runtime-js host request correlation/Worker-terminal settlement. The toolchain
path reuses those two shapes: one active-run rejection in its Worker and one
extended RuntimeController correlation owner in the host; no second queue/map.

## Decision

1. `CreateSandboxOptions.toolchain?: {workerUrl:string|URL}` defaults absent.
   Presence selects the new
   `@riftydev/workbench/no-coi-toolchain-worker` entry. The toolchain overload
   does not require the legacy top-level `workerUrl`; only the selected
   toolchain Worker is spawned. Boot handshakes before returning;
   mismatch rejects `NotImplementedError('sandbox.toolchain.worker')`, never a
   controller whose methods hang.
2. A toolchain sandbox exposes `Sandbox.toolchain`:
   - `install({cwd, registryUrl}): Promise<void>` reads the real
     `<cwd>/package.json` and runs the existing npm-client install/admission in
     the Worker mirror. No registry default is baked.
   - `runBin({cwd, binPath, args}): Promise<{exitCode:number}>` accepts an
     installed `node_modules/.bin/*` launcher, runs `runNodeEntry(...,
     bin:true)`, and resolves after drain. Stdout/stderr remain the existing
     ordered `Sandbox.runtime` events. No shell parsing, stdin, streaming
     handle, cancellation, dev lifecycle or preview URL is added.
3. Workbench owns and publishes the toolchain Worker entry so it can legally
   compose its private runtime-adapter/Vite-preparation authorities with VFS,
   npm-client and runtime-js in one realm. SDK owns admission/control. The
   existing `Sandbox.runtime` and `Sandbox.fs` speak to that same Worker; no
   sibling mirror, deep consumer import, second request-correlation map or
   second runtime authority exists.
4. One install/run may mutate realm-global process/adapter state at a time.
   Overlap rejects immediately with `name: 'SandboxToolchainBusyError'`; no
   FIFO, lock, retry or hidden queue. Worker death/dispose rejects every
   admitted call with the existing Worker-termination signal.
5. Every toolchain sandbox returns an immutable capability report with exact
   feature rows; generic sandboxes retain the existing hardware
   `Sandbox.capabilities`. In no-COI toolchain mode the report distinguishes `working`,
   `degraded`+warning, and `throwing`+named error. Same-realm
   `child_process.spawn` and `worker_threads.Worker` additionally warn once on
   first use; `os.cpus()`/`availableParallelism()` expose one; execSync remains
   `NotImplementedError('child_process.execSync')`.
6. Vite 7.3.6 consumes the admitted esbuild runtime and real installed bin.
   On no-COI, Vite 8/Rolldown is rejected before pthread startup as
   `NotImplementedError('toolchain.threaded-wasm')`, naming the executed Vite
   version and Rolldown WASI pthread requirement. The toolchain Worker also
   maps direct shared `WebAssembly.Memory` construction to that same named
   error; non-shared memories are unchanged. The report declares the same
   general threaded-WASM boundary.

## Alternatives

- **Private eval globals/deep imports in the host.** Rejected: untyped hidden
  API plus a second VFS authority; this is the spike shape, not a product seam.
- **Reuse the public Workbench project/terminal surface.** Rejected: it admits
  the owner/kernel multi-Worker topology and COI gate, and imports dev/preview
  lifecycle outside this build-only unit.
- **Add broad `sandbox.exec()` now.** Rejected: command parsing, streaming,
  cancellation, stdin and preview normalization remain
  `distribution/public-api-ai-agent-exec-preview`; none is required to run one
  installed build bin to completion.
- **Queue overlapping calls.** Rejected: it adds fairness/cancellation state
  while the one shared process realm already makes overlap invalid. Loud busy
  rejection is the smallest honest contract.

## Consequences

- Headerless hosts get a narrow agent build loop without exposing Workbench
  internals or pretending at process isolation.
- The worker export and public SDK types are additive host wiring.
- Dev/HMR, restart, preview lifecycle and pending-write marker remain the next
  goal child; `sandbox.exec()` remains its independent broader API decision.

## Correction (2026-09-01 — Contract+RED)

The first accepted pickup draft put the toolchain entry in SDK, kept the
legacy top-level Worker URL mandatory, promised the report on generic
sandboxes, and named only Vite/Rolldown's threaded boundary. Contract+RED
corrected those clauses before implementation: Workbench owns the legal worker
composition; the toolchain overload needs only its nested URL; generic
sandboxes retain `capabilities`; direct shared WebAssembly memory reaches the
same named boundary. Current-main ADR-0371 further replaces the retired
shadow-asset port/CAS path with frozen installed-tree runtime bindings and
`activateWorkbenchRuntimeAdapters({bindings,fs,cwd})`. The narrow install/run-bin
surface is unchanged.
