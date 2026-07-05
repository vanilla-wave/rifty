---
kind: epic
status: draft
title: Fault-honest npm install — standard path bounded, install-state caches honest
created: 2026-07-05
value: npm install survives a hung/dead registry, proxy, or corrupt local install-state with a visible error or fallback — never an indefinite park or a silent lie about what was installed.
user_story: As a developer, I want `npm install` on the STANDARD path to be as fault-honest as #107 made the eddy fast path, but today standard registry fetches (packument/tarball) have no progress bound, and playground install-state files (learned pins) have no corrupt-input/TTL fault rows.
items: []
---

## Outcome

eddy's fast path needed 5 review rounds (#107 R5→R17) to bound every read — the unbounded-read axis died only when `drainBodyBounded` became the single chokepoint. The standard install path carries the same axis unswept; the eddy client-side caches got fault tests, the surrounding install-state didn't (`docs/process/fault-classes.md`). Scope = npm-client + playground npm-shell install layer.

## Candidate boundaries (items carved at refine)

- standard registry fetches (packument/tarball) — no progress bound; recorded on the #107 branch as `npm-client/registry-fetch-no-progress-bound` (lands with that PR; becomes a child here)
- tarball cache gaps not covered by #107 fault tests — tag into the fault tier, fill
- learned pins (`/.rifty/eddy-learned-pins.json`): corrupt/oversized file, TTL/cap races

## Items

(to be carved by `rifty-refine`)
