---
area: runtime-js
status: draft
title: rifty's `Buffer` base64 decoding throws `InvalidCharacterError` on `-`/`_`, where Node accepts base64url characters
created: 2026-11-25
why: Node's base64 decoder accepts the base64url alphabet; rifty's goes through `atob`, so `Buffer.from('a-b', 'base64')` and `Buffer.byteLength('-_8', 'base64')` throw
sources: [docs/backlog/epics/isolate-guest-web-api/reference/textdecoder/bundle/README.md]
code: [packages/runtime-js/src/builtins/buffer.ts]
---

## Context

Found by `reference/textdecoder/bundle` (2026-11-25, Node v24.16.0, isolate guest `runCode`):
`Buffer.byteLength('-_8', 'base64')` → Node `2`, rifty `InvalidCharacterError`;
`Buffer.from('a-b', 'base64')` → Node `<Buffer 6b e6>` (`6be6`), rifty `InvalidCharacterError`.
@exodus/bytes stops on it in the guest (the probe hid `globalThis.Buffer` from it). Measured in
the isolate only; `buffer.ts` is shared by every host (source). Owner runtime-js `Buffer`; no compat
row yet. Trigger: a package decoding base64url through `Buffer` with `'base64'`.

## Challenge

challenge: 2026-11-25 — not run (factual capture)
