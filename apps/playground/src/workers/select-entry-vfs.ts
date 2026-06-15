/**
 * Pick the VFS a node-entry child reads against (ADR-0150 D P6a). With
 * `RIFTY_REMOTE_FS=1` the child reads the OWNER store over `fs.*` sync-RPC
 * (`SyncRpcFsSync`); without it, the realm's own (empty) sync mirror — the
 * legacy ENOENT path kept for the page-side per-bin executor + execSync.
 */

import { type SyncCall, SyncRpcFsSync } from '@riftydev/runtime-js';
import type { FsSync } from '@riftydev/vfs';

export interface SelectEntryVfsOpts {
  readonly remoteFs: boolean;
  readonly call: SyncCall | null;
  readonly localVfs: () => FsSync;
}

export function selectEntryVfs(opts: SelectEntryVfsOpts): FsSync {
  if (!opts.remoteFs) return opts.localVfs();
  if (opts.call === null) {
    throw new Error(
      'node-entry: RIFTY_REMOTE_FS=1 but no kernel sync call published — cannot reach the owner store',
    );
  }
  return new SyncRpcFsSync(opts.call);
}
