---
area: playground
status: draft
title: Playground editor save of a BOM file keeps or drops the BOM by decision
created: 2026-11-17
why: the editor decodes file bytes with a BOM-stripping TextDecoder and saves the model text, so editing a BOM'd file silently removes EF BB BF
sources: [docs/backlog/runtime-js/sandbox-fs-readfile-bom.md]
code: [apps/playground/src/components/editor-host-core.ts, apps/playground/src/adapters/playground-app.tsx, apps/playground/src/adapters/playground-project-view.ts]
---

## Context

REV-12 discovery of the UTF-8 BOM decode fix (2026-11-17, sweep critic; code
read, not run in the browser). `editor-host-core.ts:78` `dec = new TextDecoder()`
builds Monaco models (:543, :570) and applies owner bytes (:1095); a save
publishes `model.getValue()` (:442) through `onFileWritten`, so a BOM'd file
loses EF BB BF on its first edit. At :1095-1096 a guest write that only adds or
removes a leading BOM compares equal to the model and is not shown; the next
save reverts it. The SCM diff view decodes the same way
(`playground-app.tsx:140` `decodeText`, `playground-project-view.ts:91`), so a
BOM-only change renders as no change; real `git diff` shows `-\357\273\277line1`
(probe recorded in `shell/git-builtin-bom-strip-decode`).
Same class as the SDK `sandbox-fs-readfile-bom` question; own product, no Node
oracle.

## Question

Keep a file's leading BOM across editor load/save (and show BOM-only diffs),
or strip it on purpose and say so? owner: user (observable editor behavior).
Repro path: write `\ufeffa` via a terminal `node -e`, open it, type, save,
`od -c` the file.
