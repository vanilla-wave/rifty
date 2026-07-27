/**
 * Fixture for `tests/conformance/kernel/sab-ring.test.ts`.
 *
 * Runs inside a Node `worker_threads.Worker`. On startup it receives the
 * shared ring buffer + payload capacity, then blocks on every request with
 * `Atomics.wait` (the production caller-side path), echos the bytes back
 * via the reply slot, and signals 'done' once the parent posts an empty
 * payload (sentinel for shutdown).
 *
 * Plain JS so it can be loaded directly as a Worker URL — no transpile
 * needed for vitest's Node environment.
 *
 * Layout (ADR-0011 + ADR-0032): 20-byte header — VERSION, REQ_STATE,
 * REP_STATE, REQ_LEN, REP_LEN. Hand-mirrored so any drift between this
 * fixture and the production `SabRing` class shows up as a failed
 * round-trip.
 */
import { parentPort, workerData } from 'node:worker_threads';

if (!parentPort) throw new Error('sab-ring-echo: must run inside a Worker');

const { sab, payloadCapacity, protocolVersion } = workerData;
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
const STATE_IDLE = 0;
const STATE_READY = 1;
const STATE_HANDLING = 2;

parentPort.postMessage({ type: 'ready' });

for (;;) {
  // Block until the parent publishes READY, then claim exactly once.
  while (
    Atomics.compareExchange(i32, REQ_STATE_INDEX, STATE_READY, STATE_HANDLING) !== STATE_READY
  ) {
    const state = Atomics.load(i32, REQ_STATE_INDEX);
    Atomics.wait(i32, REQ_STATE_INDEX, state);
  }

  // ADR-0032: snapshot version under the handling claim. The fixture echoes the
  // version back in its reply (production code stamps from its own
  // `expectedVersion`; we use the caller's so we don't need to know it).
  const reqVersion = Atomics.load(i32, VERSION_INDEX);
  const len = Atomics.load(i32, REQ_LEN_INDEX);
  const req = new Uint8Array(len);
  req.set(bytes.subarray(reqPayloadOffset, reqPayloadOffset + len));

  // Length is consumed now; HANDLING remains until the caller consumes reply.
  Atomics.store(i32, REQ_LEN_INDEX, 0);

  // Empty payload = shutdown sentinel. Send an empty reply, wait for the
  // caller's exact HANDLING→IDLE release, then exit.
  if (len === 0) {
    Atomics.store(i32, REP_LEN_INDEX, 0);
    Atomics.store(i32, VERSION_INDEX, protocolVersion ?? reqVersion);
    Atomics.store(i32, REP_STATE_INDEX, 1);
    Atomics.notify(i32, REP_STATE_INDEX);
    Atomics.wait(i32, REQ_STATE_INDEX, STATE_HANDLING);
    if (Atomics.load(i32, REQ_STATE_INDEX) !== STATE_IDLE) {
      throw new Error('sab-ring-echo: caller did not release HANDLING to IDLE');
    }
    parentPort.postMessage({ type: 'done' });
    break;
  }

  // Echo: copy the request bytes into the reply slot, then signal.
  bytes.set(req, repPayloadOffset);
  Atomics.store(i32, REP_LEN_INDEX, len);
  Atomics.store(i32, VERSION_INDEX, protocolVersion ?? reqVersion);
  Atomics.store(i32, REP_STATE_INDEX, 1);
  Atomics.notify(i32, REP_STATE_INDEX);
  Atomics.wait(i32, REQ_STATE_INDEX, STATE_HANDLING);
  if (Atomics.load(i32, REQ_STATE_INDEX) !== STATE_IDLE) {
    throw new Error('sab-ring-echo: caller did not release HANDLING to IDLE');
  }
}
