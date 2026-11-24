---
area: runtime-js
status: draft
title: process.umask is missing instead of a loud NotImplementedError or a real value
created: 2026-11-24
why: Node has `process.umask()`; rifty omits it, so packages that read it at load (fstream) fail `TypeError: process.umask is not a function` instead of a named gap.
sources: [docs/backlog/distribution/reference/isolate-library-probe/README.md, docs/public/compat/process.md]
code: [packages/runtime-js/src/builtins/process.ts, packages/runtime-js/src/builtins/loud-members.ts]
---

## Context

Probe 2026-11-24 (`isolate-library-probe/gen/diag.cjs`, isolate-host sandbox vs Node v24.16.0):
`require('fstream')` → Node ok, rifty `TypeError: process.umask is not a function` at
`fstream/lib/writer.js:8` (`process.platform === 'win32' ? 0 : process.umask()`, module top level).
fstream comes from unzipper, which exceljs 4.4.0's main entry loads
(`lib/exceljs.nodejs.js:7` → `stream/xlsx/workbook-reader.js:5`) — today behind the declared
`node:zlib` ❌ on the same chain, so it is the next stop once zlib exists. compat process.md names
`umask` only as an ESM link-time miss (row "`node:process` named imports"); no row for the call.
Open, as for `process.abort` (`runtime-js/process-abort-missing`): a loud
`NotImplementedError('process.umask')` member, or a real value that agrees with the FS's fixed
modes (`runtime-js/fs-default-file-modes` names the same fork).

Owner: runtime-js (process shim). Trigger: the library-compat work (ROADMAP M14 E,
requirements §6,
exceljs main entry after zlib), or any package reading `umask` at load.

## Challenge

challenge: 2026-11-24 — none (factual capture, library probe)
