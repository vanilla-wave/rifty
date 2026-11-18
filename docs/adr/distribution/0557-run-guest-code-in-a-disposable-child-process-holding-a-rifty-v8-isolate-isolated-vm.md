# ADR 0557: Run guest code in a disposable child process holding a rifty V8 isolate (isolated-vm)

Status: Accepted
Date: 2026-11

> TL;DR: New package `@riftydev/isolate-host` exports `runCode(code, options?)`; each call spawns a clean-env child Node process that runs the whole rifty runtime inside one isolated-vm V8 isolate and is killed afterwards.

## Context

Mission widening, narrow (goal `isolate-host-run-code`, manager by the user's
delegation 2026-11-17): a Node host executes a rifty guest in a V8 isolate.
Overturns, for this host only, `docs/research/open-webcontainers-alternative-2026-06.md`
§Explicitly out of scope "remote/cloud execution + the agent-backend market":
rifty now ships a server-side host. Orchestration, pods, hypervisor and deploy
stay outside rifty. Browser runtime, its trust model and ADRs are unchanged.

Probes (goal §Evidence, Node v24.16.0, isolated-vm 6.2.0/7.0.2): in-process
isolated-vm cannot keep the host healthy — `new Array(2**28).fill(0)` under
`memoryLimit: 64` grows host RSS to ~1.26 GB, fires `onCatastrophicError`, the
eval never settles and `process.exit` hangs; README: after it "resources … are
totally unrecoverable". Async `eval` keeps the main thread free; `evalSync`
blocks it.

## Decision

1. Public API (`src/index.ts` only): `runCode(code: string, options?: {
   timeoutMs, memoryLimitMb, maxRssMb, maxOutputBytes }) →
   Promise<{ stdout, stderr, exitCode: number | null, termination?,
   truncated? }>`. Contract: observable result = `node -e <code>` on the same
   Node, minus declared ceilings. Killed run → `exitCode: null` (Node
   `spawnSync().status` for a killed child; rifty `AgentCommandResult`) and
   `termination: 'timeout' | 'memory' | 'catastrophic-oom' | 'rss'`; stderr is
   guest bytes only. Output past `maxOutputBytes` (stdout+stderr) is dropped,
   run continues, `truncated: true`.
2. Process boundary per call (manager decision A, 2026-11-18): the package
   spawns `process.execPath --no-node-snapshot <dist/child.js>` with `env: {}`,
   code sent over IPC (never argv). The consumer process loads no native addon
   and needs no flag — replaces the requirements' "flag in every host launch
   path". Deviation from the requirements' "one Node process holds all agents
   and isolates": agents stay in the consumer process, isolates move to
   children; reason: the OOM probe + isolated-vm README ("keep instances of
   isolated-vm in a different nodejs process").
3. Kills, all SIGKILL by the parent, each a distinct `termination`: wall-clock
   deadline from call start (`timeout`); isolate heap limit disposes the
   isolate (`memory`); `onCatastrophicError` reported by the child
   (`catastrophic-oom`); child RSS self-sampled every 25 ms over `maxRssMb`
   (`rss`). The deadline also backstops a child that stops reporting.
4. Isolate content: one esbuild IIFE (`dist/guest.js`) = bare-V8 Web shim +
   rifty runtime-js/vfs/io from source + guest entry running the existing
   node-eval lifecycle (`runNodeEntry({kind:'eval'})` → `awaitDrain` →
   natural exit). Owner of FS in the same realm (MemoryFs, no SAB).
5. Shim (`src/guest/`), sized by the scenario corpus: real UTF-8
   TextEncoder/TextDecoder (differential-tested against Node), atob/btoa,
   DOMException, queueMicrotask (errors routed to rifty's uncaught path),
   timers and `performance.now`/`crypto.getRandomValues` via host callbacks.
   Every other Node global the runtime or guest may touch (URL,
   URLSearchParams, structuredClone, web streams, AbortController, EventTarget,
   Event, Blob, fetch, Request, Response, Headers, FormData, WebSocket,
   MessageChannel) exists and throws `NotImplementedError` on use; compat ❌.
6. Egress: `fetch`/`WebSocket` loud (5); `node:http`, `https`, `net`, `tls`,
   `dgram`, `http2` register as loud modules (`NotImplementedError` at
   require). No host callback exposes network or host FS.
7. Dependency: `isolated-vm@7.0.2` exact (ships prebuilds linux-x64/arm64,
   darwin-arm64, win32-x64; engines node ≥24; maintenance mode). Allowed in
   `pnpm-workspace.yaml` `allowBuilds`. Only child code imports it; no ivm
   object ever enters the isolate.

Safety promise: the seam properties the tests prove (guest sees no host
globals/env/Node primitive, no network, limits end the child not the host).
Hard containment is not promised; an external boundary (container/VM, RSS
cgroup, no secrets in the pod) is required — `docs/public/trust-model.md`
§Isolate host.

Rejected: in-process isolated-vm (catastrophic OOM, above); rifty in a plain
child realm or `worker_threads` (indirect-eval `import('node:child_process')`
resolves real Node; isolate rejects `Not supported`); `node:vm`, workerd,
quickjs-emscripten (requirements §Тупики); option B, in-process with a weaker
memory invariant — pending the user, not built.

## Consequences

- Each call pays a process spawn + isolate + runtime-bundle load; measured,
  not promised (README).
- A second host topology to keep green: unit lane runs real children with the
  native addon on Linux CI.
- Guest identity ceilings stay rifty's (`process.version`, `os.platform()`,
  `process.cwd()`, empty `process.env`); compat lists them.
- Successors (directions, not scoped): host file ops on a live sandbox,
  `exec node <path>`, FS snapshot, template, process pool.
