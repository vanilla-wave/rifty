/**
 * Owner-side `fs.*` sync-RPC handlers (ADR-0150 D P6a). Mirror of
 * `installRuntimeJsExecSyncHandler`: register handlers on the kernel dispatcher
 * that read/write the owner's `syncMirror()` so a supervised child reads the
 * one owned store. Reads reply with raw bytes (binary frame); writes accept
 * base64 (JSON request frame). Both chunk under the 1 MiB ring.
 */

import type { SyncRpcDispatcher } from '@riftydev/kernel';
import type { FsSync, VfsDirent } from '@riftydev/vfs';
import { FS_METHODS, type FsStatShape, base64ToBytes } from './fs-rpc-protocol.ts';

export type VfsAccessor = () => FsSync;

type Req = Record<string, unknown>;
const str = (r: Req, k: string): string => {
  const v = r[k];
  if (typeof v !== 'string') throw new TypeError(`fs handler: ${k} must be a string`);
  return v;
};
const num = (r: Req, k: string): number => {
  const v = r[k];
  if (typeof v !== 'number') throw new TypeError(`fs handler: ${k} must be a number`);
  return v;
};
const obj = (v: unknown): Req => {
  if (typeof v !== 'object' || v === null)
    throw new TypeError('fs handler: payload must be an object');
  return v as Req;
};

/**
 * Register all `fs.*` sync-RPC handlers on `dispatcher`. The `getVfs` accessor
 * is called per-request so the owner can swap the mirror after boot without
 * re-registering. TSDoc mirrors `FsSync` — see `@riftydev/vfs` for contracts.
 */
export function installRuntimeJsFsHandlers(
  dispatcher: SyncRpcDispatcher,
  getVfs: VfsAccessor,
): void {
  dispatcher.register(FS_METHODS.exists, (p) => getVfs().existsSync(str(obj(p), 'path')));
  // TODO(backlog: runtime-js/child-remote-fs-fidelity) — gratuitous async; sync statSync left untested by the loopback
  dispatcher.register(
    FS_METHODS.stat,
    async (p) => getVfs().statSync(str(obj(p), 'path')) as FsStatShape,
  );
  dispatcher.register(
    FS_METHODS.statOrNull,
    (p) => getVfs().statSyncOrNull(str(obj(p), 'path')) as FsStatShape | null,
  );
  dispatcher.register(FS_METHODS.readdir, (p): VfsDirent[] => [
    ...getVfs().readdirSync(str(obj(p), 'path')),
  ]);

  // Binary reply: ranged slice of the cached buffer (O(1) subarray reference).
  // TODO(backlog: perf/fs-rpc-chunk-perf) — readFileBytesSync re-reads the whole file per chunk → O(N²)
  dispatcher.register(FS_METHODS.readChunk, (p): Uint8Array => {
    const r = obj(p);
    const path = str(r, 'path');
    const offset = num(r, 'offset');
    const length = num(r, 'length');
    const bytes = getVfs().readFileBytesSync(path);
    if (offset >= bytes.length) return new Uint8Array(0);
    return bytes.subarray(offset, Math.min(bytes.length, offset + length));
  });

  // Write: truncate creates/replaces; subsequent chunks append.
  // TODO(backlog: perf/fs-rpc-chunk-perf) — append reads prev+concat+writes per chunk → O(N²); base64 inflation
  dispatcher.register(FS_METHODS.writeChunk, (p): null => {
    const r = obj(p);
    const path = str(r, 'path');
    const incoming = base64ToBytes(str(r, 'b64'));
    const truncate = r.truncate === true;
    const vfs = getVfs();
    if (truncate) {
      vfs.writeFileSync(path, incoming);
    } else {
      const prev = vfs.existsSync(path) ? vfs.readFileBytesSync(path) : new Uint8Array(0);
      const merged = new Uint8Array(prev.length + incoming.length);
      merged.set(prev);
      merged.set(incoming, prev.length);
      vfs.writeFileSync(path, merged);
    }
    return null;
  });

  dispatcher.register(FS_METHODS.mkdir, (p): null => {
    const r = obj(p);
    getVfs().mkdirSync(str(r, 'path'), { recursive: r.recursive === true });
    return null;
  });
  dispatcher.register(FS_METHODS.rm, (p): null => {
    const r = obj(p);
    getVfs().rmSync(str(r, 'path'), { recursive: r.recursive === true, force: r.force === true });
    return null;
  });
  dispatcher.register(FS_METHODS.rename, (p): null => {
    const r = obj(p);
    getVfs().renameSync(str(r, 'src'), str(r, 'dst'));
    return null;
  });
  dispatcher.register(FS_METHODS.utimes, (p): null => {
    const r = obj(p);
    getVfs().utimes(str(r, 'path'), num(r, 'atimeMs'), num(r, 'mtimeMs'));
    return null;
  });
  dispatcher.register(FS_METHODS.copyFile, (p): null => {
    const r = obj(p);
    getVfs().copyFileSync(str(r, 'src'), str(r, 'dst'));
    return null;
  });
  dispatcher.register(FS_METHODS.cp, (p): null => {
    const r = obj(p);
    getVfs().cpSync(str(r, 'src'), str(r, 'dst'), { recursive: r.recursive === true });
    return null;
  });
}
