---
area: distribution
status: draft
title: The isolate guest's `TextEncoder.prototype.encodeInto` accepts a non-`Uint8Array` destination and a non-string source where Node throws `ERR_INVALID_ARG_TYPE`
created: 2026-11-25
why: the guest's own `TextEncoder` (`text-codec.ts`) returns `{read: 1, written: 1}` for `encodeInto(1, {})`-style calls; Node v24.16.0 throws `TypeError [ERR_INVALID_ARG_TYPE]` — a silent different result
sources: [docs/backlog/epics/isolate-guest-web-api/reference/textdecoder/README.md]
code: [packages/isolate-guest/src/guest/text-codec.ts]
---

## Context

Probe `isolate-guest-web-api/reference/textdecoder` (2026-11-25, Node v24.16.0): 2 of 11
`TextEncoder` cases differ — `encodeInto` with a destination that is not a `Uint8Array` and with a
source that is not a string: Node `TypeError ERR_INVALID_ARG_TYPE`, guest `{"read":1,"written":1}`
(`results.txt` line «TextEncoder guest vs node»). Isolate guest only (browser hosts have the native
class). No compat row yet. Owner: isolate-guest; natural carrier: the `TextDecoder` unit of goal
`isolate-guest-web-api` (`distribution/isolate-guest-textdecoder-legacy-encodings`), which ports
Node's `encoding.js` — its `TextEncoder` too.

## Challenge

challenge: 2026-11-25 — not run (factual capture)
