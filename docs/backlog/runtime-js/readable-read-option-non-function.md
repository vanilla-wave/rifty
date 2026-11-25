---
area: runtime-js
status: draft
title: A non-function `read` option replaces Readable's `_read` instead of being ignored
created: 2026-11-24
epic: node-streams-as-in-node
why: Node installs the `read` option only when it is a function, so `new Readable({ read: 5 })` emits `ERR_METHOD_NOT_IMPLEMENTED`; rifty installs any defined value and fails with `TypeError: this._read is not a function`.
sources: ["PR #433 review round 1", docs/public/compat/streams.md]
code: [packages/io/src/streams/callable-constructor.ts]
---

## Context

Found by the external review of PR #433, reproduced 2026-11-24 (Node v24.16.0 vs rifty parity
runner): `new Readable({ read: 5 })` + `on('error')` + `on('data')` → Node `error
ERR_METHOD_NOT_IMPLEMENTED`; rifty an `'error'` without `code` (`TypeError`). Present before
PR #433. Code: `initializeReadable` checks `options.read !== undefined`; the Writable/Duplex/Transform
hook options check `typeof … === 'function'`.

Owner: runtime-js (`@riftydev/io` Readable). Trigger: a package passing a non-function `read`
(option bags spread from config). Compat streams.md `Readable` push/data/end ⚠️ row.

## Challenge

challenge: 2026-11-24 — none (factual capture, measured vs live Node)
