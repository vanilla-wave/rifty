/**
 * Fixture for `tests/conformance/kernel/sync-rpc.test.ts`.
 *
 * Runs inside a Node `worker_threads.Worker`. Receives the shared ring
 * buffer + payload capacity, then drives the protocol exactly as the
 * production `SyncRpcClient` does:
 *
 *   1. Encode a request frame via `JSON.stringify` + `TextEncoder`.
 *   2. Write the bytes into the request slot (manual mirror of
 *      `SabRing.writeRequest` — kept hand-written so the fixture also
 *      catches any drift in the protocol layout).
 *   3. `Atomics.wait` on REP_STATE for the dispatcher's reply.
 *   4. Decode the reply, post the parsed `value` back to the test, then
 *      exit.
 *
 * Plain JS so it loads directly into a Node Worker URL — no transpile.
 *
 * Layout (ADR-0011 + ADR-0032): 20-byte header. VERSION at index 0 is
 * stamped on every write; the production reader validates and the
 * dispatcher rejects mismatched frames with a typed error reply.
 *
 * Wire (ADR-0084 #23, v2): each frame body starts with a 1-byte discriminator
 * — 0x00 = JSON, 0x01 = BINARY. This fixture writes a JSON request (0x00 +
 * JSON) and decodes the reply by branching on byte[0]. The SAB header stays
 * 20 bytes (the discriminator lives in the payload body, not the header).
 */
import { parentPort, workerData } from 'node:worker_threads';

if (!parentPort) throw new Error('sync-rpc-echo: must run inside a Worker');

const { sab, payloadCapacity, method, payload, timeoutMs, protocolVersion } = workerData;

const HEADER_BYTES = 20;
const VERSION_INDEX = 0;
const REQ_STATE_INDEX = 1;
const REP_STATE_INDEX = 2;
const REQ_LEN_INDEX = 3;
const REP_LEN_INDEX = 4;

const i32 = new Int32Array(sab, 0, HEADER_BYTES >> 2);
const bytes = new Uint8Array(sab);
const reqPayloadOffset = HEADER_BYTES;
const repPayloadOffset = HEADER_BYTES + payloadCapacity;

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

const FRAME_JSON = 0x00;
const FRAME_BINARY = 0x01;

// Build the request bytes — 1-byte JSON discriminator + { method, payload } JSON.
const jsonBytes = encoder.encode(JSON.stringify({ method, payload }));
const reqBytes = new Uint8Array(jsonBytes.byteLength + 1);
reqBytes[0] = FRAME_JSON;
reqBytes.set(jsonBytes, 1);
if (reqBytes.byteLength > payloadCapacity) {
  throw new Error(
    `sync-rpc-echo: request (${reqBytes.byteLength}B) exceeds capacity (${payloadCapacity}B)`,
  );
}

// Phase 1: writeRequest equivalent. VERSION stamped before STATE flips (ADR-0032).
bytes.set(reqBytes, reqPayloadOffset);
Atomics.store(i32, REQ_LEN_INDEX, reqBytes.byteLength);
Atomics.store(i32, VERSION_INDEX, protocolVersion);
Atomics.store(i32, REQ_STATE_INDEX, 1);
Atomics.notify(i32, REQ_STATE_INDEX);

// Phase 2: block on reply (production caller-side path uses Atomics.wait).
const waitResult = Atomics.wait(i32, REP_STATE_INDEX, 0, timeoutMs ?? Number.POSITIVE_INFINITY);
if (waitResult === 'timed-out') {
  parentPort.postMessage({ type: 'error', message: `timed out after ${timeoutMs}ms` });
  process.exit(1);
}

// Phase 3: consumeReply equivalent. Validate VERSION before payload (ADR-0032).
const repVersion = Atomics.load(i32, VERSION_INDEX);
const repLen = Atomics.load(i32, REP_LEN_INDEX);
const replyBytes = new Uint8Array(repLen);
replyBytes.set(bytes.subarray(repPayloadOffset, repPayloadOffset + repLen));
Atomics.store(i32, REP_LEN_INDEX, 0);
Atomics.store(i32, REP_STATE_INDEX, 0);

if (repVersion !== protocolVersion) {
  parentPort.postMessage({
    type: 'error',
    message: `protocol version mismatch: expected ${protocolVersion}, got ${repVersion}`,
  });
  process.exit(1);
}

// Branch on the v2 frame discriminator (ADR-0084 #23): 0x01 BINARY → raw bytes
// value; 0x00 JSON → parse the body. The 'echo' handler returns JSON; the
// binary branch is here so the fixture mirrors the production decoder exactly.
let reply;
try {
  if (replyBytes[0] === FRAME_BINARY) {
    reply = { ok: true, value: replyBytes.slice(1) };
  } else {
    reply = JSON.parse(decoder.decode(replyBytes.subarray(1)));
  }
} catch (err) {
  parentPort.postMessage({
    type: 'error',
    message: `failed to decode reply: ${err.message}`,
  });
  process.exit(1);
}

parentPort.postMessage({ type: 'reply', reply });
