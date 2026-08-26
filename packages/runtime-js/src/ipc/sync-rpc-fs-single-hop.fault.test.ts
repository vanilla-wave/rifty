import { type VfsErrorCode, VfsError } from '@riftydev/vfs';
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from '../builtins/fs.ts';
import { resetSyncMirror } from '../builtins/fs-sync-mirror.ts';
import { FS_RPC_CHUNK } from './fs-rpc-protocol.ts';
import { SyncRpcFsSync, installRemoteSyncFs } from './sync-rpc-fs.ts';

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

function transportedVfsError(code: VfsErrorCode, path: string): Error {
  return Object.assign(new Error(`${code}: ${path}`), {
    name: 'VfsError',
    code,
    path,
  });
}

afterEach(() => resetSyncMirror());

describe('ADR-0365 read-head fault boundary', () => {
  it('rejects every malformed head before allocation or continuation', () => {
    const corrupt: ReadonlyArray<[string, unknown]> = [
      ['undefined', undefined],
      ['non-bytes', null],
      ['boolean', true],
      ['number', 8],
      ['string', 'bytes'],
      ['array', [0, 0, 0, 0, 0, 0, 0, 0]],
      ['object', {}],
      ['array buffer', new ArrayBuffer(HEAD_BYTES)],
      ['truncated header', new Uint8Array(HEAD_BYTES - 1)],
      ['NaN size', head(Number.NaN)],
      ['infinite size', head(Number.POSITIVE_INFINITY)],
      ['fractional size', head(1.5, new Uint8Array(1))],
      ['negative size', head(-1)],
      ['unsafe size', head(Number.MAX_SAFE_INTEGER + 1)],
      ['safe enormous short body', head(Number.MAX_SAFE_INTEGER)],
      ['zero extra body', head(0, new Uint8Array(1))],
      ['short body', head(2, new Uint8Array(1))],
      ['extra body', head(1, new Uint8Array(2))],
      ['short boundary head', head(FS_RPC_CHUNK, new Uint8Array(FS_RPC_CHUNK - 1))],
      ['extra boundary head', head(FS_RPC_CHUNK, new Uint8Array(FS_RPC_CHUNK + 1))],
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

  it('rehydrates transport VfsError identity before public node:fs shaping', () => {
    const cases: ReadonlyArray<{
      code: VfsErrorCode;
      path: string;
      errno: number;
      syscall: string;
      publicPath?: string;
      publicMessage: string;
    }> = [
      {
        code: 'ENOENT',
        path: '/missing.txt',
        errno: -2,
        syscall: 'open',
        publicPath: '/missing.txt',
        publicMessage: "ENOENT: no such file or directory, open '/missing.txt'",
      },
      {
        code: 'EISDIR',
        path: '/dir',
        errno: -21,
        syscall: 'read',
        publicMessage: 'EISDIR: illegal operation on a directory, read',
      },
      {
        code: 'ENOTDIR',
        path: '/plain.txt/child',
        errno: -20,
        syscall: 'open',
        publicPath: '/plain.txt/child',
        publicMessage: "ENOTDIR: not a directory, open '/plain.txt/child'",
      },
    ];

    for (const fixture of cases) {
      const call = (): never => {
        throw transportedVfsError(fixture.code, fixture.path);
      };
      const remoteError = caught(() => new SyncRpcFsSync(call).readFileBytesSync(fixture.path));
      expect(remoteError).toBeInstanceOf(VfsError);
      expect(remoteError).toMatchObject({
        name: 'VfsError',
        code: fixture.code,
        path: fixture.path,
        message: `${fixture.code}: ${fixture.path}`,
      });

      installRemoteSyncFs(call);
      const publicError = caught(() => readFileSync(fixture.path));
      expect(publicError).not.toBeInstanceOf(VfsError);
      expect(publicError).toMatchObject({
        name: 'Error',
        code: fixture.code,
        errno: fixture.errno,
        syscall: fixture.syscall,
        message: fixture.publicMessage,
      });
      expect((publicError as NodeJS.ErrnoException).path).toBe(fixture.publicPath);
    }
  });
});
