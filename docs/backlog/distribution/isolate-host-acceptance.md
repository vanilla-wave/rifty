---
area: distribution
status: ready
title: Isolate host acceptance carrier — the runCode scenario as executable tests over isolated-vm and a live node oracle
created: 2026-11-18
why: First unit of goal isolate-host-run-code; the scenario must be executable and RED before the host exists.
epic: isolate-host-run-code
blocked_by: []
sources: [docs/backlog/epics/isolate-host-run-code/goal.md, docs/adr/distribution/0557-run-guest-code-in-a-disposable-child-process-holding-a-rifty-v8-isolate-isolated-vm.md]
code: [packages/isolate-host/tests]
---

## Context

The goal's `## User scenario` steps 1–5 as tests in
`packages/isolate-host/tests/` (vitest project `isolate-host`, global setup =
the package's real build). Real isolated-vm, real built guest runtime, real
child processes; no mocks. The single unit of the goal: the walls (guest
bundle + shim, child + limits, egress, packaging, docs) land against it.

## Challenge

challenge: 2026-11-18 — inherits the goal premise check (`goal.md` §Challenge)

## Acceptance

1. `runCode` is the package root's only runtime export; options `{timeoutMs, memoryLimitMb, maxOutputBytes}`, result `{stdout, stderr, exitCode, termination?: 'timeout' | 'memory', truncated?}` (ADR-0557 §1) → ADR-0557
2. Corpus parity: every `parity.test.ts` row without a `ceiling` equals the live oracle; a `ceiling` row stays literal and runs as an expected failure naming its compat/backlog owner → I1
3. Declared ceilings (`URL`, `structuredClone`, `fetch`, ESM syntax, `import()`) fail with a `NotImplementedError`/named message the model can act on, while real Node runs the same code (`parity.test.ts` ceilings block) → scenario
4. A file, a global and a pending timer of one call are absent from the next; no child outlives its result (`isolation.test.ts`) → I2
5. Host `globalThis`/env canaries absent from the guest; indirect-eval `import`, `getBuiltinModule`, `require('fs')`, `process.binding`, `Function` reach no host file; a walk of every value reachable from `globalThis` (symbols, getters, prototypes; host bridge included) plus every function flowing through intercepted `call`/`apply`/`bind`/`Reflect` while timers, stdio, crypto, performance and the codec run finds no foreign realm, no foreign `process`, no isolated-vm handle method; the guest pid is not the child's; the child's environment block holds no host variable (Linux: empty) and its command has `--no-node-snapshot` (`isolation.test.ts`) → I3
6. Sync busy loop and never-draining loop → `termination: 'timeout'`, each settled within `timeoutMs` + 1000 ms with consumer main-thread lag < 250 ms; heap growth → `memory`; `new Array(2**28).fill(0)` → `memory` with the child's sampled peak RSS < 2 × (256 + 3 × 64) MiB; each followed by a working `runCode` and no leftover child (`limits.test.ts`) → I4
7. Output cap: truncated prefix, run continues to its own exit code, `truncated: true`; a 256 MiB flood grows consumer RSS < 64 MiB and, at `memoryLimitMb: 32` (child RSS ceiling 352 MiB), still exits 0 — neither side buffers it (`limits.test.ts`) → I4
8. A child killed from outside (`kill -9`) rejects the call within 1000 ms naming the signal; host keeps working (`lifecycle.test.ts`) → I4
9. `fetch`, `node:http` request, `https.get`, `net.connect`, `tls`, `dgram`, `http2`, `WebSocket` → `NotImplementedError` (`egress.test.ts`) → I5
10. `pnpm pack` tarball + `npm install` into a clean project; `runCode` under plain `node` with only `PATH` (`packed-consumer.test.ts`) → I6
11. The guest UTF-8 TextEncoder/TextDecoder equals Node's on randomized one-shot, streamed, fatal, BOM and `encodeInto` inputs (`text-codec.test.ts`) → ADR-0557
12. The host bridge is hostile surface: every bridge function called with garbage (non-bytes, bad fd, non-integer/out-of-range ids, ms, lengths, exit codes) refuses with a guest-safe `TypeError` (no `file:`/`child.js` frame); the run keeps its own status, the consumer survives, no `__riftyHost_*` global remains, bridge return values carry no child state (`bridge.test.ts`) → I3
13. A hostile child (isolate escape) cannot hurt the consumer: garbage bytes, unknown kind, a header announcing more than its kind may carry (4 GiB, past the cap), bad fd/flags, short/long exit/memory payloads, output with no new bytes, past the cap or reverting truncation, error text > 4 KiB → child killed, `runCode` rejects `isolate-host child protocol violation: …` within 1000 ms, never a throw; a stalled legal frame buffers at most one frame; 2^16 accepted 1-byte frames hold < 4 MiB heap+arrayBuffers (`protocol.test.ts`, real hostile child processes) → I4
14. Output accounting holds for every write shape: 3e6 empty writes at a 1 KiB cap and 2e6 one-byte writes at 1 MiB grow consumer RSS < 64 MiB; `truncated` survives a timeout kill; `timeoutMs` above 2^31-1 is a `RangeError` (`limits.test.ts`) → I4
15. A child whose consumer dies exits (no orphan); a child that cannot spawn rejects at once (`lifecycle.test.ts`) → I4

## Reference contract

- Oracle: `node -e <code>`, `process.execPath` of the test run (CI and local:
  Node v24.16.0), `env: {}`, fresh temp cwd, stdin ignored.
- Mechanism: `canonicalNodeCliEvalOutcome` from
  `tools/node-parity-runner/src/node-cli-eval.ts` (diagnostic projection for
  `evalError` rows only).
- Killed child: Node `spawnSync().status === null`; rifty
  `AgentCommandResult.exitCode: number | null`.

## Parity cases

1. The 32 `parity.test.ts` corpus rows (5 marked `ceiling`) (console values/format, byte `stdout.write`,
   UTF-8, stderr, interleaving, `exitCode`, `exit()`, `'exit'` event, event
   loop order, async/await, interval, fs sync/promises/ENOENT, Buffer,
   path/util, crypto hashes, events, CJS eval scope, compute, TextEncoder/
   TextDecoder, atob/btoa, ESM top-level await / static / dynamic import,
   four uncaught-error diagnostics, uncaught handler).
   Oracle outputs dumped 2026-11-18, Node v24.16.0, all exit on their own,
   no absolute path in stdout → I1

## Fault matrix

| axis × operation | honest outcome | artifact / fault target | trace |
|---|---|---|---|
| guest CPU × run | SIGKILL at deadline, `timeout` | limits: busy loop, setInterval | → I4 |
| guest heap × run | isolate disposed, `memory` | limits: heap growth | → I4 |
| V8 fatal OOM / child RSS × run | child reports or RSS watchdog, SIGKILL, `memory` | limits: `Array(2**28)` + peak RSS | → I4 |
| guest output × run | discard past cap, `truncated` | limits: cap + 256 MiB flood | → I4 |
| child killed externally / crash × run | `runCode` rejects at once naming code/signal | lifecycle: `kill -9` | → I4 |
| concurrent calls × run | independent instances | lifecycle: 3 parallel | → I2 |
| guest bridge args × call | validated, guest-safe refusal | bridge: garbage matrix | → I3 |
| child frames × fd 3 (escaped child) | kill + `protocol violation` rejection | protocol: hostile children | → I4 |
| consumer death × run | child exits on disconnect | lifecycle: orphan | → I4 |

## Out of scope

- `NotImplementedError` + compat ❌: URL, URLSearchParams, structuredClone,
  ReadableStream/WritableStream/TransformStream, AbortController/AbortSignal,
  EventTarget/Event, Blob, fetch, Request, Response, Headers, FormData,
  WebSocket, MessageChannel, `node:http`/`https`/`net`/`tls`/`dgram`/`http2`.
- Identity ceilings (rifty's): `process.version`, `os.platform()`,
  `process.cwd()`, empty `process.env`, `process.argv`.
- ESM syntax in `-e` → `NotImplementedError('isolate-host.node-eval-esm')`;
  `import()` → named rejection (unhandled: may exit 0 — compat ❌).
- stdin, `-p`, TypeScript input.

## Decisions

ready-verdict: 2026-11-18 — Contract+RED @ 9e76eb622

- re-cut: 2026-11-18 — import() unhandled detection trimmed to isolated-vm's report after three Final+GREEN rounds on that boundary (late handler → exit 0, compat ⚠️, `distribution/isolate-host-import-late-handler`) — trace: ADR-0557
- re-cut: 2026-11-18 — trim reverted: the late-handler case is fixed (empty isolate task after each import request flushes isolated-vm's unhandled report) and carried by a parity row — trace: ADR-0557
- re-cut: 2026-11-18 — import() handler from a timer queued before the import request declared ⚠️ (REV-7, 5th instance; ordering needs a guest-owned import(), `distribution/isolate-host-import-before-queued-timer`) — trace: ADR-0557
- re-cut: 2026-11-18 — manager (cross-review 1): unhandled-import() ordering machinery removed, no corpus/scenario row needs it (REV-7); unhandled import() may exit 0 — compat ❌ — trace: ADR-0557
- re-cut: 2026-11-18 — cross-review 1: Acceptance 12–15 + three fault rows added (hostile bridge args, hostile child IPC, write-shape accounting, orphan/spawn) — trace: I3, I4
- re-cut: 2026-11-18 — Acceptance 13 restated for the framed fd-3 channel (Node IPC removed after a malformed frame crashed the consumer in Node's deserializer) — trace: I4
- 2026-11-18 — stderr canonicalization only on uncaught-error rows; stdout and every other stderr compared raw (no CRLF/ANSI normalization).
- re-cut: 2026-11-18 — manager amend (goal.md): I3 bridge-walk attack, I4 reasons `timeout`|`memory` + one memory knob + settle bound + child death, ESM and ceiling rows; ceiling rows run as expected failures — trace: I1, I3, I4
- 2026-11-18 — the parity carrier lives with the package (it needs the package build) and imports the node-cli-eval projection rather than copying it.
