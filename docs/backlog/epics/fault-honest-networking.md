---
kind: epic
status: draft
title: Fault-honest networking — every path bounded, a hang is a bug
created: 2026-07-05
value: No network failure mode (stall, slow body, dead server, malformed response) can park install, preview, or dev-server flows — every path is bounded and degrades to a fallback or a loud error.
user_story: As a developer, I want npm install and preview to survive a hung registry/proxy/route with a visible fallback or error, but today standard-path registry fetches are unbounded and a preview dispatch hang (missing allowedHosts) is reproducible but untraced.
items: []
---

## Outcome

eddy's fast path needed 5 review rounds (#107 R5→R17) to bound every read — the unbounded-read axis died only when `drainBodyBounded` became the single chokepoint. The standard install path and SW preview routing carry the same axis unswept (`docs/process/fault-classes.md`).

## Candidate boundaries (items carved at refine)

- npm-client standard registry fetches (packument/tarball) — no progress bound; recorded on the #107 branch as `npm-client/registry-fetch-no-progress-bound` (lands with that PR)
- SW preview dispatch: reproducible hang without `allowedHosts` (preset-deglue residue) — diagnose to root cause first (`rifty-fix`), then fault rows
- owner⇄worker RPC / WS bridge timeouts

## Items

(to be carved by `rifty-refine`)
