# Trust model

rifty runs JavaScript and WASI guests in browser primitives: Web Workers, SharedArrayBuffer,
Atomics, a virtual filesystem, and a service-worker preview bridge. That makes the runtime
open, self-hostable, and auditable, but it does not make a browser tab equivalent to a VM,
container, Firecracker jail, or gVisor sandbox.

Use rifty for cooperative browser-local execution. Do not run hostile untrusted code expecting
hard containment.

## What the browser boundary provides

- Cross-origin isolation is required so SharedArrayBuffer and Atomics are available for sync IPC.
  It is a capability prerequisite, not a guest-security boundary.
- Web Workers give separate JavaScript realms and a `terminate()` path. They do not provide hard
  CPU accounting, memory quotas, syscalls, namespaces, cgroups, or kernel-enforced process
  isolation.
- Service Worker preview routing and BroadcastChannel/MessagePort bridges are origin-scoped
  browser coordination mechanisms. They are not network sandboxes.

## Current operator controls

The current host controls are cooperative lifecycle controls:

- `sandbox.dispose()` tears down the SDK runtime Worker created by `createSandbox()`.
- Kernel Worker handles expose kill/terminate paths for Worker-backed child processes.
- Runtime reset paths clear runtime-side state where exposed by the host API.

The kernel does not yet enforce host-operator quotas or policy. There is no built-in spawn cap,
spawn queue/throttle, wall-clock watchdog, memory accounting, or fetch/egress policy.

## Current safe claim

rifty can run many Node-compatible and WASI workloads locally in the browser, and its source and
hosting surface can be audited by the host operator. The honest claim is cooperative resource
control over browser-local workers, not hostile-code containment.

If a product needs to execute arbitrary hostile code, put a real containment boundary outside the
browser runtime.

## Eddy fast-install resolver (mirror-grade)

The opt-in `@riftydev/eddy` fast install (ADR-0182) adds a second, narrower trust surface —
a server-side resolver, not the browser runtime. It is OFF unless an operator sets a resolver
URL via env-config (D-004); standard `npm install` is untouched and is the always-on fallback.

- **What is verified.** The client checks every tarball's bytes against the integrity carried in
  eddy's bundle (catches corruption/transport tampering; non-disableable). This is the same
  `EINTEGRITY` check the standard install runs.
- **What is NOT verified.** The bundle is NOT re-checked against npm's source-of-truth packument —
  doing so would re-introduce the metadata waterfall eddy exists to remove. Fast mode therefore
  trusts the eddy operator **exactly as you already trust a registry mirror / proxy** (the
  ADR-0163 boundary). A dishonest eddy could serve a different-but-internally-consistent closure;
  it cannot serve corrupted bytes (integrity catches that), and it cannot make an install silently
  wrong-and-undetected any more than a malicious registry mirror could.
- **Fail-soft.** Unreachable, HTTP error, malformed bundle, integrity mismatch, lockfile-coverage
  gap, or a typed `unsupported` decline → the client warns and runs the standard verifying
  install. A user never gets a wrong or failed install because the fast path was down.
- **Bounded staleness, visible.** Every bundle carries an as-of stamp (resolution timestamp,
  upstream registry, closure hash). `prefer: 'online'` forces a fresh recompute; the resolution
  TTL is operator-configurable (including 0). Staleness is auditable, never hidden.
- **Provenance.** `InstallResult.source` reports whether the eddy path or the standard path ran.

Run your own eddy (npm or Docker) to keep the speedup a property of the open, auditable,
self-hostable stack rather than a closed vendor turbo button.

## Follow-up

Hard resource enforcement is tracked separately in
`docs/backlog/kernel/host-operator-resource-enforcement.md`. Taking it up changes kernel public
behavior and needs its own ADR before implementation.
