---
kind: epic
status: ready
title: Isolate host — a Node service runs guest code in a fresh rifty V8 isolate via runCode
created: 2026-11-18
value: A Node service swaps its temporary isolated-vm executor for rifty's `runCode(code) → {stdout, stderr, exitCode}` with Node-faithful results and host-safe limits.
user_story: As a Node service running model-generated JS, I want `runCode(code)` to execute it in a clean disposable rifty runtime with Node's observable result, but today rifty has no server host — `createSandbox` needs a browser Worker and the runtime needs Web APIs a bare V8 isolate lacks
tier: works
---

## Outcome

A Node service (the consumer) imports one public rifty package and calls
`runCode(code)`. Each call runs `code` as `node -e` would, inside a fresh
disposable rifty runtime in a V8 isolate (isolated-vm) inside a disposable
child process the package spawns. The result `{stdout, stderr, exitCode}` is
Node's, minus declared ceilings. Runaway guests end with a distinguishable
result; the consumer process stays healthy. The call shape is the consumer's
`runCode(code)` and the result is a superset of `{stdout, stderr, exitCode}`
(the consumer's own executor type is unread; no rewrite-free claim beyond
that).
Done = a Node host wires the package in dev by its documentation, installing
the packed tarball; npm publication is confirm-first (`DEC-3`) and outside
this goal.

rifty guarantees the seam properties its tests prove (I3–I5): guest code in
the isolate reaches no Node primitive, host value or network. It does not
protect against an isolate escape: escaped code runs as the child's uid and
can read the parent's `/proc/<ppid>/environ`, the filesystem and the network.
An external boundary around the child (separate uid/sandbox/container) is the
consumer's duty; no hard containment.
No density or speed promise (tracer bullet).

## User scenario

1. A Node 24 service installs the packed package by its README and imports
   `runCode` from the package root; the service starts with plain `node` (no
   extra flags).
2. It calls `await runCode(code)` for each snippet of the model-style corpus
   (console output, `process.stdout.write` without newline, `console.error`,
   uncaught throw and rejection, `process.exit`/`exitCode`, timers and
   promises, `fs` round-trip on the in-memory VFS, `Buffer`, `require` of
   builtins, ESM syntax: top-level `await`, static and dynamic `import`). Each result `{stdout, stderr, exitCode}` equals `node -e <code>`
   run by the same Node executable.
3. A second call does not see the first call's files, globals or timers.
4. Guest code looking for host secrets (a host `globalThis` canary, a host env
   canary, the child realm through the bridge) finds none; declared ceilings
   (`URL`, `structuredClone`, …) throw a `NotImplementedError` naming the API; `fetch`/`http`/`https`/`net`/WebSocket fail loudly.
5. A runaway guest — busy loop, heap blow-up, catastrophic allocation —
   returns within its limit with `exitCode: null` and reason `timeout` or
   `memory`; an output flood is truncated at the cap; the service's next
   `runCode` works.

## Invariants

<!-- False on main a187ce3e0: no isolate host package exists (`git grep -n -i
isolated-vm` empty; `ls packages` has no host); `createSandbox` requires a web
Worker (`packages/rifty/src/sandbox.ts`); main bundled into one script fails in
a bare isolated-vm isolate at load (`ReferenceError: TextEncoder is not
defined`, then ReadableStream/DOMException/atob; probe 3 in `## Evidence`). -->

- I1. Parity: for every corpus snippet, `runCode(code)` returns
  `{stdout, stderr, exitCode}` equal to `node -e <code>` from the same Node
  executable (live child oracle). stdout is byte-exact (UTF-8 decoded:
  `process.stdout.write('x')` → `'x'`); stderr is exact except the existing
  node-cli-eval diagnostic canonicalization (`[eval]` header, caret, error
  line, user frame).
- I2. Fresh instance per call: state created by one call (VFS file, global,
  pending timer) is not observable in, and does not act during, the next call.
- I3. No host reach: a host-process `globalThis` canary and an env canary are
  not observable from guest code; the guest realm holds no Node primitive
  (indirect-eval `import('node:child_process')` reaches no real module), and
  no value reachable from the guest — host bridge functions included, through
  `f.constructor` chains or intercepted calls — yields the child's realm
  (real `process`: `dlopen`, `binding`, the child's pid) or an isolated-vm
  handle; the process hosting the isolate carries no inherited host
  environment.
- I4. Limits: overrunning time returns `{exitCode: null, termination:
  'timeout'}`; overrunning memory (isolate heap, catastrophic OOM, or the
  child RSS derived from the memory limit) returns `{exitCode: null,
  termination: 'memory'}`; every call settles within `timeoutMs` + 1000 ms;
  a child that dies on its own rejects the call at once, naming the signal; output past the cap is truncated (the run
  continues, `truncated: true`) and discarded, not buffered, by the host.
  The consumer process stays alive and its next `runCode` succeeds.
- I5. No network: guest egress (`fetch`, `node:http`/`https`/`net`,
  `WebSocket`) throws `NotImplementedError`, never `undefined` or
  `MODULE_NOT_FOUND`.
- I6. Consumer install: the packed package installs into a clean Node 24
  project by its README and `runCode` works under plain `node`.

## Evidence

Probes 2026-11-18, macOS 26.6.2 arm64 (M3 Pro), Node v24.16.0 (V8
13.6.233.17-node.49), `node --no-node-snapshot`; OOM and busy-loop probes on
isolated-vm 6.2.0 and 7.0.2 (identical outcomes), the main-in-isolate probe on
7.0.2 only. Memory probes ran on macOS only; the limit tests run in the Linux
CI unit lane. Harness: `new ivm.Isolate({memoryLimit: 64,
onCatastrophicError})`, `await ctx.eval(<guest>, {timeout})`, a 10 ms host
`setInterval` counting ticks/lag, then a fresh isolate evaluating `6*7`;
guests quoted below. The acceptance carrier re-runs them durably.

- OOM (`memoryLimit: 64`): heap growth (`for(;;)a.push({…})`, `Map`, small
  `Uint8Array`s) → `Isolate was disposed during execution due to memory
  limit`, host alive, fresh isolate evaluates. `new ArrayBuffer(16 MB)×N` /
  `new ArrayBuffer(2 GB)` → guest `RangeError: Array buffer allocation
  failed`, isolate alive. `new Array(2**28).fill(0)` → host RSS to ~1.26 GB,
  `onCatastrophicError('Catastrophic out-of-memory error')` + `Script failed
  to terminate`; the `eval` promise (timeout 5000) never settles; host event
  loop and new isolates keep working; memory not returned; `process.exit(0)`
  hangs until SIGKILL. isolated-vm README: `memoryLimit` is "a guideline";
  after `onCatastrophicError` "resources … are totally unrecoverable … end
  the process".
- Busy loop `for(;;){}` with `timeout: 2000`: async `ctx.eval` → host timer
  max lag 5–9 ms (not blocked), `Script execution timed out.`; `evalSync` →
  host blocked 1994–1998 ms.
- Main `a187ce3e0` bundled by esbuild (IIFE, 7.2 MB, `--platform=browser`,
  `node:module` external) loads in an isolated-vm 7.0.2 isolate in ~70 ms only
  after a prelude providing TextEncoder/TextDecoder, queueMicrotask, timers via
  host callbacks, performance, atob/btoa, web-stream classes and a
  DOMException placeholder. Then `console.log(1+1)` → `2\n`,
  `process.stdout.write('x')` (byte sink) → `x`, fs round-trip on MemoryFs,
  `Buffer`, `require('path'|'util'|'crypto')` sha256 match Node;
  `require('http'|'https'|'net')` → `MODULE_NOT_FOUND`; `new URL`,
  `structuredClone`, `WebSocket` → `ReferenceError`; `process.version`
  `v24.0.0`, `os.platform()` `rifty`.

## Challenge

challenge: 2026-11-18 — 4 problems (fresh critic), resolved:
1. Cheaper route (rifty in a clean-env child realm, no isolate): answered — I3 gains the Node-primitive clause and a rejected-route line with the probe.
2. Output overflow reading: «обрезка» = truncation; I4 changed from termination to `truncated: true`.
3. Result shape on termination (`exitCode: null` vs the consumer's type): manager has no consumer type (requirements fix only `{stdout, stderr, exitCode}`); settled by the manager's decision on two references (see Decisions); a different user answer arrives as an amendment (`RDY-6`).
4. Advisory, publish: Done states tarball install; publishing outside the goal.

final-check: 2026-11-18 — PASS after one fix round, fresh read-only RDY-6/FIT 8 review of goal, map, ledger and the carrier draft against the requirements and relayed user words; no product implementation claimed.

## Decisions

- 2026-11-17 — user (via thread manager): «Хочется завезти в rifty новый тир для исполнения песочницы на V8 isolates.»
- 2026-11-18 — user (via thread manager): «Стартуй первый кусок. Выбери сам одна цель или несколько. Можешь мержить ПРы. Один ПР - одна цель.»; «ожидаю что user-fork не должно быть, если есть обязательно пиши в этот тред».
- 2026-11-18 — manager decision (the user saw the four forks with recommendations on 2026-11-17, raised no objection, and on 2026-11-18 said to start with «ожидаю что user-fork не должно быть, если есть обязательно пиши в этот тред»): mission widens narrowly — a Node host executes a rifty guest in a V8 isolate; orchestration, pods, hypervisor, deploy stay outside rifty.
- 2026-11-18 — manager decision (same basis): safety promise = seam properties proven by tests (I3–I5, I4's kill) plus a stated requirement for an external boundary around the process; not hard containment.
- 2026-11-18 — manager decision (same basis): "cheaper than real Node" is unmeasured; tracer bullet, no density/speed promise.
- 2026-11-18 — manager decision (same basis): tier `works` — reachable faults return a distinct termination or loud throw, no crash/reload consistency; time and memory limits are invariants (I4).
- 2026-11-18 — manager decision (OOM probe fork, user not yet answered in the manager thread): option A — the isolate lives in a disposable child process per `runCode`; keeps the user's acceptance "code over the time or memory limit does not crash the host process" strict. A meets the user's acceptance literally; B (in-process, weaker memory clause) could only arrive as a user amendment (`RDY-6`).
- rejected route: isolate in the consumer process (in-process isolated-vm) — violates Outcome «the consumer process stays healthy» and I4 (catastrophic OOM leaves an unsettled call, ~1.26 GB never returned, a hung `process.exit`).
- rejected route: guest in a `worker_threads` Worker or `node:vm` in the consumer process — violates I3 (same realm/process as the host's secrets once rifty is broken).
- rejected route: rifty runtime directly in a clean-env child Node realm (or its `worker_threads`), no isolate — violates I3 (probe: there `(0,eval)("import('node:child_process')")` resolves the real module; in an isolated-vm isolate it rejects `Not supported`) and the user's «на V8 isolates».
- 2026-11-18 — output cap reads the requirement «обрезка вывода (cap)» literally: truncate and continue, flagged `truncated: true`; not a termination.
- 2026-11-18 — limits are `runCode` options `timeoutMs`, `memoryLimitMb`, `maxOutputBytes` with documented defaults (heap 256 MiB and time 30 000 ms from the bench harness; output 1 MiB chosen by the agent); child RSS ceiling derived = 256 MiB + 3 × `memoryLimitMb` (isolated-vm README: a hostile guest may use 2–3× the limit); defaults, not promises.
- 2026-11-18 — manager: termination = `exitCode: null` + `termination` reason; references: Node `spawnSync().status === null` for a killed child, rifty `AgentCommandResult.exitCode: number | null` (`packages/agent/src/types.ts`). stderr carries guest bytes only — a host-appended line would misreport program output.
- 2026-11-18 — manager: past the output cap the host discards (not buffers) further output; a flood until timeout does not grow host memory (I4 carrier).
- 2026-11-18 — host needs no `--no-node-snapshot` (I6, scenario 1): with A the package starts its child with the flag itself, superseding the requirements' "flag in every host launch path" for this host (ADR-0557).
- 2026-11-18 — binary file output (requirements «бинарный выход … с первого этапа») stays out: the user's first-increment decision «сначала дадим возможность просто исполнить кусок кода в чистом isolate» and «Файлов … в первом инкременте нет» settle it; host file ops are the successor goal.
- 2026-11-18 — «настройка вкл/выкл» reads as the consumer's rollout flag (requirements: dev only, behind a flag, pinned per dialog) — consumer side, no package knob.
- rejected route: consumer composes rifty internals (`vfs/internal`, `runNodeEntry`) itself — violates Outcome (public package API only; user decision in requirements).
- amend: 2026-11-18 — manager (FIT audit of b005243bd/5f4a91dcf): I3 adds the bridge-walk/constructor-chain attack; I4 collapses reasons to `timeout` | `memory`, one public memory knob (RSS ceiling derived), bound `timeoutMs` + 1000 ms, unexpected child death rejects at once; Outcome narrows to call shape + result superset and to no protection after an isolate escape (external boundary around the child is the consumer's); scenario 2 adds ESM rows, step 4 adds ceiling rows.
- 2026-11-18 — manager decision (post-guest class bound, verbatim): «Граница — child, не realm гостя. Гость делит realm с runtime rifty, и по требованиям «гость ломает собственный rifty» допустимо: отравив встроенные объекты, он может получить для своего же вызова другие stdout/stderr/exitCode, чем дал бы Node. Это объявленный открытый класс (compat ⚠️), паритет на отравленном runtime не цель и не чинится вектор за вектором.» Required, checked outside the isolate: the consumer always gets a well-typed result or a defined reject; reject text and `termination` are never built from guest data; the guest sees no host text or frames; a runtime that hands over no usable status gets the child's fixed outcome (exit 1, no host text). In-realm primordial captures stay where they close the round-2 N2/N3 repros; a further poisoning vector is a concern, not a blocker.
- 2026-11-18 — manager decision: requirements line 23 lists URL, structuredClone, web streams, AbortController/Signal, Event/EventTarget/CustomEvent for the shim; in this goal they are loud ceilings, the list is closed (ADR-0557 §5); the requirement moves to the successor goal named in `docs/ROADMAP.md`. A new ceiling found during implementation is a ledger `re-cut:` line; corpus rows are never edited or removed to pass.
