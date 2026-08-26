import { FS_RPC_CHUNK } from '@riftydev/runtime-js';
import type { VfsDirent } from '@riftydev/vfs';
import { VfsError } from '@riftydev/vfs';

interface StatShape {
  isFile: boolean;
  isDirectory: boolean;
  size?: number;
  mtime?: number;
}

export interface FsRpcCallRecord {
  method: string;
  payload: unknown;
}

function readHead(bytes: Uint8Array): Uint8Array {
  const first = bytes.subarray(0, FS_RPC_CHUNK);
  const reply = new Uint8Array(8 + first.length);
  new DataView(reply.buffer).setFloat64(0, bytes.length, true);
  reply.set(first, 8);
  return reply;
}

/** Exact owner `fs.*` boundary shared by language-service adapter tests. */
export function makeFakeFsCall(
  files: Map<string, Uint8Array>,
  calls: FsRpcCallRecord[] = [],
): (method: string, payload: unknown) => unknown {
  const dirs = new Set<string>(['/']);
  for (const path of files.keys()) {
    let dir = path.slice(0, path.lastIndexOf('/')) || '/';
    while (dir !== '/' && !dirs.has(dir)) {
      dirs.add(dir);
      dir = dir.slice(0, dir.lastIndexOf('/')) || '/';
    }
    dirs.add(dir);
  }
  const statOf = (path: string): StatShape | null => {
    const bytes = files.get(path);
    if (bytes !== undefined) {
      return { isFile: true, isDirectory: false, size: bytes.length, mtime: 1 };
    }
    if (dirs.has(path)) return { isFile: false, isDirectory: true, size: 0, mtime: 1 };
    return null;
  };
  return (method, payload) => {
    calls.push({ method, payload });
    const request = payload as Record<string, unknown>;
    const path = request.path as string;
    switch (method) {
      case 'fs.exists':
        return statOf(path) !== null;
      case 'fs.statOrNull':
        return statOf(path);
      case 'fs.stat': {
        const stat = statOf(path);
        if (stat === null) throw new VfsError('ENOENT', path);
        return stat;
      }
      case 'fs.readdir': {
        const prefix = path === '/' ? '/' : `${path}/`;
        const seen = new Map<string, VfsDirent>();
        for (const filePath of files.keys()) {
          if (!filePath.startsWith(prefix)) continue;
          const rest = filePath.slice(prefix.length);
          const slash = rest.indexOf('/');
          if (slash === -1) {
            seen.set(rest, { name: rest, isFile: true, isDirectory: false });
          } else {
            const name = rest.slice(0, slash);
            if (!seen.has(name)) {
              seen.set(name, { name, isFile: false, isDirectory: true });
            }
          }
        }
        return [...seen.values()];
      }
      case 'fs.readFileHead': {
        const bytes = files.get(path);
        if (bytes === undefined) {
          throw new VfsError(dirs.has(path) ? 'EISDIR' : 'ENOENT', path);
        }
        return readHead(bytes);
      }
      case 'fs.readChunk': {
        const bytes = files.get(path) ?? new Uint8Array(0);
        const offset = request.offset as number;
        const length = request.length as number;
        if (offset >= bytes.length) return new Uint8Array(0);
        return bytes.subarray(offset, Math.min(bytes.length, offset + length));
      }
      default:
        throw new Error(`fake fs.* call: unexpected method ${method}`);
    }
  };
}
