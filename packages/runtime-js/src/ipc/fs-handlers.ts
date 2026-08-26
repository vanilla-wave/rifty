/**
 * Owner-side `fs.*` sync-RPC handlers (ADR-0150): supervised child CLIs read
 * the single owned store over sync-RPC; owner stays a free async supervisor.
 * Mirror of
 * `installRuntimeJsExecSyncHandler`: register handlers on the kernel dispatcher
 * that read/write the owner's `syncMirror()` so a supervised child reads the
 * one owned store. Reads reply with raw bytes (binary frame); writes accept
 * base64 (JSON request frame). Both chunk under the 1 MiB ring.
 */

import type { SyncRpcDispatcher } from '@riftydev/kernel';
import {
  type FsSync,
  type VfsDirent,
  type VfsMutationGuard,
  type VfsMutationIntent,
  guardVfsMutations,
} from '@riftydev/vfs';
import {
  FS_METHODS,
  type FsStatShape,
  base64ToBytes,
  decodeFsPathRequest,
  decodeFsReadRangeRequest,
  encodeReadFileHead,
} from './fs-rpc-protocol.ts';

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

function applyMutation(
  guard: VfsMutationGuard | undefined,
  intent: VfsMutationIntent,
  apply: () => void,
): null | Promise<null> {
  return guardVfsMutations(guard, [intent], () => {
    apply();
    return null;
  });
}

/**
 * Register all `fs.*` sync-RPC handlers on `dispatcher`. The `getVfs` accessor
 * is called per-request so the owner can swap the mirror after boot without
 * re-registering. `mutationGuard` lets the host serialize writes with its own
 * policy; it receives the shared path-only intent and the real handler body.
 * TSDoc mirrors `FsSync` — see `@riftydev/vfs` for contracts.
 */
export function installRuntimeJsFsHandlers(
  dispatcher: SyncRpcDispatcher,
  getVfs: VfsAccessor,
  mutationGuard?: VfsMutationGuard,
): void {
  dispatcher.register(FS_METHODS.exists, (p) => getVfs().existsSync(str(obj(p), 'path')), {
    decodeBinaryRequest: decodeFsPathRequest,
  });
  dispatcher.register(
    FS_METHODS.stat,
    (p) => getVfs().statSync(str(obj(p), 'path')) as FsStatShape,
    { decodeBinaryRequest: decodeFsPathRequest },
  );
  dispatcher.register(
    FS_METHODS.statOrNull,
    (p) => getVfs().statSyncOrNull(str(obj(p), 'path')) as FsStatShape | null,
    { decodeBinaryRequest: decodeFsPathRequest },
  );
  dispatcher.register(FS_METHODS.readdir, (p): VfsDirent[] => [
    ...getVfs().readdirSync(str(obj(p), 'path')),
  ]);

  // One current owner read carries total size + first chunk (ADR-0365).
  dispatcher.register(
    FS_METHODS.readFileHead,
    (p): Uint8Array => encodeReadFileHead(getVfs().readFileBytesSync(str(obj(p), 'path'))),
    { decodeBinaryRequest: decodeFsPathRequest },
  );

  // Binary reply: ranged slice of the cached buffer (O(1) subarray reference).
  // TODO(backlog: perf/fs-rpc-chunk-perf) — readFileBytesSync re-reads the whole file per chunk → O(N²)
  dispatcher.register(
    FS_METHODS.readChunk,
    (p): Uint8Array => {
      const r = obj(p);
      const path = str(r, 'path');
      const offset = num(r, 'offset');
      const length = num(r, 'length');
      const bytes = getVfs().readFileBytesSync(path);
      if (offset >= bytes.length) return new Uint8Array(0);
      return bytes.subarray(offset, Math.min(bytes.length, offset + length));
    },
    { decodeBinaryRequest: decodeFsReadRangeRequest },
  );

  // Write: truncate creates/replaces; subsequent chunks append.
  // TODO(backlog: perf/fs-rpc-chunk-perf) — append reads prev+concat+writes per chunk → O(N²); base64 inflation
  dispatcher.register(FS_METHODS.writeChunk, (p): null | Promise<null> => {
    const r = obj(p);
    const path = str(r, 'path');
    const incoming = base64ToBytes(str(r, 'b64'));
    const truncate = r.truncate === true;
    return applyMutation(mutationGuard, { kind: 'write', path }, () => {
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
    });
  });

  dispatcher.register(FS_METHODS.mkdir, (p): null | Promise<null> => {
    const r = obj(p);
    const path = str(r, 'path');
    const recursive = r.recursive === true;
    return applyMutation(mutationGuard, { kind: 'mkdir', path }, () => {
      getVfs().mkdirSync(path, { recursive });
    });
  });
  dispatcher.register(FS_METHODS.rm, (p): null | Promise<null> => {
    const r = obj(p);
    const path = str(r, 'path');
    const recursive = r.recursive === true;
    const force = r.force === true;
    return applyMutation(mutationGuard, { kind: 'rm', path }, () => {
      getVfs().rmSync(path, { recursive, force });
    });
  });
  dispatcher.register(FS_METHODS.rename, (p): null | Promise<null> => {
    const r = obj(p);
    const sourcePath = str(r, 'src');
    const targetPath = str(r, 'dst');
    return applyMutation(mutationGuard, { kind: 'rename', sourcePath, targetPath }, () => {
      getVfs().renameSync(sourcePath, targetPath);
    });
  });
  dispatcher.register(FS_METHODS.utimes, (p): null | Promise<null> => {
    const r = obj(p);
    const path = str(r, 'path');
    const atimeMs = num(r, 'atimeMs');
    const mtimeMs = num(r, 'mtimeMs');
    return applyMutation(mutationGuard, { kind: 'utimes', path }, () => {
      getVfs().utimes(path, atimeMs, mtimeMs);
    });
  });
  dispatcher.register(FS_METHODS.copyFile, (p): null | Promise<null> => {
    const r = obj(p);
    const sourcePath = str(r, 'src');
    const targetPath = str(r, 'dst');
    return applyMutation(mutationGuard, { kind: 'copy', sourcePath, targetPath }, () => {
      getVfs().copyFileSync(sourcePath, targetPath);
    });
  });
  dispatcher.register(FS_METHODS.cp, (p): null | Promise<null> => {
    const r = obj(p);
    const sourcePath = str(r, 'src');
    const targetPath = str(r, 'dst');
    const recursive = r.recursive === true;
    return applyMutation(mutationGuard, { kind: 'copy', sourcePath, targetPath }, () => {
      getVfs().cpSync(sourcePath, targetPath, { recursive });
    });
  });
}
