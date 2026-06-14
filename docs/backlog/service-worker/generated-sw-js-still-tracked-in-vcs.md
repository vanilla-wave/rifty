---
area: service-worker
status: active
title: Generated apps/playground/public/sw.js committed + not gitignored — drift surface ADR-0016 was meant to eliminate
created: 2026-06-13
why: apps/playground/public/sw.js is a build output of sw-plugin.ts yet is git-tracked and not gitignored, so two sources of truth for SW logic coexist (sw.ts + the committed 27KB bundle) — the precise condition ADR-0016/A-017 closed, and two of ADR-0016's acceptance criteria (de-VCS sw.js + add to .gitignore) are unmet.
user_story: As a rifty contributor editing `sw.ts`, I want my service-worker change to be the single source of truth, but today the generated `apps/playground/public/sw.js` stays git-tracked and un-gitignored so editing `sw.ts` without re-bundling commits a stale 27KB blob and invites merge conflicts.
sources: [ADR-0016]
code: [apps/playground/public/sw.js, apps/playground/build/sw-plugin.ts, docs/backlog/playground/sw-plugin-gitignored.md]
---

## Context

git check-ignore apps/playground/public/sw.js -> NOT IGNORED; git ls-files lists it as tracked; .gitignore has no entry; sw-plugin.ts:59 writes the same path on every buildStart/dev change, so any sw.ts edit without a bundler run produces a stale committed sw.js and merge conflicts on a 27KB generated blob are likely. ADR-0016 Decision says 'Remove apps/playground/public/sw.js from VCS; add to .gitignore' and acceptance '[ ] apps/playground/public/sw.js is in .gitignore' — unmet. NOTE: the existing item sw-plugin-gitignored.md records this diverging reality as CONTEXT ('sw.js is git-tracked + biome-ignored') but its actual scoped fix is the inverse problem (the plugin source being swallowed by .gitignore build/), not de-VCSing sw.js — so the ADR-0016 de-VCS acceptance is not actually owned by any item.

## Options or Next

Either fold this into sw-plugin-gitignored.md as an explicit second action, or track here: git rm --cached apps/playground/public/sw.js, add it to .gitignore, and verify a clean clone -> install -> build regenerates it and typecheck/CI stays green (interacts with the plugin-swallowed fix, so sequence both together). Closes ADR-0016 acceptance criteria #3/#4.

## Reversibility

REVERSIBLE — backlog item; .gitignore entry + git rm --cached, no public-API change. Sequence with the plugin-source-swallowed fix in sw-plugin-gitignored.md.
