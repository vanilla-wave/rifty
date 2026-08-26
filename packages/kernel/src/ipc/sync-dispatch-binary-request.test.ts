import { describe, expect, it } from 'vitest';
import { SabRing, createSabRing } from './sab-ring.ts';
import { type SyncRpcCallerContext, SyncRpcDispatcher } from './sync-dispatch.ts';
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
  context: SyncRpcCallerContext = {},
): Promise<ReturnType<typeof decodeReply>> {
  const { sab, ring } = createSabRing({ payloadCapacity: 512 });
  const caller = SabRing.attach(sab, 512);
  dispatcher.attach(ring, context);
  caller.writeRequest(frame);
  dispatcher.pumpOnce(ring);
  const reply = decodeReply(await caller.waitReplyAsync(2_000));
  dispatcher.detachAll();
  return reply;
}

function registerBinary(
  dispatcher: SyncRpcDispatcher,
  method: string,
  handler: (payload: unknown, context?: SyncRpcCallerContext) => unknown,
  decodeBinaryRequest: (payload: Uint8Array) => unknown,
): void {
  const register = dispatcher.register as unknown as (
    name: string,
    semanticHandler: (payload: unknown, context?: SyncRpcCallerContext) => unknown,
    options: { decodeBinaryRequest: (payload: Uint8Array) => unknown },
  ) => void;
  register.call(dispatcher, method, handler, { decodeBinaryRequest });
}

describe('ADR-0366 dispatcher binary request decode seam', () => {
  it('routes JSON and binary payloads through one registered semantic handler', async () => {
    const dispatcher = new SyncRpcDispatcher({ pollIntervalMs: 60_000 });
    const observed: Array<{ payload: unknown; callerPid: number | undefined }> = [];
    registerBinary(
      dispatcher,
      'echo',
      async (payload, context) => {
        observed.push({ payload, callerPid: context?.callerPid });
        await Promise.resolve();
        return payload;
      },
      (payload) => ({ text: new TextDecoder().decode(payload) }),
    );
    expect(
      await exchange(dispatcher, encodeRequest({ method: 'echo', payload: { n: 1 } }), {
        callerPid: 11,
      }),
    ).toEqual({
      ok: true,
      value: { n: 1 },
    });
    expect(
      await exchange(dispatcher, binaryFrame('echo', new TextEncoder().encode('binary')), {
        callerPid: 12,
      }),
    ).toEqual({
      ok: true,
      value: { text: 'binary' },
    });
    expect(
      await exchange(
        dispatcher,
        encodeRequest({
          method: 'echo',
          payload: { spoof: 'json-stays-json' },
          binary: true,
        } as never),
        { callerPid: 13 },
      ),
    ).toEqual({ ok: true, value: { spoof: 'json-stays-json' } });
    expect(observed).toEqual([
      { payload: { n: 1 }, callerPid: 11 },
      { payload: { text: 'binary' }, callerPid: 12 },
      { payload: { spoof: 'json-stays-json' }, callerPid: 13 },
    ]);
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
    expect(await exchange(missing, binaryFrame('unknown', new Uint8Array(0)))).toMatchObject({
      ok: false,
      error: { code: 'ERPCNOHANDLER' },
    });
    expect(await exchange(missing, Uint8Array.from([FRAME_BINARY]))).toMatchObject({
      ok: false,
      error: { name: 'TypeError', message: expect.stringMatching(/binary request/i) },
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

    const handlerFailure = new SyncRpcDispatcher({ pollIntervalMs: 60_000 });
    registerBinary(
      handlerFailure,
      'handler-failure',
      () => {
        handlerCalls += 1;
        throw Object.assign(new Error('injected binary handler failure'), { code: 'EHANDLER' });
      },
      (payload) => payload,
    );
    expect(
      await exchange(handlerFailure, binaryFrame('handler-failure', Uint8Array.from([1]))),
    ).toMatchObject({ ok: false, error: { code: 'EHANDLER' } });

    const asyncFailure = new SyncRpcDispatcher({ pollIntervalMs: 60_000 });
    registerBinary(
      asyncFailure,
      'async-failure',
      async () => {
        handlerCalls += 1;
        await Promise.resolve();
        throw Object.assign(new Error('injected async binary handler failure'), {
          code: 'EASYNCBINARY',
        });
      },
      (payload) => payload,
    );
    expect(
      await exchange(asyncFailure, binaryFrame('async-failure', Uint8Array.from([1]))),
    ).toMatchObject({ ok: false, error: { code: 'EASYNCBINARY' } });

    const replaced = new SyncRpcDispatcher({ pollIntervalMs: 60_000 });
    registerBinary(
      replaced,
      'replace',
      () => null,
      (payload) => payload,
    );
    replaced.register('replace', () => {
      handlerCalls += 1;
      return null;
    });
    expect(await exchange(replaced, binaryFrame('replace', new Uint8Array(0)))).toMatchObject({
      ok: false,
      error: { code: 'ERPCBINARYUNSUPPORTED' },
    });
    expect(handlerCalls).toBe(2);
  });
});
