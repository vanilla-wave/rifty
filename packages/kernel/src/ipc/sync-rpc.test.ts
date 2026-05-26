/**
 * Unit tests for the SyncRpc protocol version field (ADR-0032).
 *
 * Every request and reply frame carries a `u32` version in the SAB header.
 * Mismatched versions MUST be rejected at the wire layer before the JSON
 * payload is decoded — the latter is fragile and would mask a real protocol
 * drift as a "malformed reply".
 *
 * Pattern mirrors the SW protocol versioning in
 * `service-worker/src/protocol.ts` (ADR-0031, ADR-0040): every frame
 * carries the version, every consumer validates loudly. The SW side splits
 * the constant into `SW_FRAME_VERSION` and `SW_ROUTING_VERSION` because it
 * has two contracts; sync-RPC has only one (frame shape) and keeps a
 * single constant.
 */

import { describe, expect, it } from 'vitest';
import { SAB_RING_HEADER_BYTES, SabRing, VERSION_INDEX, createSabRing } from './sab-ring.ts';
import { SyncRpcDispatcher } from './sync-dispatch.ts';
import { SYNC_RPC_PROTOCOL_VERSION, SyncRpcProtocolMismatchError } from './sync-rpc.ts';

describe('SyncRpc protocol version (ADR-0032)', () => {
  it('exports a positive integer version constant', () => {
    expect(typeof SYNC_RPC_PROTOCOL_VERSION).toBe('number');
    expect(Number.isInteger(SYNC_RPC_PROTOCOL_VERSION)).toBe(true);
    expect(SYNC_RPC_PROTOCOL_VERSION).toBeGreaterThanOrEqual(1);
  });

  it('SAB header reserves a u32 slot for version (4 bytes added to header size)', () => {
    // Phase-1 header was 16 bytes (REQ_STATE, REP_STATE, REQ_LEN, REP_LEN).
    // ADR-0032 adds VERSION before them, so the header grows to 20 bytes.
    expect(SAB_RING_HEADER_BYTES).toBe(20);
    // VERSION_INDEX is the u32 slot at offset 0.
    expect(VERSION_INDEX).toBe(0);
  });

  it('writeRequest stamps the protocol version into the VERSION slot', () => {
    const { sab, ring } = createSabRing({ payloadCapacity: 64 });
    ring.writeRequest(new Uint8Array([1, 2, 3]));
    const view = new Int32Array(sab, 0, SAB_RING_HEADER_BYTES >> 2);
    expect(Atomics.load(view, VERSION_INDEX)).toBe(SYNC_RPC_PROTOCOL_VERSION);
  });

  it('writeReply stamps the protocol version into the VERSION slot', () => {
    const { sab } = createSabRing({ payloadCapacity: 64 });
    const responder = SabRing.attach(sab, 64);
    responder.writeReply(new Uint8Array([7]));
    const view = new Int32Array(sab, 0, SAB_RING_HEADER_BYTES >> 2);
    expect(Atomics.load(view, VERSION_INDEX)).toBe(SYNC_RPC_PROTOCOL_VERSION);
  });
});

describe('SyncRpc protocol version — consumer-side rejection (ADR-0032)', () => {
  it('readRequest throws SyncRpcProtocolMismatchError when version is forged wrong', () => {
    const { sab, ring: caller } = createSabRing({ payloadCapacity: 64 });
    const responder = SabRing.attach(sab, 64);
    // Manually mimic writeRequest but stamp a wrong version.
    const forgedVersion = SYNC_RPC_PROTOCOL_VERSION + 999;
    caller.writeRequestWithVersion(new Uint8Array([1, 2, 3]), forgedVersion);
    let thrown: unknown = null;
    try {
      responder.readRequest();
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(SyncRpcProtocolMismatchError);
    expect(thrown).toMatchObject({
      code: 'EPROTOVERSION',
      expected: SYNC_RPC_PROTOCOL_VERSION,
      got: forgedVersion,
    });
  });

  it('waitReplyAsync throws SyncRpcProtocolMismatchError when reply carries wrong version', async () => {
    const { sab, ring: caller } = createSabRing({ payloadCapacity: 64 });
    const responder = SabRing.attach(sab, 64);
    caller.writeRequest(new Uint8Array([1]));
    responder.readRequest();
    const forgedVersion = SYNC_RPC_PROTOCOL_VERSION + 17;
    responder.writeReplyWithVersion(new Uint8Array([99]), forgedVersion);
    await expect(caller.waitReplyAsync(1000)).rejects.toBeInstanceOf(SyncRpcProtocolMismatchError);
  });

  it('SyncRpcProtocolMismatchError carries expected, got, and code=EPROTOVERSION', () => {
    const err = new SyncRpcProtocolMismatchError(1, 2);
    expect(err.code).toBe('EPROTOVERSION');
    expect(err.expected).toBe(1);
    expect(err.got).toBe(2);
    expect(err.message).toMatch(/expected 1.*got 2/);
  });
});

describe('SyncRpc protocol version — dispatcher behaviour (ADR-0032)', () => {
  it('dispatcher writes a versioned error reply when a request arrives with a wrong version', async () => {
    const { sab, ring } = createSabRing({ payloadCapacity: 256 });
    const callerView = SabRing.attach(sab, 256);

    const dispatcher = new SyncRpcDispatcher({ pollIntervalMs: 1 });
    dispatcher.register('echo', (p) => p);
    dispatcher.attach(ring);

    const forgedVersion = SYNC_RPC_PROTOCOL_VERSION + 5;
    // Caller writes a request with a bogus version — the dispatcher must
    // (a) reject the payload (do not decode), and (b) write a reply at the
    // version the caller used so the caller can still decode the failure.
    callerView.writeRequestWithVersion(new TextEncoder().encode('garbage-no-json'), forgedVersion);

    // Attach a peer view with the same (forged) expected version so we can
    // read the reply the dispatcher writes back.
    const peer = SabRing.attach(sab, 256, { expectedVersion: forgedVersion });
    const replyBytes = await peer.waitReplyAsync(2000);
    dispatcher.detachAll();
    const reply = JSON.parse(new TextDecoder().decode(replyBytes)) as {
      ok: boolean;
      error?: { code?: string; message?: string };
    };
    expect(reply.ok).toBe(false);
    expect(reply.error?.code).toBe('EPROTOVERSION');
  });
});
