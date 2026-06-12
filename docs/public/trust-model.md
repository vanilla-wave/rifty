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

## Follow-up

Hard resource enforcement is tracked separately in
`docs/backlog/kernel/host-operator-resource-enforcement.md`. Taking it up changes kernel public
behavior and needs its own ADR before implementation.
