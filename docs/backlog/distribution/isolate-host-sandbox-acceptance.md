---
area: distribution
status: draft
title: Isolate host sandbox acceptance carrier — the agent's fix loop over one sandbox as executable tests against real node <path>
created: 2026-11-22
why: First unit of goal isolate-host-live-sandbox; the scenario must be executable and RED before the sandbox exists.
epic: isolate-host-live-sandbox
blocked_by: []
sources: [docs/backlog/epics/isolate-host-live-sandbox/goal.md, docs/backlog/distribution/reference/isolate-host-sandbox-step0.md, docs/adr/distribution/0563-run-runcode-in-a-pool-of-long-lived-worker-processes-each-hosting-many-isolates.md]
code: [packages/isolate-host/tests/sandbox-acceptance.test.ts, packages/isolate-host/tests/support.ts]
---

## Context

Goal scenario steps 1–9 as tests in
`packages/isolate-host/tests/sandbox-acceptance.test.ts` (vitest project
`isolate-host`, global setup = the real package build). The oracle is
`support.ts` `nodeSequence`: consecutive `node <path> [args]` processes of the
same Node executable over one fresh temporary directory, empty env, its real
path read as `/workspace`. The API is typed in the test from the goal's
contract until it exists. Committed RED: every case `it.fails`, failing at
`createSandbox` (run 2026-11-22: 18 expected failures pass). Error reports are
compared through `errorView` — the error line and the user files its frames
name, in order; positions and Node's header/footer are the runtime-js
diagnostics goal's.

## Challenge

challenge: 2026-11-22 — inherits the goal premise check (`goal.md` §Challenge)

## Acceptance

1. Buggy `main.js` + binary `input.bin` → exit 1, stdout and `errorView`
   equal to node's (`ReferenceError: makePdf is not defined` in
   `/workspace/main.js`); the fixed `main.js` + `lib/pdf.js` with
   `args: ['out/report.pdf']` → exactly node's result (`wrote out/report.pdf
   true`), the file tree and `out/report.pdf` bytes equal node's → I2, I3
2. A busy loop past `timeoutMs` 1500 → `timeout`; heap growth and `new
   Array(2 ** 28).fill(0)` at `memoryLimitMb` 64 → `memory`; each run's
   `partial` write is absent after it, earlier files intact; the next run
   reads them → I1
3. Two runs (`a.js` sets a global, `exitCode` 3, an `exit` listener, `chdir`,
   a module-cache counter, a timer, writes `n.txt`; `b.js` prints what is
   left): each run's result and file tree equal node's sequence → I2
4. `writeFile(v1)`, `exec`, `writeFile(v2)`, `exec`, `readFile` issued without
   awaiting: `v1`, `v2`, then the second run's file → I4
5. `destroy()` during a busy run with a write queued behind it: both reject
   `ERR_ISOLATE_HOST_SANDBOX_DESTROYED` (settled together, no unhandled
   rejection), as do later `readFile`/`exec` → I5
6. `readFile` of a missing path → `code: 'ENOENT'`, `path:
   '/workspace/nope/out.pdf'`, no host cwd in the message; a NUL in a path →
   `ERR_INVALID_ARG_VALUE`; sandbox B's guest does not see A's
   `secret.txt` (`false ["peek.js"]`) → I7
7. Write, run (creates `made.bin`), `snapshot()`, destroy, `createSandbox({
   snapshot })`: same tree; a run there reads `made.bin` → I9
8. An ESM entry (`main.mjs`; node runs it, exit 0) → exit 1 with
   `Not implemented: isolate-host.esm` on stderr → I2
9. Corpus, each row a run sequence vs node over the same files: relative
   `require`, JSON, `__filename`, `__dirname`, `argv` (a spaced arg, a flag),
   `require.main` / `module.id`, `path.relative`, a file the next run reads;
   `if (require.main === module) main()` by `cli.js` and `./cli.js`; an
   uncaught throw in a dependency and an async-main rejection (`errorView`
   equal); a syntax error in the entry and in a dependency, a missing module
   and entry (exit and stdout equal, stderr names node's file — the text is
   the diagnostics goal's ⚠️) → I2
10. `maxFileBytes` 1024, `maxFsBytes` 64 KiB: a 1025-byte host write and a
    host read of a 2000-byte guest file reject `ERR_FS_FILE_TOO_LARGE`; a run
    writing 100 KiB resolves `exit 0`, its stdout, `stateRefused:
    'ERR_FS_SNAPSHOT_TOO_LARGE'`, files as before plus nothing of it; host
    1 KiB writes meet `ERR_ISOLATE_HOST_SANDBOX_FULL` before 64 → I6, I1
11. Names with a space, accents, a newline, a 10-deep directory and an empty
    file round-trip host → guest; a guest write to `/tmp` is read by the host
    at `../../tmp/t.txt`; `../../../etc/passwd` is the sandbox's own
    `/etc/passwd` (ENOENT); `list` sizes; `remove` of a tree and a file, a
    second `remove` ENOENT → I3, I7
12. `fs.symlinkSync` in a run fails loudly (exit 1, names it); the sandbox
    holds only files → I2, I7
13. A run whose workers are all SIGKILLed while it is in flight resolves
    exactly once (`done`), and its `appendFileSync` landed once → I1

## Fault matrix

| axis × operation | honest outcome | artifact / fault target | trace |
|---|---|---|---|
| run ends on its own (exit N, throw, rejection) × state | state = the run's end state | rows 1, 3, 9 | → I1 |
| run killed (timeout, heap, catastrophic OOM) × state | state of before, run's own result | row 2 | → I1 |
| worker SIGKILL × run in flight | one transparent rerun from the same bytes; no double effect | row 13 | → I1 |
| worker lost twice × run | `ERR_ISOLATE_HOST_WORKER_LOST`, state of before | core unit | → I1 |
| end state over cap / uncapturable / guest-broken snapshot × run | result + `stateRefused`, state of before | row 10; core unit (OOM in capture, poisoned codec) | → I1, → I7 |
| hostile state bytes or frames from a worker × consumer decode | validated before use; worker violation path (ADR-0563 §3) | core unit (replaced `dist/child.js`) | → I7 |
| host op / run × issued unawaited | call order, one at a time | row 4 | → I4 |
| destroy × run in flight / queued op / host op in flight | all reject DESTROYED; isolate gone | row 5; core unit (host op in flight, isolate gone) | → I5 |
| model-chosen path (NUL, `..`, special names, deep) × host op | sandbox paths only; loud refusal | rows 6, 11 | → I3, → I7 |
| size × host op / state | `ERR_FS_FILE_TOO_LARGE` / `ERR_ISOLATE_HOST_SANDBOX_FULL` | row 10 | → I6 |
| bytes host → isolate (restore) × view of a larger buffer | only the view's range crosses | core unit | → I7 |

## Out of scope

The goal's `## Out of scope`.
