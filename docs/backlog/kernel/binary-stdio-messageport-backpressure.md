---
area: kernel
status: active
title: Binary stdio over MessagePort with backpressure (replace JSON-over-UTF-8 framing)
created: 2026-06-08
why: only JSON sync-RPC framing landed; raw-byte inter-process stdio with backpressure left as a separate pass, no closing ADR
user_story: As a dev piping a fast producer into a slow child (`a | b`, `child.stdin.write(bigBuffer)`), I want byte-stream stdio honouring Writable `drain`, but today child stdio is JSON-framed over the `MessagePort` with no flow control so a fast producer unbounded-buffers.
sources: [A-021, ADR-0011, TASKS M6]
---
## Context
ADR-0011 phase 3 implemented JSON-over-UTF-8 framing for sync RPC (sync-rpc.ts / sync-client.ts / sync-dispatch.ts). The inter-process pipe bus is JSON, not raw bytes. M6 open acceptance "Pipe stdio over MessagePort with backpressure" is the same gap: child stdio is currently posted as framed messages, not byte-streamed with flow control. A-021 phase 2 (binary stdio with backpressure) was explicitly deferred to a separate pass and never closed by a later ADR.
## Options / Next
Replace JSON framing on the stdio path with raw-byte chunks streamed over the per-process stdio `MessagePort`s (allocated by `kernel.spawnWorker`), honouring Writable backpressure / drain so a fast producer can't unbounded-buffer a slow child. Distinct from the SyncRpc sync-call wire (that stays). Coordinate with the perf-area SyncRpc-v2 binary-frame work to avoid double-churning the wire.
## Reversibility
REVERSIBLE in shape but touches the kernel↔runtime-js stdio contract; if it widens a public IPC method it tips IRREVERSIBLE → own ADR. Verify against the perf SyncRpc-v2 binary-frame item before designing the frame.
