---
area: runtime-js
status: ready
title: `Readable.pipe(process.stdout|stderr)` never calls `end()` on the process streams (Node's `doEnd` rule, unpipe at source end)
created: 2026-09-15
why: rifty's pipe ends the destination on source end unconditionally; Node exempts process.stdout/stderr (`doEnd = end !== false && dest !== process.stdout && dest !== process.stderr`); vitest pipes each pool child's stdout into process.stdout and crashes with "dest.end is not a function"
epic: vitest-run-in-browser
sources: [docs/backlog/runtime-js/reference/vitest-run-in-browser-evidence.md, docs/backlog/runtime-js/reference/readable-pipe-never-ends-process-stdio-evidence.md]
code: [packages/io/src/streams/readable.ts, packages/io/src/streams/pipeline.ts]
---

## Context

`readable.ts` `pipe`: `const endOnFinish = opts.end ?? true; … if
(endOnFinish) dest.end()`. Repro: `Readable.from(['a']).pipe(process.stdout)`
→ `aTypeError: dest.end is not a function`, exit 1. Oracle (Node v24.16.0, evidence §Oracle): `Readable.from(['a\n']).pipe(process.stdout)`
then a later `process.stdout.write('still-writable\n')` prints both lines and
`typeof process.stdout.end === 'function'` — pipe never ends the process
streams although `end` exists. rifty's process streams expose no `end` at all
(`typeof process.stdout.end === 'undefined'`).

PICKUP 2026-09-23 (`reference/readable-pipe-never-ends-process-stdio-evidence.md`):
Node's rule is one line with two halves — `endFn = doEnd ? onend : unpipe` —
so a non-ending pipe releases its listeners at source end. `process` there is
Node's bootstrap process, not `globalThis.process`. `pipeline()` pipes with
`{end: false}` and ends its last stage itself, stdio included. vitest 4.1.11
pipes every forks/threads pool child's stdout/stderr into its Logger streams,
which default to `process.stdout|stderr` (cli-api:1883, :3159/:3163, :3236/:3238).

## Challenge

challenge: 2026-09-15 — reuse epic vitest-run-in-browser (6 problems, resolved in goal.md)

## Acceptance

1. `Readable.pipe(process.stdout)` / `Readable.pipe(process.stderr)` — no options or `{end: true}` — never calls the stream's `end()`; after the source ends the stream stays writable (a later `write` prints), and a `node -e` program doing this exits 0 with Node's stdout/stderr (carriers: `stream/pipe-process-stdio.case.ts`, the pipe rows of `stream/pipe-process-stdio-end-calls.case.ts`, `stream/pipe-process-stdio-exit.case.ts`) → I4
2. vitest's forks-pool shape — `fork(entry, [], {stdio: 'pipe'})` with `child.stdout.pipe(process.stdout)` and `child.stderr.pipe(process.stderr)` — leaves both parent streams writable after the child closes; the parent's later lines print (carrier: `child_process/fork-stdout-pipe-process-stdio.case.ts`) → I4
3. The exemption is identity with the realm's own process streams, i.e. those of the process `require('node:process')` returns; every other destination still ends — an fd-1/`_isStdio` lookalike Writable and a Writable behind a reassigned `globalThis.process` emit `finish` (carrier: `stream/pipe-process-stdio.case.ts`) → REV-2
4. A pipe that does not end its destination (a process stream, or `{end: false}`) unpipes at source end: its listeners on source and destination return to baseline and the destination stays open and writable (carriers: `stream/pipe-process-stdio.case.ts` deltas, `stream/pipe-end-false-unpipe.case.ts`) → REV-2
5. `pipeline(src, process.stdout|stderr)` still calls the last stage's `end()` exactly once, as Node's pipeline does — never a pipeline left silently unsettled by the exemption (carrier: the pipeline rows of `stream/pipe-process-stdio-end-calls.case.ts`) → REV-2

## Reference contract

- Oracle: Node v24.16.0 (host), `lib/internal/streams/readable.js`
  `Readable.prototype.pipe` lines 927–935 (`doEnd`; `endFn = doEnd ? onend : unpipe`)
  and `lib/internal/streams/pipeline.js` `pipe()` (`src.pipe(dst, {end: false})`
  plus `dst.end()` on source end); probes P1–P11 in the evidence file.
- Mechanism reused: Node compares against its bootstrap `process`; rifty's
  equivalent binding is the `node:process` entry of io's builtin registry
  (ADR-0035) — the active kernel bootstrap that `require('node:process')`
  returns, unaffected by reassigning `globalThis.process`. Read through its
  factory, never the name-keyed cache (ADR-0458).

## Parity cases

1. `pnpm test:parity stream/pipe-process-stdio.case` (seeded, `stdin: []`) — Node: `a` / `stdout still writable; listener delta 0,0,0,0,0,0,0; source data/end listeners 0/0` / `stderr {end:true} not ended; listener delta 0,0,0,0,0,0,0` / `fd-1 lookalike Writable finished` / `Writable behind a reassigned globalThis.process finished`; rifty today: `TypeError: dest.end is not a function` → I4
2. `pnpm test:parity stream/pipe-process-stdio-end-calls` (seeded; non-ending own-property `end` spy on both runtimes) — Node: `Readable.pipe(process.stdout|stderr) end calls: 0`, `pipeline(src, process.stdout|stderr) end calls: 1`; rifty today: pipe rows `1` → I4
3. `pnpm test:parity stream/pipe-process-stdio-exit` (node-cli-eval, kernel Worker) — Node: stdout `piped to stdout\nstdout still writable\n`, stderr `piped to stderr\nstderr still writable\n`, code 0 per launch; rifty today: `TypeError: dest.end is not a function`, code 1 → I4
4. `pnpm test:parity fork-stdout-pipe-process-stdio` (child-worker) — Node: `child stdout line` / `child closed 0; parent stdout still writable`; rifty today: `TypeError: dest.end is not a function` → I4
5. `pnpm test:parity stream/pipe-end-false-unpipe` (default mode, no process) — Node: `dest listener delta 0,0,0,0,0,0,0; source data/end listeners 0/0` / `dest ended false` / `dest still writable: one,two`; rifty today: `delta 0,0,1,1,1,0,0; … 1/1` → REV-2

## Fault matrix

| axis × operation | honest outcome | artifact / fault target | trace |
|---|---|---|---|
| `poisoned-cache` × `pipe()` inside a same-realm child (active bootstrap swapped to the child) | the parent's later `require('node:process')` is still its own process (`=== process`, pid, `exitCode` writes); its `pipe(process.stdout)` stays exempt | `pnpm test:parity same-realm-child-pipe-parent-process` (seeded) — Node: `"child piped\n" close 0; require(node:process) === process true; pid match true; exitCode via require 3` / `parent piped` / `parent stdout still writable`; rifty @ bf44b7b36: `TypeError: dest.end is not a function` | → ADR-0458 |

## Out of scope

- Writable surface rifty's process streams lack (`process.stdout|stderr.end`,
  `writableEnded`, `destroy`): a direct `process.stdout.end()` stays
  `TypeError: process.stdout.end is not a function`, so
  `pipeline(src, process.stdout|stderr)` stays a loud
  `TypeError: dest.end is not a function` where Node ends the stream and
  un-destroys it (evidence P8–P11). Not tracked yet; reported for backlog routing.
- `fs.createReadStream(…).pipe(process.stdout|stderr)`: fs ReadStream owns a
  separate `pipe` (`fs-streams.ts:503`, always `dest.end()`, ignores options)
  and keeps today's `TypeError: dest.end is not a function`; not on vitest's
  path. Not tracked yet; reported for backlog routing.
- `'pipe'` / `'unpipe'` events on the destination: rifty's `pipe()`/`unpipe()`
  emit neither (Node emits both); pre-existing, not on vitest's path. Not
  tracked yet; reported for backlog routing.
- Piping a source whose `'end'` already fired (Node schedules `endFn` on
  `nextTick`): pre-existing, unchanged.
- `Worker.stdout|stderr` streams piped by the threads pool: map item 11.

## Decisions

ready-verdict: 2026-09-23 — Contract+RED @ f47817a285428608fb28d9c9a6df1cfe6a1ae890
- 2026-09-23 — identity source = io registry `loadBuiltin('process')` (ADR-0035 binding `require('node:process')` returns); rejected: `Symbol.for` brand on the streams (#349, observable via `getOwnPropertySymbols`), new io owner seam + ADR (#352, machinery the registry already carries), `globalThis.process` read (diverges on reassignment, P6). Internal, reversible — CHANGELOG, no ADR.
- 2026-09-23 — promise widened at pickup: Node's same-line `unpipe` half (incl. `{end: false}`) and pipeline ending its last stage itself — the exemption alone approximates Node's rule and turns `pipeline(src, process.stdout)` from a loud TypeError into a never-settling pipeline (spike, evidence).
- 2026-09-23 — no Fault matrix: in-realm stream wiring; no cache/persistence/network/concurrency boundary (the registry read is the existing `node:process` binding).
- 2026-09-23 — carriers: seeded parity mode for in-realm cases (default mode's `globalThis.process` is the host Node process — traps parity-runner-in-process); node-cli-eval for the kernel-installed process and exit status; child-worker for vitest's fork shape.
- 2026-09-23 — compat: `docs/public/compat/streams.md` gains a `Readable.pipe` row via the cli.js inventory at IMPLEMENT.
- 2026-09-23 — IMPLEMENT: `opts.end !== false` (Node's `pipeOpts.end !== false`) replaces `opts.end ?? true`, so `{end: 0}` ends like Node; new carrier `stream/pipe-end-option-coercion.case.ts` (RED on the old coercion).
- 2026-09-23 — Contract+RED concerns: forged-global row now holds the reassignment through source end, expected unchanged (strictly stronger; lazy/eager `globalThis.process` mutants ✗); REV-2 traces kept as carrier notes; stderr half of the fork case not hardened (stdout-only mutant still dies); untracked gaps reported for routing.
- 2026-09-23 — gate re-pin (PR-4): `check:esbuild-legacy-retirement` `typescript-worker.js` sha `018ea49b…` → `39b39916…`, bytes unchanged 10,022,694 — the worker carries no pipe code; only its references to content-hashed chunk names (`chunk-XXXXXXXX.js`, fixed width) changed with the io chunk.
- 2026-09-23 — Final+GREEN r1 reception (REV-12): the registry-cache poisoning blocker HOLDS. RED `same-realm-child-pipe-parent-process` ✗ @ bf44b7b36; identity probe `=== process false; pid match false; exitCode via require 0`. FIX: pipe reads the `node:process` factory uncached (`readBuiltinUncached`, ADR-0458, a decision on the ADR-0035 seam per DEC-2).
re-cut: 2026-09-23 — `## Fault matrix` added (poisoned-cache row → ADR-0458) and the uncached read added to the Reference contract; supersedes the "no Fault matrix" line and the `loadBuiltin('process')` identity source — trace: none
- 2026-09-23 — gate re-pin (PR-4) after the reception fix: `typescript-worker.js` sha `39b39916…` → `449a05a9…`, bytes unchanged 10,022,694. The file is identical except for content-hashed `chunk-*`/`module-loader-*` names.
