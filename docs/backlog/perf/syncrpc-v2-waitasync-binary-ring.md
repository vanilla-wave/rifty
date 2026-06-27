---
area: perf
subsystem: kernel
status: draft
title: ADR-0087 — Dispatcher Atomics.waitAsync responder + SAB ring capacity + SyncRpc v2 binary frame (consolidates #17/#18/#19/#23)
created: 2026-06-08
why: single biggest blast radius — versioned SAB+SyncRpc wire across kernel<->runtime-js, 6 files, proto 1->2; dispatcher busy-polls setInterval(1ms) adding ~2-4ms/syscall; write-before-code
user_story: As a dev whose code makes many sync syscalls (`fs.readFileSync`, `execSync`), I want each to return in microseconds without busy-poll lag, but today the dispatcher `setInterval(1ms)` polls adds ~2-4ms/syscall and `Atomics.waitAsync` + zero-copy ring + the v2 binary frame are unbuilt.
sources: [perf-audit #17/#18/#19/#23, adr-plan A/ADR-0087, ADR-0011, ADR-0032 (cite, not supersede), A-021]
---
## Context
One coherent versioned-wire/dispatcher decision over sync-rpc.ts, sab-ring.ts, sync-dispatch.ts, spawn-worker.ts, worker-entry.ts, runtime-js handlers.ts. Governs SabRing payload return contract, SYNC_RPC_PROTOCOL_VERSION, SpawnWorkerSpec/WorkerSpawnSpec.payloadCapacity, SyncRpcDispatcherOptions.pollIntervalMs. rule1 (+rule4). Dispatcher waitAsync is also the prerequisite for moving fs/net onto the ring (A-021).
## Options / Next
Subsections the ADR records:
- #17 waitAsync: arm on REQ_STATE/STATE_IDLE; pump+re-arm on settle; cancel-on-detach; 50-100ms backstop + feature-detect fallback; `pollIntervalMs` redefined backstop-only (contract-meaning change → rule1). Notify already fired at sab-ring.ts:212.
- #18 zero-copy: readRequest/consumeReply return a SAB view not a fresh copy; success path decode-then-flip-IDLE; error/version-mismatch keeps flip-then-throw (ADR-0032 wedge guard); record aliasing constraint (consumer decodes sync before slot reuse).
- #19 capacity: thread optional payloadCapacity through both spec types; lower DEFAULT_PAYLOAD_CAPACITY (1 MiB→e.g. 64 KiB) ONLY after an execSync escalation path (larger ring / MessageChannel chunking); both peers agree. stdout/stderr already bypass ring via MessageChannels — execSync stdout is the ONLY large ring consumer.
- #23 binary frame: 1-byte JSON/BINARY discriminator; bump SYNC_RPC_PROTOCOL_VERSION 1→2 (executes ADR-0032's pre-authorized forward mechanism); execSync returns raw Uint8Array. Primary justification = non-UTF-8 child-stdout parity correctness fix (current TextDecoder mangles to U+FFFD). Add non-UTF-8 execSync parity case.
Order inside ADR: #18 zero-copy + #17 waitAsync independent, land first; #23 v2 + #19 capacity ship together (two-peer recompile-at-once).
## Reversibility
IRREVERSIBLE — rule1 (versioned wire / public spawn shapes) + rule4. Cites ADR-0011 (silent on ring size/schedule/copy) + ADR-0032 (version mechanism); v2 bump is the pre-authorized path. No decision subagent.
