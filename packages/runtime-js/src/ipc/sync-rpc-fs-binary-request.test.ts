import { SabRing, SyncRpcDispatcher, createSabRing, decodeReply } from '@riftydev/kernel';
import { MemoryFsSync } from '@riftydev/vfs/internal';
import { describe, expect, it, vi } from 'vitest';
import { installRuntimeJsFsHandlers } from './fs-handlers.ts';
import { FS_RPC_CHUNK } from './fs-rpc-protocol.ts';
import { SyncRpcFsSync } from './sync-rpc-fs.ts';

interface BinaryCallRecord {
  readonly method: string;
  readonly payload: Uint8Array;
}

const enc = new TextEncoder();

function pathPayload(path: string): Uint8Array {
  return enc.encode(path);
}

function rangePayload(path: string, offset: number, length: number): Uint8Array {
  const pathBytes = pathPayload(path);
  const payload = new Uint8Array(16 + pathBytes.length);
  const view = new DataView(payload.buffer);
  view.setFloat64(0, offset, true);
  view.setFloat64(8, length, true);
  payload.set(pathBytes, 16);
  return payload;
}

function readHead(bytes: Uint8Array): Uint8Array {
  const first = bytes.subarray(0, FS_RPC_CHUNK);
  const reply = new Uint8Array(8 + first.length);
  new DataView(reply.buffer).setFloat64(0, bytes.length, true);
  reply.set(first, 8);
  return reply;
}

function binaryFrame(method: string, payload: Uint8Array): Uint8Array {
  const methodBytes = enc.encode(method);
  const frame = new Uint8Array(3 + methodBytes.length + payload.length);
  frame[0] = 0x01;
  new DataView(frame.buffer).setUint16(1, methodBytes.length, true);
  frame.set(methodBytes, 3);
  frame.set(payload, 3 + methodBytes.length);
  return frame;
}

async function ownerExchange(
  owner: MemoryFsSync,
  method: string,
  payload: Uint8Array,
): Promise<ReturnType<typeof decodeReply>> {
  const dispatcher = new SyncRpcDispatcher({ pollIntervalMs: 60_000 });
  installRuntimeJsFsHandlers(dispatcher, () => owner);
  const { sab, ring } = createSabRing({ payloadCapacity: 512 });
  const caller = SabRing.attach(sab, 512);
  dispatcher.attach(ring);
  caller.writeRequest(binaryFrame(method, payload));
  dispatcher.pumpOnce(ring);
  const reply = decodeReply(await caller.waitReplyAsync(2_000));
  dispatcher.detachAll();
  return reply;
}

describe('ADR-0366 SyncRpcFsSync binary request route', () => {
  it('uses binary for five hot methods and JSON for readdir plus every mutation', () => {
    const jsonCalls: Array<{ method: string; payload: unknown }> = [];
    const binaryCalls: BinaryCallRecord[] = [];
    const small = enc.encode('small');
    const large = Uint8Array.from({ length: FS_RPC_CHUNK + 1 }, (_, index) => index % 251);
    const syncApi = {
      call(method: string, payload: unknown): unknown {
        jsonCalls.push({ method, payload });
        if (method === 'fs.readdir') return [];
        return null;
      },
      callBinary(method: string, payload: Uint8Array): unknown {
        binaryCalls.push({ method, payload: payload.slice() });
        if (method === 'fs.exists') return true;
        if (method === 'fs.stat') return { isFile: true, isDirectory: false, size: 5 };
        if (method === 'fs.statOrNull') return null;
        if (method === 'fs.readFileHead') {
          return readHead(new TextDecoder().decode(payload) === '/small' ? small : large);
        }
        if (method === 'fs.readChunk') return large.subarray(FS_RPC_CHUNK);
        throw new Error(`unexpected binary method ${method}`);
      },
    };
    const Constructor = SyncRpcFsSync as unknown as new (
      jsonCall: typeof syncApi.call,
      binaryCall: typeof syncApi.callBinary,
    ) => SyncRpcFsSync;
    const LegacyConstructor = SyncRpcFsSync as unknown as new (
      jsonCall: typeof syncApi.call,
    ) => SyncRpcFsSync;
    expect(() => new LegacyConstructor(syncApi.call)).toThrow(/binary.*required|callBinary/i);
    const remote = new Constructor(syncApi.call, syncApi.callBinary);

    expect(remote.existsSync('/exists')).toBe(true);
    expect(remote.statSync('/stát/文件')).toMatchObject({ isFile: true, size: 5 });
    expect(remote.statSyncOrNull('/missing')).toBeNull();
    expect(remote.readFileBytesSync('/small')).toEqual(small);
    expect(remote.readFileBytesSync('/large')).toEqual(large);
    expect(remote.readdirSync('/dir')).toEqual([]);
    remote.writeFileSync('/write', new Uint8Array(0));
    remote.mkdirSync('/mkdir', { recursive: true });
    remote.rmSync('/rm', { recursive: true, force: true });
    remote.renameSync('/from', '/to');
    remote.utimes('/time', 1, 2);
    remote.copyFileSync('/copy-from', '/copy-to');
    remote.cpSync('/tree-from', '/tree-to', { recursive: true });

    expect(binaryCalls).toEqual([
      { method: 'fs.exists', payload: pathPayload('/exists') },
      { method: 'fs.stat', payload: pathPayload('/stát/文件') },
      { method: 'fs.statOrNull', payload: pathPayload('/missing') },
      { method: 'fs.readFileHead', payload: pathPayload('/small') },
      { method: 'fs.readFileHead', payload: pathPayload('/large') },
      {
        method: 'fs.readChunk',
        payload: rangePayload('/large', FS_RPC_CHUNK, 1),
      },
    ]);
    expect(jsonCalls.map(({ method }) => method)).toEqual([
      'fs.readdir',
      'fs.writeChunk',
      'fs.mkdir',
      'fs.rm',
      'fs.rename',
      'fs.utimes',
      'fs.copyFile',
      'fs.cp',
    ]);
  });

  it('decodes five valid owner requests and rejects every corrupt/control binary payload', async () => {
    const owner = new MemoryFsSync();
    const path = '/ünicode/文件.txt';
    owner.mkdirSync('/ünicode', { recursive: true });
    owner.writeFileSync(path, Uint8Array.from([10, 20, 30, 40]));
    const probes = [
      vi.spyOn(owner, 'existsSync'),
      vi.spyOn(owner, 'statSync'),
      vi.spyOn(owner, 'statSyncOrNull'),
      vi.spyOn(owner, 'readFileBytesSync'),
      vi.spyOn(owner, 'readdirSync'),
      vi.spyOn(owner, 'mkdirSync'),
    ];

    expect(await ownerExchange(owner, 'fs.exists', pathPayload(path))).toEqual({
      ok: true,
      value: true,
    });
    expect(await ownerExchange(owner, 'fs.stat', pathPayload(path))).toMatchObject({
      ok: true,
      value: { isFile: true, isDirectory: false, size: 4 },
    });
    expect(await ownerExchange(owner, 'fs.statOrNull', pathPayload('/missing'))).toEqual({
      ok: true,
      value: null,
    });
    expect(await ownerExchange(owner, 'fs.readFileHead', pathPayload(path))).toEqual({
      ok: true,
      value: readHead(Uint8Array.from([10, 20, 30, 40])),
    });
    expect(await ownerExchange(owner, 'fs.readChunk', rangePayload(path, 1, 2))).toEqual({
      ok: true,
      value: Uint8Array.from([20, 30]),
    });
    expect(await ownerExchange(owner, 'fs.readChunk', rangePayload(path, 0, 0))).toEqual({
      ok: true,
      value: new Uint8Array(0),
    });
    expect(await ownerExchange(owner, 'fs.readChunk', rangePayload(path, 0, FS_RPC_CHUNK))).toEqual(
      { ok: true, value: Uint8Array.from([10, 20, 30, 40]) },
    );
    expect(
      await ownerExchange(
        owner,
        'fs.readChunk',
        rangePayload(path, Number.MAX_SAFE_INTEGER, FS_RPC_CHUNK),
      ),
    ).toEqual({ ok: true, value: new Uint8Array(0) });
    const callsAfterValid = probes.map(({ mock }) => mock.calls.length);

    const invalidRangeNumbers = [
      Number.NaN,
      Number.POSITIVE_INFINITY,
      -1,
      1.5,
      Number.MAX_SAFE_INTEGER + 1,
    ];
    const corrupt: ReadonlyArray<readonly [string, Uint8Array, RegExp]> = [
      ['fs.stat', Uint8Array.from([0xff]), /fs binary path.*utf/i],
      ['fs.readChunk', new Uint8Array(15), /fs binary range.*16/i],
      ...invalidRangeNumbers.map(
        (value) => ['fs.readChunk', rangePayload('/x', value, 1), /offset.*safe integer/i] as const,
      ),
      ...invalidRangeNumbers.map(
        (value) => ['fs.readChunk', rangePayload('/x', 0, value), /length.*safe integer/i] as const,
      ),
      [
        'fs.readChunk',
        rangePayload('/x', 0, FS_RPC_CHUNK + 1),
        /length.*FS_RPC_CHUNK|length.*262144/i,
      ],
      [
        'fs.readChunk',
        Uint8Array.from([...rangePayload('', 0, 1).subarray(0, 16), 0xff]),
        /fs binary range.*utf|path.*utf/i,
      ],
    ];
    for (const [method, payload, message] of corrupt) {
      const reply = await ownerExchange(owner, method, payload);
      expect(reply).toMatchObject({ ok: false, error: { name: 'TypeError' } });
      expect(reply.error?.message).toMatch(message);
    }
    for (const method of ['fs.readdir', 'fs.mkdir']) {
      expect(await ownerExchange(owner, method, pathPayload('/control'))).toMatchObject({
        ok: false,
        error: { code: 'ERPCBINARYUNSUPPORTED' },
      });
    }
    expect(probes.map(({ mock }) => mock.calls.length)).toEqual(callsAfterValid);
  });
});
