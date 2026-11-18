# ADR 0557: Run guest code in a disposable child process holding a rifty V8 isolate (isolated-vm)

Status: Accepted
Date: 2026-11

> TL;DR: New package `@riftydev/isolate-host` exports `runCode(code, options?)`; each call spawns a clean-env child Node process that runs the whole rifty runtime inside one isolated-vm V8 isolate and is killed afterwards.

## Context

Mission widening (`AGENTS.md` Scope), narrow (goal `isolate-host-run-code`; manager decision
2026-11-18 — the user saw the recommendation 2026-11-17, raised no objection
and said to start 2026-11-18): a Node host executes a rifty guest in a V8 isolate.
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
   timeoutMs, memoryLimitMb, maxOutputBytes }) → Promise<{ stdout, stderr,
   exitCode: number | null, termination?: 'timeout' | 'memory', truncated?:
   true }>`. Contract: observable result = `node -e <code>` on the same Node,
   minus declared ceilings. Killed run → `exitCode: null` (Node
   `spawnSync().status` for a killed child; rifty `AgentCommandResult`);
   stderr is guest bytes only. The consumer reacts to every memory path the
   same way, so they share one reason. Output past `maxOutputBytes`
   (stdout+stderr) is dropped, run continues, `truncated: true`. Every call
   settles within `timeoutMs` + 1000 ms. A child that exits without a result
   (crash, external SIGKILL, cgroup OOM-killer) rejects the call at once with
   an error naming the code/signal — an unknown failure, not a guest result.
2. Process boundary per call (manager decision A, 2026-11-18): the package
   spawns `process.execPath --no-node-snapshot <dist/child.js>` with `env: {}`,
   code sent over a pipe (never argv). The consumer process loads no native addon
   and needs no flag — replaces the requirements' "flag in every host launch
   path". Deviation from the requirements' "one Node process holds all agents
   and isolates": agents stay in the consumer process, isolates move to
   children; reason: the OOM probe + isolated-vm README ("keep instances of
   isolated-vm in a different nodejs process").
3. Kills, SIGKILL by the parent: wall-clock deadline from call start →
   `timeout`; isolate heap limit (isolate disposed), `onCatastrophicError`,
   or child RSS (self-sampled every 25 ms) over 256 MiB + 3 × `memoryLimitMb`
   (README: a hostile guest may use 2–3× the limit) → `memory`. The RSS
   watchdog is sampled: one backing-store doubling can overshoot it (measured
   peak 661–808 MiB at a 448 MiB ceiling; without it the same guest reached
   ~1.26 GB). One public
   memory knob; the RSS ceiling is derived.
4. Isolate content: one esbuild IIFE (`dist/guest.js`) = bare-V8 Web shim +
   rifty runtime-js/vfs/io from source + guest entry running the existing
   node-eval lifecycle (`runNodeEntry({kind:'eval'})` → `awaitDrain` →
   natural exit). Owner of FS in the same realm (MemoryFs, no SAB).
5. Shim (`src/guest/`, injected before every runtime module), sized by the
   scenario corpus: UTF-8 TextEncoder/TextDecoder (WHATWG decode, other labels
   loud), atob/btoa, DOMException, queueMicrotask (throws → rifty's uncaught
   path), timers via host callbacks (expiry runs `Timeout._onTimeout`),
   `performance.now`/`timeOrigin`, `crypto.getRandomValues`/`randomUUID`.
   Closed ceiling list, each a `NotImplementedError('isolate-host.<api>')`
   installed after the runtime loaded (its load-time feature detection still
   sees them absent): URL, URLSearchParams, structuredClone, Readable/
   Writable/TransformStream, TextDecoder/TextEncoderStream, Compression/
   DecompressionStream, AbortController, AbortSignal, EventTarget, Event,
   CustomEvent, Blob, File, fetch (rejects), Request, Response, Headers,
   FormData, WebSocket, MessageChannel, MessagePort, BroadcastChannel, the
   web-stream reader/controller/strategy classes, CloseEvent, MessageEvent,
   URLPattern, Crypto, CryptoKey, SubtleCrypto, Navigator + `navigator.*`,
   Performance/PerformanceEntry/Mark/Measure/Observer/ObserverEntryList/
   ResourceTiming, `performance.nodeTiming`, `crypto.subtle`, `performance.mark`/`measure`/`getEntries*`/`clear*`/
   `eventLoopUtilization`/`timerify`. The requirements' shim list (URL,
   structuredClone, streams, AbortController, EventTarget) is a ceiling here
   by manager decision, owned by the successor (`docs/ROADMAP.md` M14 B).
   Global `console` = `require('console')` (util.format over process stdio);
   fd 1/2 bytes reach the host through the no-spec process's default output
   sink (`setDefaultProcessOutputSink`), never via `console`. ESM syntax in
   `-e` (Node's detect-module SyntaxErrors) → `NotImplementedError(
   'isolate-host.node-eval-esm')`; `import()` in any form ends the run where
   the host sees the request: guest stderr `Error: Not implemented:
   isolate-host.dynamic-import (…)`, exit 1 — a guest may never observe the
   rejection, so a `.catch` fallback cannot keep the run alive (the honest
   price; ordering machinery removed, REV-7). `node -e`'s builtin-module globals are
   lazy getters over the rifty loader (Node v24.16.0 list); a test asserts the
   guest has every global name live `node -e` defines.
   `zlib`, `child_process`, `worker_threads` register as loud modules naming
   themselves (rifty builds them on CompressionStream / Workers).
6. Egress: `fetch`/`WebSocket` loud (5); `node:http`, `https`, `net` register
   as loud modules (`NotImplementedError` at require); `tls`/`dgram`/`http2`
   keep rifty's loud stubs. No host callback exposes network or host FS. The
   bridge is copying `ivm.Callback`s on a frozen, guest-reachable
   `__riftyIsolateHost`: the shim captures it in a closure and deletes the
   global before guest code, so no guest can call the host (`done` would bypass
   the process lifecycle); its arguments are still validated in the child
   (`src/child/bridge.ts`) with guest-safe `TypeError`s. What the run does
   after guest code — the fatal write, the natural exit — uses the host bridge
   and the captured `process.exit`. The guest realm is the guest's, so no
   lookup there is authority. The host's own tail consults nothing the guest
   can replace: it chains on the runtime's promises with the captured
   `Promise.prototype.then` (a native `await` looks up the guest's
   `constructor`/`then`), iterates by index, and hands the status over as ONE
   PRIMITIVE (resolving with a number does no `then` lookup); the CHILD
   validates it in its own realm — a non-integer or out-of-range status, a
   rejected tail or a throw is exit 1, and the child adds no text (stderr is
   guest bytes only, §1). So whatever a guest replaces, `runCode` resolves and
   settles within `timeoutMs` + 1000 ms (a guest that hangs its own run is
   killed as `timeout`). Node's exact status and text need rifty's runtime
   intact, and the runtime shares the guest's realm without primordials: a
   guest that replaces intrinsics it uses, or forges its exit signal, can
   change its own status and text either way, exit 0 for a Node failure
   included — an open class, compat ⚠️, owned by the runtime backlog. No Node IPC: the request goes as one JSON line on the child's
   stdin (kept open; its end tells the child the consumer died → self-kill),
   results come back as length-framed binary frames on fd 3 that the
   consumer parses itself (`src/protocol.ts`). A header announcing more than
   its kind may legally carry now (output ≤ 2 + remaining cap, exit 1,
   memory 0, error ≤ 4 KiB) is refused before its payload is buffered; each
   complete frame is judged against the protocol state (fd 1|2, flags 0|1,
   output only with new non-empty bytes or the one truncation flip — truncation
   rides output frames only, the terminal kinds carry exactly their code or
   nothing). A
   violation kills the child and rejects `isolate-host child protocol
   violation: …` (a child after an isolate escape is hostile). The consumer
   thus buffers at most one legal frame and keeps at most the cap of output,
   copied into one buffer per fd. Frames are handled as they are parsed, so a
   terminal frame settles the run and every later byte — in its chunk or after
   it — is ignored; a channel closed with no result settles as its own error,
   not at the deadline. With buffer doubling and the frame copy a
   cap-sized frame costs ~2× cap held and a few × cap transient RSS.
7. Dependency: `isolated-vm@7.0.2` exact (ships prebuilds linux-x64/arm64,
   darwin-arm64, win32-x64; engines node ≥24; maintenance mode). 7 over the
   consumer's 6.2.0: the addon now loads only in rifty's child, so the
   consumer's pin does not constrain it, and 7 adds `onUnhandledRejection`,
   which the guest's rejection path needs. Allowed in
   `pnpm-workspace.yaml` `allowBuilds`. Only child code imports it; no ivm
   object ever enters the isolate.

Safety promise: the seam properties the tests prove (guest code in the
isolate sees no host globals/env/Node primitive or isolated-vm handle, no
network; limits end the child, not the host). Not protected: an isolate
escape (V8 bug, isolated-vm glue bug) gives code execution as the child's
uid — it can read the parent's `/proc/<ppid>/environ`, the filesystem and the
network. The empty child env only stops leaks through a rifty bug. The
consumer must put the child behind its own boundary (separate uid, sandbox or
container, RSS cgroup); a parent holding secrets in the same uid/pod is
exposed to an escape — `docs/public/trust-model.md` §Isolate host.

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

## Corrections

- 2026-11-18 — §6: the status crossed as `{code, diagnosed}`; a guest `Object.prototype.then` rewrote it (resolution looks up `then` on objects). Now one integer, and an unusable status is exit 1 with no child-written stderr line (that line broke §1 "stderr is guest bytes only"); `diagnosed` removed with it.
- 2026-11-18 — §6: the tail's native `await`s let a guest `Promise.prototype.constructor`/`then` skip the drain (a timer throw read clean 0); now captured-`then` chaining and index loops. The earlier claim "only N named routes read clean" is dropped: rifty's runtime, not the host, decides the status in a shared realm, so the class is open (agent decision: self-poisoning that changes the guest's own status is a declared fidelity gap, not a host safety fault — no host reach, I3; bounded, I4).
