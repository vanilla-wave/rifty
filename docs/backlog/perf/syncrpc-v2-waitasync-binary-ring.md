---
area: perf
subsystem: kernel
status: ready
title: SyncRpc v5 binary requests for the five hot owner-fs read/probe methods
created: 2026-06-08
epic: child-fs-rpc-hot-path
why: hot owner-fs requests still JSON-frame every hop — measured 3.1 µs of an 18 µs fs hop; binary replies and one-hop read heads now exist on protocol v4, but request bodies remain JSON-only
user_story: As a dev whose child makes tens of thousands of sync fs syscalls per build, I want hot-path requests to cross the ring without JSON encode/decode, but today every request is FRAME_JSON — pure CPU framing cost on every hop.
sources: [ADR-0084, ADR-0032, spike branch t3code/prototype-no-coi-agent-cycle prototype/no-coi-agent-loop/FINDINGS.md §2b]
code: [packages/kernel/src/ipc/sync-rpc.ts, packages/kernel/src/ipc/sync-client.ts, packages/kernel/src/ipc/sync-dispatch.ts, packages/kernel/src/shared-globals.ts, packages/kernel/src/worker-entry.ts, packages/runtime-js/src/ipc/fs-rpc-protocol.ts, packages/runtime-js/src/ipc/fs-handlers.ts, packages/runtime-js/src/ipc/sync-rpc-fs.ts, packages/ts-language-service/src/worker/host-fs-rpc.ts, tools/perf/src/child-fs-orchestrator.test.ts]
---

## User scenario

Run the canonical 2180-module Vite build and Express cold start in the COI
playground's supervised kernel child after ADR-0365. Its source/package walk
now performs one round-trip per small `readFileSync`, but `existsSync`,
`statSync`, `statSyncOrNull`, `readFileHead`, and every `readChunk` still build
and parse JSON request frames. The in-realm comparison performs none of that
transport work.

## Reference contract

Measured framing evidence is preserved on the spike branch:

```sh
git show t3code/prototype-no-coi-agent-cycle:prototype/no-coi-agent-loop/FINDINGS.md
# §2b: real encodeRequest/decodeRequest/encodeReply/decodeReply = 3.1 µs;
# Atomics.waitAsync hop = 8.2 µs; complete fs hop ≈18 µs.
```

Current pre-I2 real rig (`perf/child-fs-after-single-hop.json`, Chromium
148.0.7778.96, implementation `f72ec428a3a646df3804bfabedd02f1564051739`):

```text
product: 2180 modules, Vite 6.08 s, Express 264.69499999284744 ms
in-realm: 2180 modules, Vite 1.22 s, Express 179.1799999922514 ms
```

ADR-0032/0084/0365 are the frozen version/frame/recompile/read-head authority.
Pre-change JSON Worker conformance is reproducible with:

```sh
pnpm vitest run tests/conformance/kernel/sync-rpc.test.ts
# 2 passed on protocol v4, 2026-08-26
```

## Acceptance

1. SyncRpc v5 encodes/decodes ADR-0366's exact binary request envelope. JSON
   request and binary/JSON reply behavior remains byte-exact. Empty/truncated/
   invalid-UTF-8/unknown frames reject before dispatch; an exact v4 peer gets
   `EPROTOVERSION` before decode.
2. The published `KernelSyncApi` exposes required `call` + `callBinary`; a
   partial publication is loud. A real Worker performs sequential JSON and
   binary exchanges through the same claimed ring lifecycle.
3. One dispatcher registration owns one semantic handler plus an optional
   binary decoder. Binary-without-decoder and decoder corruption reject before
   handler; decoder errors, handler errors, async settlement, unknown methods,
   and JSON calls retain the existing bounded/error behavior.
4. `SyncRpcFsSync` uses binary requests, never JSON, for exactly `exists`,
   `stat`, `statOrNull`, `readFileHead`, and `readChunk`. Independent byte
   goldens pin path/range encoding and the owner receives exact logical values.
   `readdir` and all mutations remain JSON; freshness, VfsError rehydration,
   chunking, and public Node error shapes remain unchanged.
5. Product CLI/dev-server/recursive children and the TypeScript worker consume
   the same complete `KernelSyncApi`; test responders share one exact adapter.
   `SyncRpcFsSync` requires both transport functions and rejects a bare legacy
   call. No optional fallback, opcode registry, cache, second handler, or
   binary frame construction outside kernel ships.
6. The unchanged public `bench:child-fs` rig records
   `perf/child-fs-after-binary-requests.json` from the implementation commit.
   Baseline, post-I1, and post-I2 artifact tests are strict and independent of
   the active goal ledger so the finished goal directory can be deleted.

## Parity cases

- `json-request-stability`: existing real-Worker JSON exchanges and error
  replies remain byte/behavior identical on v5.
- `binary-request-worker`: a hand-written Worker request and production
  `callBinary` reach the same registered decoder/handler and exact reply.
- `hot-fs-route`: five read/probe methods use exact binary payloads through the
  real dispatcher; JSON call count is zero. Readdir/mutations remain JSON.
- `fs-semantics`: byte results, sequential owner freshness, ENOENT/EISDIR/
  ENOTDIR Node shapes, and large continuation traces match post-I1 behavior.
- `two-real-lanes-after`: the post-I2 artifact validates two canonical 2180
  module lanes and exact Vite/Express raw samples.

## Fault matrix

| Boundary / fault class | Injected fault | Required observable result |
|---|---|---|
| binary envelope / `corrupt-input` | empty/truncated method length, zero/oversized length, invalid UTF-8, unknown discriminator | reject before decoder/handler; ring returns JSON error |
| binary decoder / `corrupt-input` | method has no decoder; decoder throws; malformed path/range | loud typed error before semantic handler/VFS touch |
| protocol / `corrupt-input` | v4 frame reaches v5 peer | `EPROTOVERSION` before frame decode |
| published adapter / `sibling-drift` | neither/only-one/both global call hooks | neither = null; partial = loud; every consumer receives both |
| fs route / `sibling-drift` | each hot method plus readdir/mutation controls | five binary only; controls JSON only; one shared codec/handler seam |
| owner mutation / `observable-order` | overwrite between calls; shrink during continuation | next op sees latest owner bytes; inconsistent continuation stays loud |
| artifact / `provenance-lie` | baseline/post-I1 reuse or later source drift | distinct implementation SHA + exact immediate publication/blob/path proof |

## Out of scope

- Compact boolean/stat/readdir replies; all non-byte replies remain JSON.
- Binary `readdir`, mutation, and write bodies; base64 write inflation stays
  `perf/fs-rpc-chunk-perf`/install-write work.
- Numeric speedup target, opcode registry, method-byte cache, child fs cache,
  RPC bypass, large-file O(N²), non-COI topology, or spawn cost.

## Decisions

ready-verdict: 2026-08-26 — Contract+RED @ 3c89756f9 — PASS, unit residuals empty

- ADR-0366 chooses the two-operation `KernelSyncApi` deep seam and string-method
  binary envelope; it rejects dual semantic payloads and global opcodes.
- Protocol version 4→5; all kernel/runtime/workbench/TS peers compile together.
- The dispatcher owns one handler registration; runtime-js supplies only the
  application payload decoder next to that handler.
- Binary payload decode copies out of the ring before application dispatch.
- Exactly five read/probe methods go binary; every excluded method remains an
  explicit JSON control in RED.
- The three raw measurement artifacts are the durable before/after carriers;
  tests must not depend on the goal ledger that CLOSE deletes.
- Expected RED band: 20–22 failing cases across kernel wire/client/dispatcher/
  globals/conformance, runtime fs route/fault, shared consumers, and the absent
  post-I2 artifact. This is one atomic two-peer behavior; substrate alone has
  no user-observable delivery and cannot be split into a reviewable PR.

## Reversibility

IRREVERSIBLE public two-peer wire/interface; ADR-0366 accepted at pickup.
