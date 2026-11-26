---
area: toolchain-build
status: draft
title: Every pinned-Node-source generator runs on the shared steps and keeps Node's function names
created: 2026-11-26
why: generate-node-encoding.mjs repeats the steps node-sources.mjs holds for url-legacy, node-blob and node-streams, and node-blob's esbuild minifySyntax drops a named function expression's name
sources: [tools/publishing/node-sources.mjs, tools/publishing/generate-node-blob.mjs, tools/publishing/generate-node-encoding.mjs]
code: [tools/publishing/generate-node-encoding.mjs, tools/publishing/generate-node-blob.mjs]
---

## Context

PR #471 (stream core 8a) moved the pinned-source steps (CLI mode, sha256-pinned vendored reads,
upstream load checks, Node's LICENSE part, `--write`/`--check`) into `tools/publishing/node-sources.mjs`;
url-legacy and node-blob use it, outputs byte-identical. `generate-node-encoding.mjs` (PR #459,
merged after) has its own copies of those steps and a second upstream (@exodus/bytes).

Name loss, measured on PR #471's review: esbuild `minifySyntax` drops the name of a named function
expression (`Stream._uint8ArrayToBuffer = function _uint8ArrayToBuffer` → `""`, 9 functions in the
stream core) and its renamer renames a shadowed class (`HideStackFramesError2`); the stream core
now ships unminified. node-blob runs with `minifySyntax`: its one named function expression,
`converters.DOMString = function DOMString` (`internal/webidl.js:213`), is anonymous in
`node-blob.js` (`converters.DOMString=function(`); node-encoding has none in its vendored text;
url-legacy runs with `keepNames`. Not measured: whether a guest observes it (`webidl.converters` is
internal; a stack frame's name is).

## Challenge

challenge: 2026-11-26 — finding capture; no premise critic (README §Challenge)
