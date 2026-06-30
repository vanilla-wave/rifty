---
area: shell
status: ready
title: Command-suggestion denylist — stop the confidently-wrong one-click `Run <x>`
created: 2026-06-30
why: the not-found suggester is pure edit-distance with no semantic guard, so `npx`→`npm`, `cut`→`cat`, `sed`→`seq`, `tree`→`true`, `code`→`node`, `pnpm`→`npm`, `cls`→`ls` each become a clickable one-click trap that does something unrelated; meanwhile `yarn`/`pnpm`/`bun` get no hint at all.
user_story: As a dev who typed `npx` or `pnpm`, I want a useful nudge (or nothing), but today I get a clickable `Run npm` that runs the wrong tool — a confusing second failure.
epic: frictionless-first-poke
blocked_by: []
sources: [docs/backlog/epics/frictionless-first-poke.md]
code: [packages/shell/src/shell.ts, apps/playground/src/glue/terminal-quick-fix.ts]
---

## Context

`suggestCommand` (`shell.ts:219-234`) is pure Damerau distance with a small threshold and no semantic guard; on a miss the shell emits `Did you mean '<x>'?` (`shell.ts:568-569`) which `terminal-quick-fix.ts:19-27` turns into a clickable `Run <x>`. Verified wrong mappings: `npx→npm`, `cut→cat`, `sed→seq`, `tree→true`, `code→node`, `pnpm→npm`, `cls→ls`. Separately, `yarn/pnpm/bun` are distance > 2 from `npm` → no hint, a bare dead-end.

## Acceptance

- A denylist of known external tools suppresses the fuzzy builtin suggestion for: `npx`, `yarn`, `pnpm`, `bun`, `sed`, `awk`, `cut`, `tree`, `code`, `vim`, `nano`, `python`, `cls`, `curl`, `wget` — none of these ever produces a clickable `Run <builtin>`.
- For a recognized package manager (`yarn`/`pnpm`/`bun`/`npx`) the not-found line is instead a directed nudge: `<tool>: not available — rifty wires npm (try: npm install …)`.
- A genuine typo of a real builtin within the existing threshold (`gerp`→`grep`, `sl`→`ls`) still gets the clickable suggestion.
- `terminal-quick-fix` renders the clickable `Run` ONLY for an in-registry builtin suggestion, never for a denylisted external token.

## Parity cases

None — suggestion UX, no Node/bash behavior. Verification = unit tests: each denylisted token yields NO `Run <builtin>` button (and package managers yield the npm nudge); `gerp` still suggests `grep`.

## Out of scope

- Actually implementing `yarn/pnpm/bun/curl/sed/awk` (separate items or honest ceilings); `npx` execution (separate `npx` item) — this only fixes the misdirection.

## Decisions

- A static denylist of known confusions over a fuzzier semantic model — cheapest correct fix; the harm being removed is a confidently-wrong one-click action.
- REVERSIBLE (shell + terminal UX, no public API) → CHANGELOG in packages/shell (+ apps/playground); no ADR.
