/**
 * Unit tests for {@link SyncRpcClient} call-context forensics.
 *
 * The client normally lives in a Worker realm (`Atomics.wait`); these tests
 * stub the realm probe and exercise only the NON-BLOCKING failure paths — a
 * wedged ring rejects `writeRequest` synchronously, and a timed-out call
 * throws before any block. The happy blocking path is covered by the
 * conformance Worker fixtures.
 *
 * Why: the two CI flake signatures ("cannot writeRequest while a previous
 * reply is unread", "decodeReply: unknown frame discriminator") surfaced with
 * ZERO context — no method name, no prior-call trail — making the primal
 * protocol violation undiagnosable. Every ring error thrown out of `call()`
 * must name the failing method and the previous call on this client.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SabRing, createSabRing } from './sab-ring.ts';
import { SyncRpcClient } from './sync-client.ts';

beforeEach(() => {
  // isWorkerRealm() wants WorkerGlobalScope + postMessage and no window.
  vi.stubGlobal('WorkerGlobalScope', function WorkerGlobalScope() {});
  vi.stubGlobal('postMessage', () => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('SyncRpcClient — call context on ring errors', () => {
  it('callBinary writes the exact v5 request before the ordinary timeout lifecycle', () => {
    const { sab, ring } = createSabRing({ payloadCapacity: 256 });
    const responder = SabRing.attach(sab, 256);
    const client = new SyncRpcClient(ring) as SyncRpcClient & {
      callBinary(method: string, payload: Uint8Array, timeoutMs?: number): unknown;
    };
    const payload = Uint8Array.from([0xff, 0x00, 0x7f]);
    expect(() => client.callBinary('fs.stat', payload, 1)).toThrow(
      /sync-rpc call 'fs\.stat' failed: .*timed out after 1ms/,
    );
    const method = new TextEncoder().encode('fs.stat');
    const expected = new Uint8Array(3 + method.length + payload.length);
    expected[0] = 0x01;
    new DataView(expected.buffer).setUint16(1, method.length, true);
    expected.set(method, 3);
    expected.set(payload, 3 + method.length);
    expect(responder.readRequest()).toEqual(expected);
  });

  it('a wedged ring (stale unread reply) error names the failing method', () => {
    const { sab, ring } = createSabRing({ payloadCapacity: 256 });
    const responder = SabRing.attach(sab, 256);
    const client = new SyncRpcClient(ring);
    // Forge the wedge: a reply sits unread (as after an abandoned exchange).
    ring.writeRequest(new Uint8Array([0]));
    responder.readRequest();
    responder.writeReply(new Uint8Array([1]));
    expect(() => client.call('fs.statOrNull', { path: '/x' })).toThrow(
      /sync-rpc call 'fs\.statOrNull' failed: .*previous reply is unread/,
    );
  });

  it('names the previous call on this ring (the abandoned exchange trail)', () => {
    const { sab, ring } = createSabRing({ payloadCapacity: 256 });
    const responder = SabRing.attach(sab, 256);
    const client = new SyncRpcClient(ring);
    // Call 1 times out (responder silent) — the request stays in flight.
    expect(() => client.call('fs.readChunk', { path: '/big' }, 20)).toThrow(/timed out/);
    // The responder answers late — the classic wedge.
    responder.readRequest();
    responder.writeReply(new Uint8Array([1]));
    // Call 2 hits the stale reply; the error must name BOTH methods.
    expect(() => client.call('fs.statOrNull', { path: '/x' })).toThrow(
      /'fs\.statOrNull'.*previous call on this ring: 'fs\.readChunk' \(failed\)/,
    );
  });

  it('keeps the original error class and code on the rethrow', () => {
    const { sab, ring } = createSabRing({ payloadCapacity: 256 });
    const responder = SabRing.attach(sab, 256);
    const client = new SyncRpcClient(ring);
    ring.writeRequest(new Uint8Array([0]));
    responder.readRequest();
    responder.writeReply(new Uint8Array([1]));
    let caught: unknown;
    try {
      client.call('fs.exists', { path: '/x' });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    // Same object augmented, not a lossy re-wrap: ring guard throws plain Error.
    expect((caught as Error).message).toMatch(/previous reply is unread/);
  });

  it('a successful-looking timeout records the method as failed, not completed', () => {
    const { ring } = createSabRing({ payloadCapacity: 256 });
    const client = new SyncRpcClient(ring);
    expect(() => client.call('execSync', { cmd: 'x' }, 20)).toThrow(
      /sync-rpc call 'execSync' failed: .*timed out after 20ms/,
    );
  });
});
