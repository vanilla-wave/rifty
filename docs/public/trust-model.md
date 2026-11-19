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

## Isolate host (Node, ADR-0557, ADR-0563)

`@riftydev/isolate-host` is a server-side host: a Node service calls `runCode(code)`. Each call
gets a fresh isolated-vm V8 isolate running the rifty runtime. Isolates live in long-lived worker
processes with an empty environment, up to 4 concurrent calls per worker; guests of different
calls share a worker process.

- **Tested seam properties.** The guest sees no host global, host env, Node primitive or
  isolated-vm handle. It gets no network: `fetch`, `node:http`/`https`/`net` and `WebSocket`
  throw `NotImplementedError`. The time limit, the isolate heap limit, V8 fatal OOM and the
  worker RSS ceiling end the guilty call or its worker, never the consumer process. A guest that
  does not escape changes a neighbour's result only by delay (memory, hangs, floods tested next
  to neighbours); a lost worker's calls rerun once, each alone, where any exhaustion of the
  process — guest memory isolated-vm does not count (wasm, resizable buffers, ICU, timers)
  included — is that call's own. The worker's shared resources and their bounds: ADR-0563 §7.
- **Not protected: an isolate escape.** A V8 or isolated-vm bug can give the guest code execution
  as the worker's OS user, in a process that hosts other calls' guests, now and later: their
  code, data and output are reachable. Escaped code can read the consumer's `/proc/<ppid>/environ`,
  the filesystem, and the network. The empty worker env only stops a leak through a rifty bug.
- **Not protected: side channels between isolates of one worker** — an open class.
  `SharedArrayBuffer` and `Atomics` reach the guest (no second thread, no memory shared across
  isolates); `performance.now()` resolves to ~3 µs. Tenants that must not share a process need
  separate consumer processes.
- **Consumer's duty.** Put the workers behind an external boundary: a separate uid, a sandbox or
  container, an RSS cgroup. No secrets may be reachable by that user. Limit the call rate per
  source: a guest can repeat an attack in new calls without bound. Track Node point releases
  that patch V8. rifty does not orchestrate pods, hypervisors or deploys.
- **Custom embedders (`@riftydev/isolate-guest`, ADR-0558).** The same guest in an isolate the
  consumer creates. Its `createHostBridge` validates every guest argument. The limits, the kill,
  the process boundary and the escape posture above are then the embedder's to provide, not rifty's.

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
  ADR-0163 boundary). On rifty.dev, eddy resolves directly against
  `https://registry.npmjs.org` while the browser standard install path uses the same-origin
  `/npm-registry` proxy route (Netlify rewrite, ADR-0528; eddy itself is OFF in the production
  build while its host is down); both are operator-controlled routing choices, not a
  client-side source-of-truth recheck. A dishonest eddy could serve a
  different-but-internally-consistent closure; it cannot serve corrupted bytes (integrity catches
  that), and it cannot make an install silently wrong-and-undetected any more than a malicious
  registry mirror could.
- **Fail-soft.** Unreachable, HTTP error, malformed bundle, integrity mismatch, lockfile-coverage
  gap, or a typed `unsupported` decline → the client warns and runs the standard verifying
  install. A user never gets a wrong or failed install because the fast path was down.
- **Bounded staleness, visible.** Every bundle carries an as-of stamp (resolution timestamp,
  upstream registry, closure hash). `prefer: 'online'` forces a fresh recompute; the resolution
  TTL is operator-configurable (including 0). Staleness is auditable, never hidden.
- **Durable/CDN tier.** rifty.dev stores immutable bundles in Object Storage and serves CDN
  `GET /bundle/<hash>` from that bucket. This is a cache/delivery tier for content-addressed
  bytes, not a second source of truth: the client still verifies bundle integrity and falls back
  on any mismatch or miss.
- **Provenance.** `InstallResult.source` reports whether the eddy path or the standard path ran.

Run your own eddy (npm or Docker) to keep the speedup a property of the open, auditable,
self-hostable stack rather than a closed vendor turbo button.

## Follow-up

Hard resource enforcement is tracked separately in
`docs/backlog/kernel/host-operator-resource-enforcement.md`. Taking it up changes kernel public
behavior and needs its own ADR before implementation.
