---
area: toolchain-build
status: ready
title: The TypeScript worker pin holds across runtime edits that leave its own content unchanged
created: 2026-11-24
why: since 2026-11-21 48 "re-pin typescript-worker" commits on 26 merged PRs; 11/27 main merges conflicted on the pin file (4 only there), 5 on ADR-0391; 5 CI runs red only on this gate; runtime PRs merge strictly one at a time
user_story: As a user running parallel agent PRs that touch the runtime, I want them to merge without re-pinning the TypeScript worker, but today every runtime edit changes its SHA-256 and the next merge conflicts on the pin
sources: [ADR-0391, docs/process/traps.md copied-asset-fingerprints, user «ок» 2026-11-24 (manager thread cf2ae711)]
code: [tools/checks/esbuild-legacy-retirement.mjs, tools/checks/esbuild-legacy-retirement.test.ts]
---

## Context

ADR-0391 admits `dist/assets/typescript-worker.js` (10,022,716 bytes) above the
2 MB ceiling only at exact size + SHA-256. Fact (two `pnpm build:libs` on main
841fa5300, before/after a one-char `process-umask.ts` edit): the only changed
bytes are the hashed names of sibling chunks — 5 in the leading `import`
statements, 1 in `import("./module-loader-*.js")`; size equal. History (#421
round 5, rebuilt 863dce430 vs 25ef4d63c): +30 bytes = one new leading
`import "./chunk-*.js";` line; nothing else.

## Challenge

challenge: 2026-11-24 — clear (direction is the user's explicit «ок» on the measured cost; no critic)

## User scenario

Two branches off main each edit a runtime-js source; each rebuilds and passes
`check:esbuild-legacy-retirement` with no pin edit; their merge rebuilds and
passes with no pin or ADR edit.

## Acceptance

1. Unit: a pinned worker whose leading sibling imports are renamed, added or removed and whose `import("./x-HASH.js")` hash changes stays admitted (RED on main) → scenario
2. Mutants stay red: compiler body byte changed, code injected in body or between leading imports, body grown/shrunk, free whitespace in `{…}`, unbuilt or non-`chunk-XXXXXXXX` sibling, duplicate, a binding absent from the body; `chunk-EMDIREKY.js` with a leading import → ADR-0391
3. Two local branches with runtime edits + their merge: gate green on each build, no pin/ADR diff → scenario
4. Real build mutants (compiler version string, appended code, injected header line) red on the real worker → ADR-0391

## Out of scope

Other exempt pins (`chunk-EMDIREKY.js`, QuickJS/sql-wasm, lexer literal, generated client): unchanged since introduction.

## Decisions

- Carrier: pin the worker minus its leading sibling-chunk imports, hashed sibling names normalized; no metafile/source-map analysis (ADR-0391 rejected it).
- Leading import skipped only in esbuild's exact form, for a built sibling, once, each binding once and a token of the pinned rest — bounds the header, not a linkage check; opt-in per pin (`siblingImports`).
- Price named in ADR-0391: linkage (which built siblings, which bindings) no longer pinned.
- ADR-0391 dated correction; no per-re-pin ADR line.
