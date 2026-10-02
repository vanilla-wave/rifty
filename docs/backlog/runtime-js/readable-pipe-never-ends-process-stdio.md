---
area: runtime-js
status: ready
title: `Readable.pipe(process.stdout|stderr)` never calls `dest.end()` (Node exemption)
created: 2026-09-15
why: `io/streams/readable.ts` pipe calls `dest.end()` on source end for every destination; piping into the guest `process.stdout` throws `TypeError: dest.end is not a function` (vitest's programmatic run, evidence §I2) — Node exempts process.stdout/stderr from pipe-end
user_story: As a real CLI running in the browser shell, I want `childStdout.pipe(process.stdout)` to behave like on my machine, but today the pipe crashes with `dest.end is not a function` at the source's end
epic: vitest-run-in-browser
sources: [docs/backlog/runtime-js/reference/vitest-run-in-browser-evidence.md]
code: [packages/io/src/streams/readable.ts, packages/runtime-js/src/builtins/process.ts]
ready-verdict: 2026-10-02 — Contract+RED @ <pending>
---

## User scenario

Goal I4 (programmatic run): vitest's own pipeline pipes a child/worker stdout
Readable into `process.stdout`; on main 51440931a the run dies at the source's
end with `Uncaught TypeError: dest.end is not a function`
(`io/streams/readable.ts` pipe `onEnd`) and exit 1 (evidence §I2; Node oracle
`pipe.cjs`: `a / still-writable / end-fn function`).

## Context

Node's `Readable.prototype.pipe` skips the end call when the destination is
`process.stdout`/`process.stderr` (the stdio streams are never ended by a
pipe — the process owns their lifetime). `readable.ts` `pipe(dest, opts)`
attaches `onEnd` unconditionally (guarded only by `opts.end !== false`).

## Acceptance

1. `Readable.from(['a\n']).pipe(process.stdout)` inside a physical node-entry
   eval completes: stdout carries `a` and an `after-pipe` marker, exit 0 — no
   `dest.end is not a function` (`→ I4`).
2. The same holds for `pipe(process.stderr)` by the same exemption (unit
   fault test — stderr has no byte-identical Node oracle in the harness)
   (`→ I4`).
3. `opts.end === false` keeps skipping the end call for ordinary destinations,
   and ordinary destinations still get `end()` on source end (baseline;
   existing `pipe-unpipe`/backpressure parity cases keep passing) (`→ baseline`).

## Parity cases

Real Node v24.16.0 `-e` oracle (evidence §Oracle `pipe.cjs`): pipe into
process.stdout delivers bytes, leaves stdout writable, `typeof end === 'function'`.
RED target: `stream/node-eval-pipe-into-process-stdout.case.ts` (physical
eval — the in-process runner would see the real Node stdout and pass
trivially). Fails today with the `TypeError` and exit 1.

## Out of scope

- `process.stdout.end` / `writableEnded` / `destroyed` surface on the guest
  stdio writer — not on the claimed path (the exemption means pipe never
  touches them); separate process-identity surface item.
- `pipeline()`/`unpipe` semantics — separate cases exist.

## Fault matrix

| Axis | Operation | Outcome |
|---|---|---|
| ordinary dest | `src.pipe(dest)`; source ends | `dest.end()` called (baseline, unchanged) |
| stdio dest | `src.pipe(process.stdout|stderr)`; source ends | no end call; pipe cleanup still runs (no leak: listeners detached) |

## Decisions

- ready-verdict: 2026-10-02 — Contract+RED @ <pending>
- 2026-10-02 — agent (PICKUP): carrier = the Node exemption inside
  `readable.ts` `pipe()`. The io layer cannot import the process builtin
  (layering, `check:arch`), so the stdio destination is recognized by the
  same duck-type Node's own pipe uses (fd 1/2 writer shape), not by identity
  import. Cleanup listeners still detach — no listener leak on the exemption
  path.