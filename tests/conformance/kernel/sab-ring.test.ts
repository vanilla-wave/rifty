/**
 * Conformance test for ADR-0011 phase 1 — SAB ring exercised across a real
 * Worker realm.
 *
 * The fixture worker uses the production caller-side primitive
 * (`Atomics.wait`) to block on incoming requests and `Atomics.notify` to
 * wake the parent's `waitReplyAsync` after each echo. This catches any
 * regression where the layout / state-slot semantics drift between the
 * `SabRing` class (TS) and a hand-written peer (JS fixture).
 *
 * Skipped when the host lacks SAB (no `SharedArrayBuffer` constructor or
 * no `Atomics.waitAsync`). Vitest's Node environment normally satisfies
 * both, so this stays alive in CI.
 */
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { describe, expect, it } from 'vitest';
import {
  SAB_RING_HEADER_BYTES,
  SabRing,
  createSabRing,
} from '../../../packages/kernel/src/ipc/sab-ring.ts';
import { SYNC_RPC_PROTOCOL_VERSION } from '../../../packages/kernel/src/ipc/sync-rpc.ts';

const hasSab =
  typeof SharedArrayBuffer === 'function' &&
  typeof Atomics !== 'undefined' &&
  typeof (Atomics as unknown as { waitAsync?: unknown }).waitAsync === 'function';

const fixtureUrl = new URL('./fixtures/sab-ring-echo.js', import.meta.url);

describe.skipIf(!hasSab)('SabRing — real Worker round-trip (ADR-0011 phase 1)', () => {
  it('parent writes requests; worker echoes via Atomics.wait/notify on the SAB ring', async () => {
    const payloadCapacity = 1024;
    const { sab, ring } = createSabRing({ payloadCapacity });
    expect(sab.byteLength).toBe(SAB_RING_HEADER_BYTES + payloadCapacity * 2);

    const worker = new Worker(fileURLToPath(fixtureUrl), {
      workerData: { sab, payloadCapacity, protocolVersion: SYNC_RPC_PROTOCOL_VERSION },
    });

    // Wait for the fixture to signal it's installed and looping.
    await new Promise<void>((resolve, reject) => {
      worker.once('message', (msg) => {
        if (msg?.type === 'ready') resolve();
        else reject(new Error(`unexpected worker message: ${JSON.stringify(msg)}`));
      });
      worker.once('error', reject);
    });

    // Three sequential request/reply cycles.
    const payloads = [
      new Uint8Array([1, 2, 3]),
      new Uint8Array([42]),
      new Uint8Array([0xff, 0x00, 0x10, 0x20, 0x40]),
    ];
    for (const payload of payloads) {
      ring.writeRequest(payload);
      const reply = await ring.waitReplyAsync(2000);
      expect(Array.from(reply)).toEqual(Array.from(payload));
    }

    // Shutdown handshake: empty payload tells the fixture to exit.
    ring.writeRequest(new Uint8Array(0));
    const finalReply = await ring.waitReplyAsync(2000);
    expect(finalReply.byteLength).toBe(0);

    await new Promise<void>((resolve, reject) => {
      worker.once('exit', () => resolve());
      worker.once('error', reject);
    });
  });

  it('responder side: parent attaches a SabRing peer, polls, and replies', () => {
    // Pure in-realm sanity round-trip — the conformance test above already
    // covers cross-realm. This guards the layout constants when a downstream
    // package wires SabRing.attach() directly.
    const { sab, ring: caller } = createSabRing({ payloadCapacity: 64 });
    const responder = SabRing.attach(sab, 64);
    caller.writeRequest(new Uint8Array([7, 8, 9]));
    const got = responder.readRequest();
    expect(got).not.toBeNull();
    responder.writeReply(new Uint8Array((got ?? []).map((b) => b * 2)));
    // The caller side would use waitReply (sync) from a Worker, but in this
    // realm we exercise the async sibling.
    return caller.waitReplyAsync(500).then((reply) => {
      expect(Array.from(reply)).toEqual([14, 16, 18]);
    });
  });
});
