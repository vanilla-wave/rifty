---
area: perf
subsystem: kernel
status: draft
title: SyncRpc binary REQUEST frame — residual of ADR-0084 (waitAsync/zero-copy/binary reply delivered)
created: 2026-06-08
epic: child-fs-rpc-hot-path
why: requests (and small replies) still JSON-frame every hop — measured 3.1 µs of an 18 µs fs hop; the reply-side binary frame exists (FRAME_BINARY, proto v3) but the request side does not
user_story: As a dev whose child makes tens of thousands of sync fs syscalls per build, I want hot-path requests to cross the ring without JSON encode/decode, but today every request is FRAME_JSON — pure CPU framing cost on every hop.
sources: [ADR-0084, ADR-0032, spike branch t3code/prototype-no-coi-agent-cycle prototype/no-coi-agent-loop/FINDINGS.md §2b]
code: [packages/kernel/src/ipc/sync-rpc.ts, packages/runtime-js/src/ipc/fs-rpc-protocol.ts]
---

## Context

Re-cut 2026-08-26. Delivered by ADR-0084 (do not restate as open): #17
`Atomics.waitAsync` responder (measured hop 8.2 µs — the old «setInterval(1ms)
polls add ~2–4 ms/syscall» claim is RETIRED, that fix landed), #18 zero-copy
view, #19 capacity, binary REPLY frame (`FRAME_BINARY`,
`SYNC_RPC_PROTOCOL_VERSION` = 3, readChunk bodies ride it).

Residual: REQUEST side (and small replies, e.g. stat shapes) are JSON-framed.
Direct measurement (FINDINGS §2b): JSON framing = 3.1 µs of an 18 µs fs hop
(~17%). base64 write-request inflation (fs-rpc-chunk-perf option) is the same
request-frame residual.

## Options or Next

- Binary request frame behind the existing 1-byte discriminator; version bump
  via ADR-0084's pre-authorized mechanism; both peers recompile atomically.
- Small structured replies (stat) may ride a compact binary shape — measure
  first via `perf/child-fs-perf-lane`.

## Reversibility

IRREVERSIBLE — versioned wire (rule1); ADR at pickup, cites ADR-0084/0032.
