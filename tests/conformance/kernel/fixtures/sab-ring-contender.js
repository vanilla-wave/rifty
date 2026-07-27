/**
 * Two copies of this Worker race one shared SAB transition. The attempt barrier
 * holds the winner in WRITING/HANDLING until the loser has observed that claim.
 */
import { parentPort, workerData } from 'node:worker_threads';

if (!parentPort) throw new Error('sab-ring-contender: must run inside a Worker');

const { role, sab, payloadCapacity, protocolVersion, startSab, attemptsSab, marker } = workerData;
const HEADER_BYTES = 20;
const VERSION_INDEX = 0;
const REQ_STATE_INDEX = 1;
const REP_STATE_INDEX = 2;
const REQ_LEN_INDEX = 3;
const REP_LEN_INDEX = 4;
const STATE_IDLE = 0;
const STATE_READY = 1;
const STATE_HANDLING = 2;
const STATE_WRITING = 3;
const i32 = new Int32Array(sab, 0, HEADER_BYTES >> 2);
const bytes = new Uint8Array(sab);
const start = new Int32Array(startSab);
const attempts = new Int32Array(attemptsSab);
const reqPayloadOffset = HEADER_BYTES;
const repPayloadOffset = HEADER_BYTES + payloadCapacity;

function recordAttempt() {
  Atomics.add(attempts, 0, 1);
  Atomics.notify(attempts, 0);
}

function waitForBothAttempts() {
  while (Atomics.load(attempts, 0) < 2) {
    Atomics.wait(attempts, 0, Atomics.load(attempts, 0));
  }
}

parentPort.postMessage({ type: 'ready' });
Atomics.wait(start, 0, STATE_IDLE);

if (role === 'caller') {
  const seen = Atomics.compareExchange(i32, REQ_STATE_INDEX, STATE_IDLE, STATE_WRITING);
  recordAttempt();
  if (seen !== STATE_IDLE) {
    parentPort.postMessage({ type: 'lost', role, marker, state: seen });
  } else {
    waitForBothAttempts();
    bytes[reqPayloadOffset] = marker;
    Atomics.store(i32, REQ_LEN_INDEX, 1);
    Atomics.store(i32, VERSION_INDEX, protocolVersion);
    Atomics.store(i32, REQ_STATE_INDEX, STATE_READY);
    Atomics.notify(i32, REQ_STATE_INDEX);

    const result = Atomics.wait(i32, REP_STATE_INDEX, STATE_IDLE, 2_000);
    if (result === 'timed-out') throw new Error('caller contender timed out');
    const reply = bytes[repPayloadOffset];
    Atomics.store(i32, REP_LEN_INDEX, 0);
    Atomics.store(i32, REP_STATE_INDEX, STATE_IDLE);
    const released = Atomics.compareExchange(i32, REQ_STATE_INDEX, STATE_HANDLING, STATE_IDLE);
    if (released !== STATE_HANDLING) {
      throw new Error(`caller contender release found state ${released}`);
    }
    Atomics.notify(i32, REQ_STATE_INDEX);
    parentPort.postMessage({ type: 'done', role, marker, reply });
  }
} else if (role === 'responder') {
  const seen = Atomics.compareExchange(i32, REQ_STATE_INDEX, STATE_READY, STATE_HANDLING);
  recordAttempt();
  if (seen !== STATE_READY) {
    parentPort.postMessage({ type: 'lost', role, marker, state: seen });
  } else {
    waitForBothAttempts();
    const len = Atomics.load(i32, REQ_LEN_INDEX);
    const request = bytes[reqPayloadOffset];
    Atomics.store(i32, REQ_LEN_INDEX, 0);
    bytes[repPayloadOffset] = request + 10;
    Atomics.store(i32, REP_LEN_INDEX, len);
    Atomics.store(i32, VERSION_INDEX, protocolVersion);
    Atomics.store(i32, REP_STATE_INDEX, STATE_READY);
    Atomics.notify(i32, REP_STATE_INDEX);
    parentPort.postMessage({ type: 'done', role, marker, request });
  }
} else {
  throw new Error(`sab-ring-contender: unknown role ${role}`);
}
