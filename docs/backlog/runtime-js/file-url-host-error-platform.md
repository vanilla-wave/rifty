---
area: runtime-js
status: draft
title: "`fileURLToPath`'s `ERR_INVALID_FILE_URL_HOST` text names the platform as Node's does"
created: 2026-11-26
why: Node's message ends `on ${process.platform}` (`File URL host must be "localhost" or empty on darwin`); rifty's ends `on a POSIX platform`, so a program printing it differs
sources: [tests/integration/node-streams-differential/programs/f1-file-url.cjs]
code: [packages/runtime-js/src/internal/posix-file-url.ts]
---

## Context

Stream core 8a differential (PR #471, 2026-11-26, Node v24.16.0, in-process), row `f1-file-url`
`host`: `fs.createReadStream(new URL('file://host/x'))` → Node `TypeError [ERR_INVALID_FILE_URL_HOST]:
File URL host must be "localhost" or empty on darwin` (`linux` on Linux: `lib/internal/url.js`
reads `process.platform`); rifty `… or empty on a POSIX platform` (`posix-file-url.ts:84`). Node's
code over rifty's identity would print `on rifty` (`process.platform`, ADR-0026); which text is
right is this item's question, not settled here. Pinned in the differential with this item as owner.

## Challenge

challenge: 2026-11-26 — finding capture; no premise critic (README §Challenge)
