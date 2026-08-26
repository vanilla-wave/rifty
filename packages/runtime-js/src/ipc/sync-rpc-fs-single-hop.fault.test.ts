import { describe, expect, it } from 'vitest';
import { FS_RPC_CHUNK } from './fs-rpc-protocol.ts';
import { SyncRpcFsSync } from './sync-rpc-fs.ts';

const HEAD_BYTES = 8;

function head(totalSize: number, bytes = new Uint8Array(0)): Uint8Array {
  const reply = new Uint8Array(HEAD_BYTES + bytes.length);
  new DataView(reply.buffer).setFloat64(0, totalSize, true);
  reply.set(bytes, HEAD_BYTES);
  return reply;
}

function caught(read: () => unknown): Error {
  try {
    read();
  } catch (error) {
    return error as Error;
  }
  throw new Error('expected read to reject');
}

describe('ADR-0365 read-head fault boundary', () => {
  it('rejects every malformed head before allocation or continuation', () => {
    const corrupt: ReadonlyArray<[string, unknown]> = [
      ['non-bytes', null],
      ['object', {}],
      ['array buffer', new ArrayBuffer(HEAD_BYTES)],
      ['truncated header', new Uint8Array(HEAD_BYTES - 1)],
      ['NaN size', head(Number.NaN)],
      ['fractional size', head(1.5, new Uint8Array(1))],
      ['negative size', head(-1)],
      ['unsafe size', head(Number.MAX_SAFE_INTEGER + 1)],
      ['safe enormous short body', head(Number.MAX_SAFE_INTEGER)],
      ['short body', head(2, new Uint8Array(1))],
      ['extra body', head(1, new Uint8Array(2))],
      ['short full head', head(FS_RPC_CHUNK + 1, new Uint8Array(FS_RPC_CHUNK - 1))],
      ['extra full head', head(FS_RPC_CHUNK + 1, new Uint8Array(FS_RPC_CHUNK + 1))],
    ];

    for (const [label, reply] of corrupt) {
      const calls: string[] = [];
      const remote = new SyncRpcFsSync((method) => {
        calls.push(method);
        if (method !== 'fs.readFileHead') throw new Error(`unexpected method ${method}`);
        return reply;
      });
      const error = caught(() => remote.readFileBytesSync(`/corrupt-${label}`));
      expect(error, label).toBeInstanceOf(TypeError);
      expect(error.message, label).toMatch(/read head|head reply/i);
      expect(calls, label).toEqual(['fs.readFileHead']);
    }
  });

  it.each([
    ['short', new Uint8Array(0), /short read/i],
    ['oversized', new Uint8Array(6), /oversized read/i],
  ] as const)(
    'rejects a %s continuation after one valid full head',
    (_label, continuation, message) => {
      const calls: Array<{ method: string; payload: unknown }> = [];
      const remote = new SyncRpcFsSync((method, payload) => {
        calls.push({ method, payload });
        if (method === 'fs.readFileHead') {
          return head(FS_RPC_CHUNK + 5, new Uint8Array(FS_RPC_CHUNK));
        }
        if (method === 'fs.readChunk') return continuation;
        throw new Error(`unexpected method ${method}`);
      });

      expect(() => remote.readFileBytesSync('/changing.bin')).toThrow(message);
      expect(calls).toEqual([
        { method: 'fs.readFileHead', payload: { path: '/changing.bin' } },
        {
          method: 'fs.readChunk',
          payload: { path: '/changing.bin', offset: FS_RPC_CHUNK, length: 5 },
        },
      ]);
    },
  );
});
