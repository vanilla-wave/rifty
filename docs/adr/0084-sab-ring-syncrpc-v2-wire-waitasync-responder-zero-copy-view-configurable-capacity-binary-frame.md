# ADR 0084: SAB ring + SyncRpc v2 wire — waitAsync responder, zero-copy view, configurable capacity, binary frame

Status: Accepted
Date: 2026-06-06

Wave 4 of the JS-runtime perf plan (`docs/perf/js-runtime-perf-adr-plan-2026-06-06.md`,
audit `docs/perf/js-runtime-perf-audit-2026-06-05.md`). Four mechanisms over the
SAB sync-IPC stack (ADR-0011) + the SyncRpc wire (ADR-0032). Items #17, #18, #19,
#23. Lands as ONE atomic two-peer change — kernel `sync-rpc.ts`/`sync-dispatch.ts`/
`sab-ring.ts` + runtime-js `handlers.ts`/`child_process-sync.ts` recompile together.

## Context

- #18: `SabRing.readRequest`/`consumeReply` copied the payload out into a fresh
  `Uint8Array`. Production consumers decode synchronously and retain nothing — the
  copy is pure overhead.
- #17: the dispatcher busy-polled `setInterval(1ms)`. The caller's `writeRequest`
  already fires `Atomics.notify(REQ_STATE)` (sab-ring.ts) but nothing waited on it —
  a wasted notify. ADR-0011's docstring claimed `waitAsync` "would block forever";
  that is `Atomics.wait` semantics, FALSE for `waitAsync` (the repo's own
  `waitReplyAsync` proves it). Stale premise — overturned here.
- #19: per-ring capacity agreement was implicit-by-coincidence: parent
  `createSabRing()` and child `SabRing.attach(spec.syncRing)` BOTH defaulted to
  1 MiB. Making capacity configurable on one side silently desynced offsets.
- #23: `execSync` round-tripped child stdout bytes→string→JSON→UTF-8. The
  bytes→string step (`new TextDecoder().decode`, non-fatal) mangled any non-UTF-8
  byte to U+FFFD BEFORE framing — a real Node-parity bug (Node's `execSync` returns
  a Buffer byte-exact). Demonstrated: `[0xff,0xfe,0x00]` → `[ef bf bd ef bf bd 00]`.

## Decision

### #18 — zero-copy view (kernel `sab-ring.ts`)
`readRequest`/`consumeReply` return a live `this.bytes.subarray(off, off+len)` VIEW
into the SAB, not a copy. Gate preserved verbatim: success path snapshots
VERSION+LEN, clears LEN, flips STATE→IDLE, validates, THEN returns the view
(decode-then-flip-IDLE); error/version-mismatch path flips-then-throws (wedge
guard). New public contract: the view ALIASES the SAB and is valid only until the
next write to that slot — decode synchronously. Production callers do
(sync-client, sync-dispatch). Header stays 20 bytes.

### #17 — waitAsync responder (kernel `sync-dispatch.ts` + `sab-ring.ts`)
New public `SabRing.armRequest(timeout): WaitAsyncResult` mirrors `waitReplyAsync`
but on REQ_STATE (REQ_STATE_INDEX is module-private, so the dispatcher can't arm
inline). The dispatcher arms a per-ring `waitAsync` on REQ_STATE; the caller's
notify wakes it sub-ms. On resolve/`'not-equal'` it pumps + re-arms — UNLESS the
ring detached (per-ring generation counter; `waitAsync` has no cancel token, so a
post-detach settle no-ops). Re-arm after an async (`execSync`) handler is deferred
to the reply-writers (after `inFlight` clears) so it never spins on an in-flight
ring. A single global backstop timer (50-100 ms) re-pumps every ring to recover
missed notify / recursive-attach windows. Feature-detect: no `Atomics.waitAsync` →
fall back to the legacy `setInterval(pollIntervalMs)` busy-poll verbatim.

`getActiveTimerCount()` keeps its literal 0/1 meaning (the single global timer is
the backstop) — the singleton invariant (ADR-0011 review §2.11) holds.

### #19 — configurable payload capacity (kernel `worker-entry.ts`/`spawn-worker.ts`/`sab-ring.ts`)
`WorkerSpawnSpec` gains a public `payloadCapacity?: number` field (and
`SpawnWorkerSpec` likewise). The parent sizes `syncRing` AND stamps the spec from
one value; the child attaches with `spec.payloadCapacity`. `SabRing`'s size guard
is tightened from `<` to EXACT match (buffer === HEADER + 2×capacity), so a
desynced capacity throws `RangeError` loudly instead of reading the wrong slot.
DEFAULT_PAYLOAD_CAPACITY (1 MiB) is NOT lowered this wave — lowering needs an
execSync escalation/chunked path (deferred, OQ-323).

### #23 — SyncRpc v2 binary frame (kernel `sync-rpc.ts` + runtime-js `handlers.ts`/`child_process-sync.ts`)
1-byte frame discriminator prefixes every body: `0x00`=JSON (the v1 shape),
`0x01`=BINARY (raw bytes). `encodeBinaryReply(bytes)` emits `[0x01][bytes…]`;
`decodeReply` branches on byte[0] (0x01 → `Uint8Array` value, no TextDecoder/JSON).
The dispatcher auto-detects a `Uint8Array` handler value → binary frame (handler
contract stays simple). Requests stay JSON-only (small payloads) — minimal blast
radius. Errors stay JSON (the `{name,message,code}` contract + ADR-0032
versioned-error recovery are untouched; only `ok=true` byte values go binary).
`handlers.ts` returns `result.stdout` (Uint8Array) verbatim; `child_process-sync.ts`
returns `Buffer.from(bytes)` (no re-encode) — Node-correct byte-exact `execSync`.

`SYNC_RPC_PROTOCOL_VERSION` bumps 1→2. ADR-0032 §Decision/§Consequences PRE-AUTHORISE
this bump for "A-021's binary-frame discriminator" — a recompile-everything-at-once
moment by design (same model as ADR-0016). Both peers live in `@riftydev/kernel`,
recompiled atomically. The discriminator lives in the payload BODY, not the SAB
header, so the 20-byte header is unchanged and the conformance fixtures
(`sab-ring-echo.js`, `sync-rpc-echo.js`) do not move offsets — `sync-rpc-echo.js` is
updated only to write/strip the frame discriminator (it mirrors the wire format).

### Design forks recorded
- 1-byte JSON/BINARY discriminator in the payload byte[0] (vs the SAB header, vs a
  tagged `SyncRpcReply.kind` field). Chosen: payload byte[0] — keeps the header at
  20 bytes (fixtures don't move) and lets the dispatcher auto-detect by value type.
- EXACT vs `>=` capacity guard. Chosen EXACT — the parent always allocates exactly
  HEADER + 2×C, so any mismatch is a peer disagreement to reject loudly.
- `pollIntervalMs` meaning change: primary→backstop-only (observable public-option
  contract change). Kept the field accepted; clamped to 50-100 ms in event-driven
  mode; literal poll interval in fallback.

## Consequences

- `execSync` returns child stdout byte-exact (Node parity) — non-UTF-8 stdout no
  longer corrupted. Proven by `binary-stdout-exec` hex parity case + a byte-exact
  conformance test (`Uint8Array.from([0xff,0xfe,0x00])`, length 3 not 7).
- Sub-ms event-driven sync-RPC latency; no 1 ms busy-poll burning CPU per realm.
- #18's zero-copy is a RING-LAYER property only; net copy savings end-to-end are
  ~NEUTRAL. The ring no longer copies, but both production decode consumers
  immediately re-copy the SAB view: `decodeReply` binary path `value: body.slice()`
  (sync-rpc.ts) always copies, and the JSON path copies in
  `decodeUtf8FromMaybeShared` (`UTF8_DECODER.decode(body.slice())`) since the
  ADR-0087 fix (browsers reject decoding a shared view). The win is one fewer
  ring-internal allocation + the freedom for a FUTURE consumer that can read the
  view in place; the value is NOT a removed copy on today's request/reply path.
  Consumers MUST NOT decode the shared view directly (cross-ref ADR-0087 +
  docs/backlog/tests/browser-honest-coverage.md).
- Public API additions (rule-1 IRREVERSIBLE): `SabRing.armRequest`,
  `WorkerSpawnSpec.payloadCapacity`, `SpawnWorkerSpec.payloadCapacity`,
  `encodeBinaryReply`/`FRAME_JSON`/`FRAME_BINARY`, `SYNC_RPC_PROTOCOL_VERSION`→2.
- The zero-copy view contract obliges consumers to decode synchronously; a future
  consumer retaining a view across a same-slot write would observe mutation (the
  ADR states it; production callers are safe).
- The version guard (`SyncRpcProtocolMismatchError`/EPROTOVERSION) still fires
  across the 1→2 bump — a v1 reader rejects a v2 frame before any decode.
- Two-peer recompile: kernel + runtime-js land atomically; capacity agreement is
  now explicit-by-spec, not coincidence-of-default. Half-bumped protocol is a
  release defect — never merge it partially.
- Deferred: lowering DEFAULT_PAYLOAD_CAPACITY (needs an execSync escalation/chunked
  reply path, OQ-323); request-side binary frames (no current need).

Supersedes the busy-poll rationale + "waitAsync blocks forever" note in ADR-0011
(phase 3) for the dispatcher. Cites ADR-0011, ADR-0032 (bump authority), ADR-0016
(recompile-at-once model), the perf audit + adr-plan.
