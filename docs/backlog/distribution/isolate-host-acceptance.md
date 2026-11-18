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

1. `runCode` is the package root's only runtime export; options
   `{timeoutMs, memoryLimitMb, maxRssMb, maxOutputBytes}`, result
   `{stdout, stderr, exitCode, termination?, truncated?}` (ADR-0557 §1) → ADR-0557
2. Corpus parity: every `parity.test.ts` row equals the live oracle → I1
3. A file, a global and a pending timer of one call are absent from the next;
   no child outlives its result (`isolation.test.ts`) → I2
4. Host `globalThis`/env canaries absent from the guest; indirect-eval
   `import`, `getBuiltinModule`, `require('fs')`, `process.binding`,
   `Function` reach no host file; the child's environment block holds no
   host variable (Linux: empty) and its command has `--no-node-snapshot`
   (`isolation.test.ts`) → I3
5. Sync busy loop and never-draining loop → `termination: 'timeout'` within
   deadline + 3.5 s, consumer main-thread lag < 250 ms; heap growth →
   `memory`; `new Array(2**28).fill(0)` → `catastrophic-oom` (RSS cap high)
   and `rss` (cap 400 MiB); each followed by a working `runCode` and no
   leftover child (`limits.test.ts`) → I4
6. Output cap: truncated prefix, run continues to its own exit code,
   `truncated: true`; a 256 MiB flood grows consumer RSS < 64 MiB
   (`limits.test.ts`) → I4
7. `fetch`, `node:http` request, `https.get`, `net.connect`, `tls`, `dgram`,
   `http2`, `WebSocket` → `NotImplementedError` (`egress.test.ts`) → I5
8. `pnpm pack` tarball + `npm install` into a clean project; `runCode` under
   plain `node` with only `PATH` (`packed-consumer.test.ts`) → I6

## Reference contract

- Oracle: `node -e <code>`, `process.execPath` of the test run (CI and local:
  Node v24.16.0), `env: {}`, fresh temp cwd, stdin ignored.
- Mechanism: `canonicalNodeCliEvalOutcome` from
  `tools/node-parity-runner/src/node-cli-eval.ts` (diagnostic projection for
  `evalError` rows only).
- Killed child: Node `spawnSync().status === null`; rifty
  `AgentCommandResult.exitCode: number | null`.

## Parity cases

1. The 28 `parity.test.ts` rows (console values/format, byte `stdout.write`,
   UTF-8, stderr, interleaving, `exitCode`, `exit()`, `'exit'` event, event
   loop order, async/await, interval, fs sync/promises/ENOENT, Buffer,
   path/util, crypto hashes, events, CJS eval scope, compute, TextEncoder/
   TextDecoder, atob/btoa, four uncaught-error diagnostics, uncaught handler).
   Oracle outputs dumped 2026-11-18, Node v24.16.0, all exit on their own,
   no absolute path in stdout → I1

## Fault matrix

| axis × operation | honest outcome | artifact / fault target | trace |
|---|---|---|---|
| guest CPU × run | SIGKILL at deadline, `timeout` | limits: busy loop, setInterval | → I4 |
| guest heap × run | isolate disposed, `memory` | limits: heap growth | → I4 |
| V8 fatal OOM × run | child reports, SIGKILL, `catastrophic-oom` | limits: `Array(2**28)` | → I4 |
| child RSS × run | self-sample, SIGKILL, `rss` | limits: RSS cap 400 | → I4 |
| guest output × run | discard past cap, `truncated` | limits: cap + 256 MiB flood | → I4 |
| child killed externally × run | `runCode` rejects naming the signal | lifecycle: `kill -9` | → I4 |
| concurrent calls × run | independent instances | lifecycle: 3 parallel | → I2 |

## Out of scope

- `NotImplementedError` + compat ❌: URL, URLSearchParams, structuredClone,
  ReadableStream/WritableStream/TransformStream, AbortController/AbortSignal,
  EventTarget/Event, Blob, fetch, Request, Response, Headers, FormData,
  WebSocket, MessageChannel, `node:http`/`https`/`net`/`tls`/`dgram`/`http2`.
- Identity ceilings (rifty's): `process.version`, `os.platform()`,
  `process.cwd()`, empty `process.env`, `process.argv`.
- stdin, ESM input (`--input-type=module`), `-p`, TypeScript input.

## Decisions

- 2026-11-18 — stderr canonicalization only on uncaught-error rows; other rows exact.
- 2026-11-18 — the parity carrier lives with the package (it needs the package build) and imports the node-cli-eval projection rather than copying it.
