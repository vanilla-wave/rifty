# ADR 0032: SyncRpc protocol-version field in the SAB header

Status: Accepted (2026-05-25)
Date: 2026-05

## Context

ADR-0011 phase 3 shipped the SAB-backed sync RPC protocol used by every kernel-spawned Worker. The phase-1 header (`packages/kernel/src/ipc/sab-ring.ts`) reserved four `Int32` slots — `REQ_STATE`, `REP_STATE`, `REQ_LEN`, `REP_LEN` — and the framing layer in `sync-rpc.ts` encoded `{ method, payload }` / `{ ok, value | error }` as JSON-over-UTF-8.

The protocol carries no version bytes anywhere on the wire. ADR-0011 itself flags a follow-up (A-021, binary pipes with backpressure) that will need its own frame discriminator. Once that lands, a v1 reader paired with a v2 writer (or vice-versa, e.g. an updated playground talking to an older kernel chunk left in the SW cache) would interpret v2 bytes through the v1 decoder. The failure modes are subtle: a v1 reader may successfully `JSON.parse` v2 bytes that happen to be valid JSON and silently produce nonsense; or it may throw a generic `SyntaxError` that masks the real problem.

The Service Worker protocol (ADR-0016, `packages/service-worker/src/protocol.ts`) already solves the same problem the right way: `SW_PROTOCOL_VERSION = '1'` is stamped into every frame and validated on handshake / pong, with a structured warning when peers disagree. The kernel's SAB IPC needs the equivalent — and unlike the SW case, which validates only on liveness checks, the SAB ring carries far more frames per session and any drift between peers is a latent corruption source.

## Decision

Add a `u32` SyncRpc protocol-version field to the SAB header, stamp it on every `writeRequest` / `writeReply`, validate it on every `readRequest` / `consumeReply`. Reject mismatched frames before payload decoding with a typed error.

- Export `SYNC_RPC_PROTOCOL_VERSION = 1` from `packages/kernel/src/ipc/sync-rpc.ts`. Bump on any wire change.
- Reserve a `u32` slot in the SAB header at offset 0 (`VERSION_OFFSET`), BEFORE `REQ_STATE`. Header grows from 16 to 20 bytes; `SAB_RING_HEADER_BYTES = 20`. New slot constants:
  - `VERSION_OFFSET = 0`, `VERSION_INDEX = 0`
  - `REQ_STATE_OFFSET = 4` (was 0), `REP_STATE_OFFSET = 8` (was 4), `REQ_LEN_OFFSET = 12` (was 8), `REP_LEN_OFFSET = 16` (was 12).
- `SabRing.writeRequest(payload)` and `SabRing.writeReply(payload)` stamp the version (from the ring's `expectedVersion`) BEFORE flipping the state slot to READY. Atomicity matters: a peer waking on `REQ_STATE`/`REP_STATE` is guaranteed to see a coherent VERSION.
- `SabRing.readRequest()` and the internal `consumeReply()` (used by `waitReply` / `waitReplyAsync`) snapshot the version, clear the state slot, and throw `SyncRpcProtocolMismatchError({expected, got, code: 'EPROTOVERSION'})` when versions disagree. The state slot is cleared BEFORE the throw so a single forged peer cannot wedge the ring.
- `SabRing.attach()` accepts an optional `expectedVersion` (defaults to `SYNC_RPC_PROTOCOL_VERSION`). Production callers leave the default in place; test/diagnostic code overrides to assert against a forged peer.
- `SabRing.writeRequestWithVersion` / `writeReplyWithVersion` are explicit-version sibling methods. Used (a) by tests to forge a mismatched frame, and (b) by the dispatcher's protocol-mismatch recovery path: when a request with a wrong version arrives, the dispatcher writes the error reply at the version the CALLER used — so the caller can still decode the failure frame and surface a typed `EPROTOVERSION` error to its own caller.
- `SyncRpcDispatcher.pumpOnce` catches `SyncRpcProtocolMismatchError` from `readRequest` and routes through `writeVersionedError(ring, err.got, err)`. The reply payload is the standard `{ ok: false, error: { name, message, code: 'EPROTOVERSION' } }` shape.

Validation is loud and irrecoverable at the protocol layer (per ADR-0016's pattern). The protocol does NOT attempt cross-version compatibility.

## Consequences

- Mixed-version peers fail fast with `code: 'EPROTOVERSION'` instead of silently corrupting state or surfacing a generic JSON parse error.
- The SAB header grows by 4 bytes. The hand-written test fixtures in `tests/conformance/kernel/fixtures/sab-ring-echo.js` and `tests/conformance/kernel/fixtures/sync-rpc-echo.js` were updated to match (they hand-mirror the layout precisely so any drift between fixture and production code surfaces as a failed round-trip).
- Wire changes from now on (e.g. A-021 binary-frame discriminator) bump `SYNC_RPC_PROTOCOL_VERSION` to `2`. The two-peer rollout is a recompile-everything-at-once moment by design — same model as ADR-0016 (`SW_PROTOCOL_VERSION`).
- The SAB layout is no longer compatible with code that pre-dates this ADR. Both producer and consumer of every SAB ring are in the same package (`@riftydev/kernel`); a single PR updates both sides atomically. There is no on-disk persistence of frames, so there is no migration story to worry about.
- Negative: the explicit-version variants (`writeRequestWithVersion` / `writeReplyWithVersion`) widen the `SabRing` public surface. They are documented as test/diagnostic / dispatcher-recovery hooks; production code uses the parameterless siblings.
- Cites ADR-0011 (the protocol this layer sits on) and ADR-0016 (the pattern this ADR mirrors).

## Acceptance criteria

- [x] `SYNC_RPC_PROTOCOL_VERSION` exported from `packages/kernel/src/ipc/sync-rpc.ts` and re-exported from the package's `src/index.ts`.
- [x] `SyncRpcProtocolMismatchError` exported and re-exported. `code === 'EPROTOVERSION'`.
- [x] SAB header is 20 bytes; VERSION at offset 0; state slots shifted forward.
- [x] `writeRequest` / `writeReply` stamp the version atomically before flipping state.
- [x] `readRequest` / `consumeReply` validate and throw on mismatch; state is cleared first so the ring stays usable.
- [x] Dispatcher writes a versioned error reply (`code: 'EPROTOVERSION'`) at the caller's version when a request with a wrong version arrives.
- [x] Unit tests in `packages/kernel/src/ipc/sync-rpc.test.ts` cover both rejection directions (request and reply) and the dispatcher's recovery path.
- [x] Hand-written conformance fixtures in `tests/conformance/kernel/fixtures/*.js` updated to the 20-byte header.
