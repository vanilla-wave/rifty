---
area: runtime-js
status: draft
title: spawn('node') consumes -e as a script path in both tiers; missing-script failure leaks raw VfsError
created: 2026-08-28
why: two defects on one probe — spawn-routed `-e`/`--eval` never reaches the existing eval runner (args[0] treated as filename in BOTH tiers), and the same-realm path surfaces a raw internal `VfsError` stack for ANY missing script path (not just flags) instead of Node's error shape
user_story: As a dev whose script does `spawn('node', ['-e', '…'])`, I want the eval to run (or a Node-shaped failure), but today rifty resolves `-e` as a file and the fallback leaks an internal error class
sources: [docs/backlog/runtime-js/reference/no-coi-degradation-probes.md, docs/backlog/runtime-js/node-cli-esm-eval-context.md]
code: [packages/runtime-js/src/builtins/child_process-exec.ts, packages/runtime-js/src/builtins/child_process.ts]
---

## Context

Probe (reference table): `spawn('node',['-e','console.log(1+1)'])`:

| lane | exit | stderr |
|---|---|---|
| same-realm fallback (`execScript`, args[0] = script path) | 1 | internal `VfsError: ENOENT: /proj/-e` |
| product COI (kernel route) | 1 | `Cannot find module '/-e'` |

Scope notes:
- A CJS eval runner already exists for the top-level CLI (`node-entry.ts` `kind:'eval'`; workbench
  `node-entry-resolve.ts` parses `-e/--eval` — M11). The gap is spawn-route wiring, not a new
  capability; a both-tier fix touches `child_process.ts`/node-entry plan building, not only
  `child_process-exec.ts`.
- The error-shape leak is GENERAL, not `-e`-specific: `execScript` reads `args[0]` and its catch
  writes the raw `err.stack` for any missing script (`spawn('node',['nope.js'])` leaks the same
  `VfsError`). Node parity case: `Cannot find module` shape + exit 1.
- Sibling scope: `node-cli-esm-eval-context` owns workbench ESM eval-context forms; `node-cli-*`
  family owns top-level CLI eval contexts. THIS item is the child_process spawn path only.

## Challenge

challenge: 2026-08-28 — 4 problems
- Both-tier claim vs scoped work: `code:` names only `packages/runtime-js/src/builtins/child_process-exec.ts` (same-realm fallback), but the product-COI route the doc also indicts flows through `child_process.ts` → `buildChildExecutionPlan` (`src/internal/node-entry-path.ts`) — as scoped the work cannot deliver the "both tiers" fix.
- Cheaper route unnamed: CJS `-e` eval identity already ships for the top-level CLI (ROADMAP M11 lines 92–94; `node-entry.ts` `kind:'eval'` runner; workbench `node-entry-resolve.ts` parses `-e/--eval`), so the doc's framing of CJS `-e` as an open "capability decision" hides that the work is wiring spawn to an existing runner, not a new parity call.
- Impact unsized against the whole: sole evidence is the spike's deliberate break-it probe (FINDINGS.md §5c "Trying to BREAK it"), which itself ranks a different probe ("SILENT WRONG — the real killer", already owned by `same-realm-spawn-stdio-pipe-drop.md`) as the material gap; no real workload or npm package issuing `spawn('node',['-e',…])` is cited in the doc.
- Leak defect under-scoped by the eval framing: the VfsError leak fires for ANY missing script path (`child_process-exec.ts` line 134 `args[0]` → line 143 `readFileBytesSync` → catch 513–517 writes raw `err.stack`), e.g. `spawn('node',['nope.js'])`; no other backlog item owns that general shape, yet this item's title/user_story tie it to `-e`, inviting a fix that Node-shapes only the flag case.

(Post-challenge edit: title/why/code/scope notes were broadened per problems 1, 2 and 4;
problem 3 stands — no real-workload evidence cited.)
