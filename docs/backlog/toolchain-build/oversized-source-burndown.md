---
area: toolchain-build
status: draft
title: Burn down the remaining oversized source files pinned by check:file-size
created: 2026-08-09
why: 48 prod files exceed 800 lines; only the worst one has a settled decomposition contract so far
user_story: As an agent changing kernel, runtime-js, shell, or workbench, I want the file I need to arrive in one read, but today seven of them exceed 2000 lines so each question about them costs another sliding window.
sources: [context audit of codex sessions 019fafee / 019fb000, AGENTS.md §Architecture]
---
## Context
`pnpm check:file-size` refuses NEW prod files over 800 lines and pins the 48
existing ones at their size, ratcheting downward only. The pin is the debt; this
item tracks the part of it that has no contract yet.

Measured on two full agent sessions (2026-07-29 → 08-04): reads of a file already
present in the context window are 42-45% of all reads, with a line multiplier of
1.04-1.11 — the agent is not re-reading the same lines, it is walking a large
file in overlapping windows because line numbers are the only addressing
available. The top ten files took 38% of all source-read tokens. Delivered tool
output is capped at ~10 000 tokens no matter what the caller requests, so any
file over roughly 1100 lines can never arrive whole.

Worst remaining (lines at pin time): `shell/src/commands/git.ts` 3064,
`runtime-js/src/module-loader/function-import-routing.ts` 2806,
`workbench/src/workers/playground-project-authority.ts` 2697,
`kernel/src/process-manager.ts` 2392, `tools/node-parity-runner/src/run-in-rifty.ts`
2069, `runtime-js/src/builtins/vm/membrane.ts` 2058,
`runtime-js/src/module-loader/cjs.ts` 2052. Full list: `tools/checks/file-size.mjs`
`BASELINE`.

The largest file is already cut: `npm-client/installer-decomposition.md` (ready)
decomposes `installer.ts` and is the worked example for the shape a unit here
takes — evidenced seams, move-only diff, unedited suites, ADR boundary lists
re-pointed, `BASELINE` entry deleted.

## Options / Next
Unresolved per file: where the honest seam runs. Size is evidence of a missing
boundary, not proof of where it lies — splitting by line count alone would ship
the speculative layering §Simplicity forbids. Each file needs its own read of
what distinct responsibility already lives inside it and whether an existing
owner or ADR already names the destination, exactly as §Context of the installer
item records.

Next: cut one ready item per file, worst first, each in the branch that already
touches it — a split rides with a delivery, never its own PR (§PR). No repo-wide
sweep: an unmotivated split is worse than a long file.

Ratchet slip: PR #249 (d34577d54) grew `vfs/src/opfs-sync.ts` 1159→1215 past its
pin unnoticed — CI runs no `check:file-size`, only local `pr:check` does, so the
gate went red repo-wide until re-pinned at 1215 (PR #250). Debt stands: the
watchdog rework is the growth; its seam analysis belongs to this item. A
CI-side file-size lane would close the class.

Recurrence: PR #270 (`9c6ad401f`) added six finding/TODO comment lines to
`kernel/src/process-manager.ts` without moving its 2392 pin; post-merge main was
2398 and `pnpm check:file-size` failed before unrelated npm-client source.
Baseline re-pinned to the already-landed size; the file may only shrink again.

## Reversibility
REVERSIBLE per file while the move stays inside a package and `src/index.ts`
keeps its shape. A split that changes cross-package public API or introduces a
new coordination mechanism is IRREVERSIBLE → ADR + `§Class-kill` sweep first.
