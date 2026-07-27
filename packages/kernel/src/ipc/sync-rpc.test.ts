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
import {
  FRAME_BINARY,
  FRAME_JSON,
  SYNC_RPC_PROTOCOL_VERSION,
  SyncRpcProtocolMismatchError,
  decodeReply,
  decodeRequest,
  encodeBinaryReply,
  encodeReply,
  encodeRequest,
} from './sync-rpc.ts';

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
    const { sab, ring: caller } = createSabRing({ payloadCapacity: 64 });
    const responder = SabRing.attach(sab, 64);
    caller.writeRequest(new Uint8Array([0]));
    responder.readRequest();
    responder.writeReply(new Uint8Array([7]));
    const view = new Int32Array(sab, 0, SAB_RING_HEADER_BYTES >> 2);
    expect(Atomics.load(view, VERSION_INDEX)).toBe(SYNC_RPC_PROTOCOL_VERSION);
    caller.waitReply(0);
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
    const forgedVersion = SYNC_RPC_PROTOCOL_VERSION + 5;
    const caller = SabRing.attach(sab, 256, { expectedVersion: forgedVersion });

    const dispatcher = new SyncRpcDispatcher({ pollIntervalMs: 1 });
    dispatcher.register('echo', (p) => p);
    dispatcher.attach(ring);

    // Caller writes a request with a bogus version — the dispatcher must
    // (a) reject the payload (do not decode), and (b) write a reply at the
    // version the caller used so the caller can still decode the failure.
    caller.writeRequestWithVersion(new TextEncoder().encode('garbage-no-json'), forgedVersion);
    const replyBytes = await caller.waitReplyAsync(2000);
    dispatcher.detachAll();
    // v2 (ADR-0084 #23): the error reply is a JSON frame — decode through the
    // real decoder which strips the 1-byte discriminator. (The error contract
    // itself is unchanged; only the frame gained a leading byte.)
    const reply = decodeReply(replyBytes);
    expect(reply.ok).toBe(false);
    expect((reply.error as { code?: string } | undefined)?.code).toBe('EPROTOVERSION');
  });
});

describe('SyncRpc v2 binary frame (ADR-0084 #23)', () => {
  it('SYNC_RPC_PROTOCOL_VERSION is bumped to 2 (binary-frame discriminator)', () => {
    expect(SYNC_RPC_PROTOCOL_VERSION).toBe(2);
  });

  it('encodeBinaryReply → decodeReply round-trips arbitrary bytes byte-exact (incl 0xff/0xfe/0x00)', () => {
    const value = Uint8Array.from([0xff, 0xfe, 0x00, 0x01, 0x80, 0x7f]);
    const frame = encodeBinaryReply(value);
    // Leading discriminator byte = BINARY; body is the verbatim bytes.
    expect(frame[0]).toBe(FRAME_BINARY);
    const reply = decodeReply(frame);
    expect(reply.ok).toBe(true);
    expect(reply.value).toBeInstanceOf(Uint8Array);
    expect(Array.from(reply.value as Uint8Array)).toEqual([0xff, 0xfe, 0x00, 0x01, 0x80, 0x7f]);
    // Length is the raw byte count (3 for [0xff,0xfe,0x00]), NOT a UTF-8 inflation.
    expect(
      (decodeReply(encodeBinaryReply(Uint8Array.from([0xff, 0xfe, 0x00]))).value as Uint8Array)
        .length,
    ).toBe(3);
  });

  it('JSON replies still carry the JSON discriminator and decode as values', () => {
    const frame = encodeReply({ ok: true, value: 'hello' });
    expect(frame[0]).toBe(FRAME_JSON);
    expect(decodeReply(frame)).toEqual({ ok: true, value: 'hello' });
  });

  it('a binary (0x01) frame fed to a v1 reader is REJECTED at the version guard, not JSON.parse', async () => {
    // A v1 peer (expectedVersion: 1) reading a v2-stamped binary frame must
    // surface SyncRpcProtocolMismatchError before any decode — never feed a
    // 0x01 body into JSON.parse.
    const { sab } = createSabRing({ payloadCapacity: 64 });
    const responder = SabRing.attach(sab, 64);
    const v1Reader = SabRing.attach(sab, 64, { expectedVersion: 1 });
    v1Reader.writeRequest(new Uint8Array([0]));
    expect(() => responder.readRequest()).toThrow(SyncRpcProtocolMismatchError);
    // Responder stamps v2 (its expectedVersion) and writes a binary frame.
    responder.writeReply(encodeBinaryReply(Uint8Array.from([0xff, 0xfe, 0x00])));
    await expect(v1Reader.waitReplyAsync(1000)).rejects.toBeInstanceOf(
      SyncRpcProtocolMismatchError,
    );
  });

  it('dispatcher emits a binary frame for a Uint8Array handler value (byte-exact)', async () => {
    const { sab, ring } = createSabRing({ payloadCapacity: 256 });
    const caller = SabRing.attach(sab, 256);
    const dispatcher = new SyncRpcDispatcher();
    dispatcher.register('bytes', () => Uint8Array.from([0xff, 0xfe, 0x00]));
    dispatcher.attach(ring);
    caller.writeRequest(encodeReqJson('bytes'));
    const replyBytes = await caller.waitReplyAsync(2000);
    dispatcher.detachAll();
    expect(replyBytes[0]).toBe(FRAME_BINARY);
    const reply = decodeReply(replyBytes);
    expect(Array.from(reply.value as Uint8Array)).toEqual([0xff, 0xfe, 0x00]);
  });
});

describe('SyncRpc JSON-frame decode over a SharedArrayBuffer view (browser SAB path)', () => {
  // Regression: `TextDecoder.decode()` rejects a SharedArrayBuffer-backed view
  // in browsers ("The provided ArrayBufferView value must not be shared") —
  // Node is lax, so the SAB JSON-frame path passed every Node test yet threw
  // the first time it ran in a real cross-origin-isolated Worker (the COI
  // execSync e2e, tests/e2e/execsync-sab.spec.ts). The decoders must copy out
  // of the shared view before decoding. This test feeds a SAB-backed view to
  // assert the decode path never touches a shared buffer with TextDecoder.

  /** Copy `frame` into a SharedArrayBuffer-backed Uint8Array view. */
  function asSharedView(frame: Uint8Array): Uint8Array {
    const sab = new SharedArrayBuffer(frame.byteLength);
    const view = new Uint8Array(sab);
    view.set(frame);
    return view;
  }

  it('decodeReply decodes a JSON reply frame whose body is a shared view', () => {
    const shared = asSharedView(encodeReply({ ok: true, value: { hello: 'world' } }));
    expect(decodeReply(shared)).toEqual({ ok: true, value: { hello: 'world' } });
  });

  it('decodeReply decodes a JSON error reply frame whose body is a shared view', () => {
    const shared = asSharedView(
      encodeReply({ ok: false, error: { name: 'Error', message: 'boom', code: 'ECHILDFAILED' } }),
    );
    const reply = decodeReply(shared);
    expect(reply.ok).toBe(false);
    expect(reply.error).toEqual({ name: 'Error', message: 'boom', code: 'ECHILDFAILED' });
  });

  it('decodeRequest decodes a JSON request frame whose body is a shared view', () => {
    const shared = asSharedView(encodeRequest({ method: 'execSync', payload: { cmd: 'node /x' } }));
    expect(decodeRequest(shared)).toEqual({ method: 'execSync', payload: { cmd: 'node /x' } });
  });
});

describe('SyncRpc error shape — path/errno/syscall fields (child CLI reads owner fs over sync-RPC, ADR-0150)', () => {
  // Regression: errorToShape only copied name/message/code — Node ErrnoException
  // fields (path, errno, syscall) were silently dropped at the dispatcher side,
  // so fs.readFileSync('/missing') over sync-RPC produced err.path === undefined.

  it('encodeReply/decodeReply round-trips path, errno, syscall in error shape', () => {
    const frame = encodeReply({
      ok: false,
      error: {
        name: 'Error',
        message: "ENOENT: no such file or directory, open '/missing'",
        code: 'ENOENT',
        errno: -2,
        syscall: 'open',
        path: '/missing',
      },
    });
    const reply = decodeReply(frame);
    expect(reply.ok).toBe(false);
    expect(reply.error).toEqual({
      name: 'Error',
      message: "ENOENT: no such file or directory, open '/missing'",
      code: 'ENOENT',
      errno: -2,
      syscall: 'open',
      path: '/missing',
    });
  });

  it('dispatcher preserves path/errno/syscall from a thrown ErrnoException through the reply', async () => {
    const { sab, ring } = createSabRing({ payloadCapacity: 512 });
    const caller = SabRing.attach(sab, 512);
    const dispatcher = new SyncRpcDispatcher({ pollIntervalMs: 60_000 });
    dispatcher.register('readFile', () => {
      throw Object.assign(new Error("ENOENT: no such file or directory, open '/missing'"), {
        code: 'ENOENT',
        errno: -2,
        syscall: 'open',
        path: '/missing',
      });
    });
    dispatcher.attach(ring);
    caller.writeRequest(encodeRequest({ method: 'readFile', payload: null }));
    const replyBytes = await caller.waitReplyAsync(2_000);
    dispatcher.detachAll();
    const reply = decodeReply(replyBytes);
    expect(reply.ok).toBe(false);
    expect(reply.error).toMatchObject({
      code: 'ENOENT',
      errno: -2,
      syscall: 'open',
      path: '/missing',
    });
  });

  it('plain Error (no errno fields) still works — no spurious undefined fields', () => {
    const frame = encodeReply({ ok: false, error: { name: 'Error', message: 'boom' } });
    const reply = decodeReply(frame);
    expect(reply.ok).toBe(false);
    expect(reply.error).toEqual({ name: 'Error', message: 'boom' });
    expect((reply.error as Record<string, unknown>).path).toBeUndefined();
    expect((reply.error as Record<string, unknown>).errno).toBeUndefined();
    expect((reply.error as Record<string, unknown>).syscall).toBeUndefined();
  });
});

describe('SyncRpc decode forensics — a garbage frame must say WHAT it saw (CI-flake postmortem)', () => {
  it('decodeReply on an EMPTY frame names the zero length, not "discriminator 0x-1"', () => {
    // A zero-length reply is the double-consume signature (a second consumer
    // reads the slot after REP_LEN was already cleared) — name it as such.
    expect(() => decodeReply(new Uint8Array(0))).toThrow(
      /decodeReply: empty reply frame \(0 bytes\) — reply slot already consumed \(concurrent consumer\?\)/,
    );
  });

  it('decodeReply on an unknown discriminator names the byte and the frame length', () => {
    expect(() => decodeReply(Uint8Array.from([0x7f, 1, 2]))).toThrow(
      /decodeReply: unknown frame discriminator 0x7f \(frame 3 bytes\)/,
    );
  });

  it('decodeRequest on an EMPTY frame names the zero length', () => {
    expect(() => decodeRequest(new Uint8Array(0))).toThrow(
      /decodeRequest: empty request frame \(0 bytes\) — request slot already consumed \(concurrent consumer\?\)/,
    );
  });

  it('decodeRequest on an unknown discriminator names the byte and the frame length', () => {
    expect(() => decodeRequest(Uint8Array.from([0x42, 9]))).toThrow(
      /decodeRequest: expected JSON frame, got discriminator 0x42 \(frame 2 bytes\)/,
    );
  });
});

/** Local helper: encode a JSON request frame the way the client does. */
function encodeReqJson(method: string): Uint8Array {
  const body = new TextEncoder().encode(JSON.stringify({ method, payload: null }));
  const out = new Uint8Array(body.byteLength + 1);
  out[0] = FRAME_JSON;
  out.set(body, 1);
  return out;
}
