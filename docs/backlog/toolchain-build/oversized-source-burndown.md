---
area: toolchain-build
status: draft
title: Burn down the 48 oversized source files pinned by check:file-size
created: 2026-08-09
why: 48 prod files exceed 800 lines; the largest alone consumed 12.5% of every source-read token in a measured agent session
user_story: As an agent changing npm-client, kernel, or runtime-js, I want the file I need to arrive in one read, but today `installer.ts` is 3066 lines so each question about it costs another sliding line-number window.
sources: [context audit of codex sessions 019fafee / 019fb000, AGENTS.md §Architecture]
---
## Context
`pnpm check:file-size` (landed with this item) refuses NEW prod files over 800
lines and pins the 48 existing ones at their current size, ratcheting downward
only. The pin is the debt; this item is its burn-down.

Measured on two full agent sessions over this repo (2026-07-29 → 08-04): reads of
a file already present in the context window are 42-45% of all reads, and the
line multiplier is 1.04-1.11 — the agent is not re-reading the same lines, it is
walking a large file in overlapping windows because line numbers are the only
addressing available. `installer.ts` took 213 reads = 12.5% of all source-read
tokens; the top ten files = 38%. Truncated reads compound it: a cut read is
re-fetched over the same range in ~2 of 3 cases, so that window is paid twice.

Worst offenders (lines at pin time): `npm-client/src/installer.ts` 3066,
`shell/src/commands/git.ts` 3064, `runtime-js/src/module-loader/function-import-routing.ts`
2806, `workbench/src/workers/playground-project-authority.ts` 2697,
`kernel/src/process-manager.ts` 2392. Full list: `tools/checks/file-size.mjs`
`BASELINE`.

## Options / Next
Unresolved per file: where the honest seam is. Size is evidence of a missing
boundary, not proof of one — splitting by line count alone would ship the
speculative layering §Simplicity forbids. Each file needs its own read: what
distinct responsibility already lives inside it (`installer.ts` — acquisition
vs. link vs. shadow substitution vs. stamp writing, on current evidence), and
whether the seam is already named by an existing owner or ADR.

Next: take the top files one at a time, in the branch that already touches them
— a split rides with a delivery, never its own PR (§PR). Each split lowers or
deletes its `BASELINE` entry in the same PR; the gate refuses a silent regrow.
No repo-wide sweep: an unmotivated split is worse than a long file.

## Reversibility
REVERSIBLE per file while the move stays inside a package and `src/index.ts`
keeps its shape. A split that changes cross-package public API or introduces a
new coordination mechanism is IRREVERSIBLE → ADR + `§Class-kill` sweep first.
