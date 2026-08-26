import { describe, expect, it } from 'vitest';
import { SabRing, createSabRing } from './sab-ring.ts';
import { SyncRpcDispatcher } from './sync-dispatch.ts';
import { FRAME_BINARY, decodeReply, encodeRequest } from './sync-rpc.ts';

function binaryFrame(method: string, payload: Uint8Array): Uint8Array {
  const methodBytes = new TextEncoder().encode(method);
  const frame = new Uint8Array(3 + methodBytes.length + payload.length);
  frame[0] = FRAME_BINARY;
  new DataView(frame.buffer).setUint16(1, methodBytes.length, true);
  frame.set(methodBytes, 3);
  frame.set(payload, 3 + methodBytes.length);
  return frame;
}

async function exchange(
  dispatcher: SyncRpcDispatcher,
  frame: Uint8Array,
): Promise<ReturnType<typeof decodeReply>> {
  const { sab, ring } = createSabRing({ payloadCapacity: 512 });
  const caller = SabRing.attach(sab, 512);
  dispatcher.attach(ring);
  caller.writeRequest(frame);
  dispatcher.pumpOnce(ring);
  const reply = decodeReply(await caller.waitReplyAsync(2_000));
  dispatcher.detachAll();
  return reply;
}

function registerBinary(
  dispatcher: SyncRpcDispatcher,
  method: string,
  handler: (payload: unknown) => unknown,
  decodeBinaryRequest: (payload: Uint8Array) => unknown,
): void {
  const register = dispatcher.register as unknown as (
    name: string,
    semanticHandler: (payload: unknown) => unknown,
    options: { decodeBinaryRequest: (payload: Uint8Array) => unknown },
  ) => void;
  register.call(dispatcher, method, handler, { decodeBinaryRequest });
}

describe('ADR-0366 dispatcher binary request decode seam', () => {
  it('routes JSON and binary payloads through one registered semantic handler', async () => {
    const dispatcher = new SyncRpcDispatcher({ pollIntervalMs: 60_000 });
    const observed: unknown[] = [];
    registerBinary(
      dispatcher,
      'echo',
      (payload) => {
        observed.push(payload);
        return payload;
      },
      (payload) => ({ text: new TextDecoder().decode(payload) }),
    );
    expect(
      await exchange(dispatcher, encodeRequest({ method: 'echo', payload: { n: 1 } })),
    ).toEqual({
      ok: true,
      value: { n: 1 },
    });
    expect(
      await exchange(dispatcher, binaryFrame('echo', new TextEncoder().encode('binary'))),
    ).toEqual({
      ok: true,
      value: { text: 'binary' },
    });
    expect(observed).toEqual([{ n: 1 }, { text: 'binary' }]);
  });

  it('rejects missing/throwing binary decoders before the semantic handler', async () => {
    let handlerCalls = 0;
    const missing = new SyncRpcDispatcher({ pollIntervalMs: 60_000 });
    missing.register('json-only', () => {
      handlerCalls += 1;
      return null;
    });
    expect(await exchange(missing, binaryFrame('json-only', new Uint8Array(0)))).toMatchObject({
      ok: false,
      error: { code: 'ERPCBINARYUNSUPPORTED' },
    });

    const corrupt = new SyncRpcDispatcher({ pollIntervalMs: 60_000 });
    registerBinary(
      corrupt,
      'corrupt',
      () => {
        handlerCalls += 1;
        return null;
      },
      () => {
        throw Object.assign(new TypeError('injected binary payload corruption'), {
          code: 'EBADPAYLOAD',
        });
      },
    );
    expect(await exchange(corrupt, binaryFrame('corrupt', Uint8Array.from([1])))).toMatchObject({
      ok: false,
      error: { name: 'TypeError', code: 'EBADPAYLOAD' },
    });
    expect(handlerCalls).toBe(0);
  });
});
