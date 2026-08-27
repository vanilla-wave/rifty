/**
 * RPC-backed {@link FsSync} for the TS language-service worker (ADR-0150 seam,
 * ADR-0166).
 *
 * The engine ({@link createTsLanguageService}) is FsSync-agnostic — give it ANY
 * `FsSync` and it works. In the kernel-spawned `serve` worker the authoritative
 * VFS lives in the store owner, reached over the EXISTING `fs.*` sync-RPC seam
 * (the same channel rifty's child CLIs use to read the owner store — ADR-0150).
 * We do NOT invent a parallel FS channel: this factory hands back the proven
 * {@link SyncRpcFsSync} from `@riftydev/runtime-js`, which already speaks the
 * exact `fs.*` contract (chunked `fs.readChunk` reassembly keyed by offset,
 * `fs.statOrNull` null-on-ENOENT, `fs.readdir`, …) and is parity-tested there.
 *
 * Constructing `SyncRpcFsSync` is side-effect-free — it is NOT the
 * `installRemoteSyncFs` global-mirror install (that registers a realm-wide
 * `syncMirror`, which the language service must not do — it owns its own engine,
 * not the realm's `node:fs`).
 *
 * `call` is the published in-worker sync-call shim
 * (`readKernelSyncApi().call`); each invocation blocks the worker on
 * `Atomics.wait` until the owner replies, so this is legal only inside a
 * kernel-spawned Worker. In tests a fake `call` serving an in-memory fixture
 * stands in for the owner (the only mocked boundary).
 */

import { type SyncBinaryCall, type SyncCall, SyncRpcFsSync } from '@riftydev/runtime-js';
import type { FsSync } from '@riftydev/vfs';

export type { SyncBinaryCall, SyncCall } from '@riftydev/runtime-js';

/**
 * A synchronous {@link FsSync} whose every method translates to an `fs.*`
 * sync-RPC call against the store owner. Reads pull raw bytes in `FS_RPC_CHUNK`
 * slices keyed by offset and reassemble them; `statSyncOrNull` returns `null`
 * on a genuine miss; `readdirSync`/`existsSync` map 1:1. Delegates to the
 * parity-tested {@link SyncRpcFsSync} so there is ONE implementation of the
 * `fs.*` contract, not two.
 */
export function createRpcFsSync(call: SyncCall, callBinary: SyncBinaryCall): FsSync {
  return new SyncRpcFsSync(call, callBinary);
}
