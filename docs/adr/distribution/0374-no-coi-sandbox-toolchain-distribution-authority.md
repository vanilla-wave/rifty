# ADR 0374: No-COI sandbox toolchain distribution authority

Status: Accepted
Date: 2026-09-01

> TL;DR: explicit `toolchain:{workerUrl}` boots one Workbench-owned Worker;
> registry-twin bytes, narrow install/run-bin control and capability admission
> share that realm without another runtime, cache or protocol authority.

## Context

ADR-0373 accepted the first public no-COI toolchain control plane before
implementation. Its Contract+RED re-cut then changed four load-bearing
decisions: Workbench rather than SDK owns the Worker entry; the nested URL is
sufficient; only toolchain sandboxes expose the report; and direct shared
WebAssembly memory joins Vite/Rolldown at the named boundary. Merging current
main also replaced its shadow-asset premise with ADR-0371's installed
registry-twin authority. These changes exceed an in-place single-clause
correction, so this ADR supersedes ADR-0373 and grafts its current contract.

`createSandbox({requireCrossOriginIsolation:false})` can boot the generic
runtime Worker, but that public control plane only evaluates code and reads or
writes known files. The proven no-COI Vite loop needs npm-client, installed
registry-twin admission, the esbuild adapter and `runNodeEntry` in that same
VFS/Worker realm. Page-side npm cannot see the Worker mirror; a private eval
global would be a hidden API; the COI Workbench owner/kernel topology is the
capability this tier cannot use.

ADR-0371 supplies the byte authority: exact `esbuild-wasm@0.28.0` is acquired
through the ordinary registry-recipe path into the installed tree; npm-client
derives a frozen `{adapterId,packagePath}` binding from that attested
substitution; Workbench reads the member through the realm's existing
`FsSync`, verifies 13,918,738 bytes and SHA-256
`9d99d51a13469befdcfca172855f62724b87bdfc0c87a6a0729ddbb455d0fa3b`, then
activates the sole ADR-0226 client. No source URL, member bytes, callback,
shadow-asset CAS or capability port crosses the sandbox boundary.

This is additive published SDK API. ADR-0071 keeps deployment Worker URLs
caller-owned; ADR-0131 keeps the Worker mirror authoritative; ADR-0137/0174
make the installed `.bin` launcher, not a curated Vite callback, the execution
authority; ADR-0316 keeps registry-attested `esbuild-wasm@0.28.0` the sole
product adapter.

Mechanism sweep (`rg "BusyError|busy =|inFlight|pendingFs|command overlap"
packages apps`) found Workbench/PTY active-run rejection, npm fetch dedupe and
runtime-js host request correlation/Worker-terminal settlement. The toolchain
path reuses those shapes: one active-run rejection in its Worker and the
extended RuntimeController correlation owner in the host; no second
queue/map, byte cache or runtime authority.

## Decision

1. `CreateSandboxOptions.toolchain?: {workerUrl:string|URL}` defaults absent.
   Presence selects the
   `@riftydev/workbench/no-coi-toolchain-worker` entry. The toolchain overload
   does not require the legacy top-level `workerUrl`; only the selected
   toolchain Worker is spawned. Boot validates protocol and backend before
   returning; mismatch rejects
   `NotImplementedError('sandbox.toolchain.worker')`, never a controller whose
   methods hang.
2. A toolchain sandbox exposes `Sandbox.toolchain`:
   - `install({cwd, registryUrl}): Promise<void>` reads the real
     `<cwd>/package.json` and runs existing npm-client install/admission in the
     Worker mirror. No registry default is baked.
   - `runBin({cwd, binPath, args}): Promise<{exitCode:number}>` accepts an
     installed `node_modules/.bin/*` launcher, runs `runNodeEntry(...,
     bin:true)`, and resolves after drain. Stdout/stderr remain existing
     ordered `Sandbox.runtime` events. No shell parsing, stdin, streaming
     handle, cancellation, dev lifecycle or preview URL is added.
3. Workbench owns and publishes the toolchain Worker entry so it can legally
   compose its private runtime-adapter/Vite-preparation authorities with VFS,
   npm-client and runtime-js in one realm. SDK owns admission/control. Existing
   `Sandbox.runtime` and `Sandbox.fs` speak to that same Worker; no sibling
   mirror, deep consumer import, second request-correlation map or second
   runtime authority exists.
4. One install/run may mutate realm-global process/adapter state at a time.
   Overlap rejects immediately with `name: 'SandboxToolchainBusyError'`; no
   FIFO, lock, retry or hidden queue. Worker death/dispose rejects every
   admitted call with the existing Worker-termination signal.
5. Every toolchain sandbox returns an immutable capability report with exact
   feature rows; generic sandboxes retain existing hardware
   `Sandbox.capabilities`. In no-COI toolchain mode the report distinguishes
   `working`, `degraded`+warning and `throwing`+named error. Same-realm
   `child_process.spawn` and `worker_threads.Worker` warn once on first use;
   `os.cpus()`/`availableParallelism()` expose one; execSync remains
   `NotImplementedError('child_process.execSync')`.
6. Vite 7.3.6 consumes the admitted esbuild runtime and real installed bin.
   On no-COI, Vite 8/Rolldown rejects before pthread startup as
   `NotImplementedError('toolchain.threaded-wasm')`, naming the executed Vite
   version and Rolldown WASI pthread requirement. The toolchain realm rejects
   direct shared `WebAssembly.Memory` construction at that same named
   boundary; non-shared memories retain native identity.
7. Toolchain install/admission inherits ADR-0371 unchanged. Runtime bindings
   come only from the attested installed registry twin; the Worker verifies
   exact member size/hash through its existing `FsSync` before activation.
   Missing, unknown, duplicate or drifted bindings loud-throw. There is no
   host/network fallback source, shadow-asset delivery path or sandbox-local
   byte cache.

## Alternatives

- **SDK-owned generic Worker entry with both top-level and nested URLs.**
  Rejected: SDK cannot legally compose Workbench-private adapter authorities;
  two URLs admit sibling runtime mirrors and ambiguous ownership.
- **Private eval globals/deep imports in the host.** Rejected: untyped hidden
  API plus a second VFS authority; this is the spike shape, not a product seam.
- **Reuse the public Workbench project/terminal surface.** Rejected: it admits
  the owner/kernel multi-Worker topology and COI gate, and imports dev/preview
  lifecycle outside this build-only unit.
- **Restore the shadow-asset CAS/port path.** Rejected: ADR-0371 proved the
  exact member already rides ordinary installed-tree semantics; restoring it
  adds a second byte/cache/protocol authority without a forcing constraint.
- **Add broad `sandbox.exec()` now.** Rejected: command parsing, streaming,
  cancellation, stdin and preview normalization remain
  `distribution/public-api-ai-agent-exec-preview`; none is required to run one
  installed build bin to completion.
- **Queue overlapping calls.** Rejected: it adds fairness/cancellation state
  while one shared process realm already makes overlap invalid. Loud busy
  rejection is the smallest honest contract.

## Consequences

- Headerless hosts get a narrow agent build loop without exposing Workbench
  internals or pretending at process isolation.
- Registry substitution, installed bytes, runtime binding and adapter
  activation retain one authority from npm admission through guest import.
- The Worker export and public SDK types are additive host wiring.
- Dev/HMR, restart, preview lifecycle and pending-write marker remain the next
  goal child; `sandbox.exec()` remains its independent broader API decision.
- ADR-0373 is fully superseded. ADR-0371 remains active and authoritative for
  all registry-twin delivery and verification semantics.
