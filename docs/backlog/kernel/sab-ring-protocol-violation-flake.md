---
area: kernel
status: draft
title: SAB-ring protocol violation flake — wedged ring / empty reply under CI contention
created: 2026-07-23
why: A ring protocol violation kills the dev-server child mid-boot — `npm run vite` / `node server.js` die with a cryptic error and the preview never comes up. The violator is invisible: both observed errors are secondary symptoms.
sources: [CI run 30017630339 light-lane log (2026-07-23), dedup sweep 2026-07-23 — no existing backlog item covers the SAB ring]
code: [packages/kernel/src/ipc/sab-ring.ts, packages/kernel/src/ipc/sync-client.ts, packages/kernel/src/ipc/sync-dispatch.ts]
---

## Context

Two CI-only signatures, both on the dev-server-child→owner ring during boot under runner contention, both in one light-lane run (2026-07-23, each passed on retry):

- `m1-terminal-shell.spec.ts:237` — child stderr: `Uncaught Error: SabRing: cannot writeRequest while a previous reply is unread` (escaped via EventEmitter `'error'` rethrow → worker died). Wedged-ring symptom: a PREVIOUS exchange left the reply slot occupied; every later call fails.
- `node-command.spec.ts:127` — `failed to load config from /vite.config.js … TypeError: decodeReply: unknown frame discriminator 0x-1` at `ProjectTerminalFsSync.read` (vite config load). `0x-1` = zero-length reply frame = double-consume signature (second consumer read the slot after REP_LEN was cleared).

Fault class: `concurrent-same-key` at the SAB sync-RPC ring boundary (row added to `fault-classes.md` §Boundary failure models 2026-07-23). Both symptoms require a second consumer/writer on a single-caller ring — which the static model says cannot exist.

Static sweep EXCLUDED (2026-07-23): timeouts on the kernel sync path (client blocks indefinitely; no `defaultTimeoutMs` configured anywhere); `waitReplyAsync` in production callers (none); ring forwarding to nested workers (every `spawnKernelWorker` allocates a fresh ring; `syncRing` never re-shipped); out-of-band `readRequest`/`consumeReply` callers (none outside client/dispatcher); WASI pthread ring sharing (each pthread realm attaches its own ring).

Repro attempts: 30 local runs of both specs green (serial); 5-spec × workers=8 contention run reproduces only the separate `pickStarter` cold-boot click-timeout family, not these.

Forensics landed separately (same PR as this item): header snapshots in every SabRing throw, method + previous-call context in `SyncRpcClient.call` errors, loud `console.error` on dispatcher reply drops. Next CI occurrence names the violating method pair and header state.

Path to ready: (1) harvest the next CI occurrence's forensics → pinpoint the violator; (2) class-kill, not a point fix — candidate: single-owner assertion per ring (caller realm identity checked on every op) or a protocol caller-id slot (needs SYNC_RPC_PROTOCOL_VERSION bump, ADR). Mechanism inventory for §Class-kill: ring guards (write-time state checks) and dispatcher `inFlight` set already guard this key — an ownership assertion must fold into the ring itself, not arrive as mechanism #3 alongside them.
