# ADR 0032: SyncRpc protocol-version field in the SAB header

Status: Accepted (2026-05-25)
Date: 2026-05

> TL;DR: SAB header gets a `u32` `VERSION_OFFSET=0` slot (16→20 bytes), stamped per write and validated per read, throwing `EPROTOVERSION` on mismatch before decode

## Context

ADR-0011 phase 3 shipped the SAB-backed sync RPC used by every kernel-spawned Worker. The phase-1 header (`packages/kernel/src/ipc/sab-ring.ts`) reserved four `Int32` slots — `REQ_STATE`, `REP_STATE`, `REQ_LEN`, `REP_LEN` — and `sync-rpc.ts` framed `{ method, payload }` / `{ ok, value | error }` as JSON-over-UTF-8.

The wire carries no version bytes. ADR-0011 flags a follow-up (A-021, binary pipes with backpressure) needing its own frame discriminator. Once it lands, a v1 reader paired with a v2 writer (e.g. an updated playground talking to an older kernel chunk in the SW cache) decodes v2 bytes through the v1 decoder — silently `JSON.parse`-ing nonsense, or throwing a generic `SyntaxError` that masks the cause.

The SW protocol (ADR-0016, `packages/service-worker/src/protocol.ts`) already does this right: `SW_PROTOCOL_VERSION = '1'` is stamped on every frame and validated on handshake/pong with a structured warning. The SAB ring needs the equivalent, and — unlike the SW case that validates only on liveness checks — it carries far more frames per session, so any drift is a latent corruption source.

## Decision

Add a `u32` SyncRpc protocol-version field to the SAB header, stamp it on every `writeRequest` / `writeReply`, validate it on every `readRequest` / `consumeReply`, and reject mismatched frames before payload decoding with a typed error.

- Export `SYNC_RPC_PROTOCOL_VERSION = 1` from `packages/kernel/src/ipc/sync-rpc.ts`. Bump on any wire change.
- Reserve a `u32` slot at header offset 0 (`VERSION_OFFSET`), before `REQ_STATE`. Header grows 16→20 bytes; `SAB_RING_HEADER_BYTES = 20`. Slot constants: `VERSION_OFFSET = 0` / `VERSION_INDEX = 0`; `REQ_STATE_OFFSET = 4` (was 0), `REP_STATE_OFFSET = 8` (was 4), `REQ_LEN_OFFSET = 12` (was 8), `REP_LEN_OFFSET = 16` (was 12).
- `SabRing.writeRequest` / `writeReply` stamp the version (from the ring's `expectedVersion`) before flipping the state slot to READY — so a peer waking on `REQ_STATE`/`REP_STATE` is guaranteed a coherent VERSION.
- `SabRing.readRequest` and internal `consumeReply` (used by `waitReply` / `waitReplyAsync`) snapshot the version, clear the state slot, then throw `SyncRpcProtocolMismatchError({expected, got, code: 'EPROTOVERSION'})` on mismatch. State is cleared before the throw so a single forged peer can't wedge the ring.
- `SabRing.attach()` takes an optional `expectedVersion` (defaults to `SYNC_RPC_PROTOCOL_VERSION`). Production keeps the default; test/diagnostic code overrides it to assert against a forged peer.
- `SabRing.writeRequestWithVersion` / `writeReplyWithVersion` are explicit-version siblings, used (a) by tests to forge a mismatched frame, and (b) by the dispatcher's recovery path — when a wrong-version request arrives, it writes the error reply at the version the CALLER used, so the caller can decode the failure and surface a typed `EPROTOVERSION`.
- `SyncRpcDispatcher.pumpOnce` catches `SyncRpcProtocolMismatchError` from `readRequest` and routes via `writeVersionedError(ring, err.got, err)`, yielding the standard `{ ok: false, error: { name, message, code: 'EPROTOVERSION' } }` reply.

Validation is loud and irrecoverable at the protocol layer (per ADR-0016); no cross-version compatibility is attempted.

## Consequences

- Mixed-version peers fail fast with `code: 'EPROTOVERSION'` instead of silently corrupting state or throwing a generic JSON parse error.
- The header grows 4 bytes. Hand-written fixtures `tests/conformance/kernel/fixtures/sab-ring-echo.js` and `sync-rpc-echo.js` were updated to match (they mirror the layout precisely, so any drift surfaces as a failed round-trip).
- Future wire changes (e.g. A-021's binary-frame discriminator) bump `SYNC_RPC_PROTOCOL_VERSION` to `2`. The two-peer rollout is a recompile-everything-at-once moment by design — same model as ADR-0016.
- The layout is no longer compatible with pre-ADR code, but both producer and consumer of every ring live in `@riftydev/kernel` (one PR updates both atomically) and frames have no on-disk persistence, so no migration story.
- Negative: the explicit-version variants widen the `SabRing` public surface. They are documented as test/diagnostic / dispatcher-recovery hooks; production uses the parameterless siblings.
- Cites ADR-0011 (the protocol below) and ADR-0016 (the pattern mirrored).

## Acceptance criteria

- [x] `SYNC_RPC_PROTOCOL_VERSION` exported from `packages/kernel/src/ipc/sync-rpc.ts` and re-exported from `src/index.ts`.
- [x] `SyncRpcProtocolMismatchError` exported and re-exported; `code === 'EPROTOVERSION'`.
- [x] SAB header is 20 bytes; VERSION at offset 0; state slots shifted forward.
- [x] `writeRequest` / `writeReply` stamp the version atomically before flipping state.
- [x] `readRequest` / `consumeReply` validate and throw on mismatch; state cleared first so the ring stays usable.
- [x] Dispatcher writes a versioned error reply (`code: 'EPROTOVERSION'`) at the caller's version when a wrong-version request arrives.
- [x] Unit tests in `packages/kernel/src/ipc/sync-rpc.test.ts` cover both rejection directions (request and reply) and the dispatcher recovery path.
- [x] Hand-written conformance fixtures in `tests/conformance/kernel/fixtures/*.js` updated to the 20-byte header.
