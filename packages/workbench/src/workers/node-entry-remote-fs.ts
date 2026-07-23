import { type SyncCall, type SyncRpcFsSync, installRemoteSyncFs } from '@riftydev/runtime-js';
import { setSyncMirror } from '@riftydev/vfs/internal';
import { ProjectTerminalFsSync } from './project-terminal-namespace.ts';

/** Install the guest view; return the unrooted relay used by nested sync-RPC children. */
export function installNodeEntryRemoteFs(call: SyncCall, remoteFsRoot?: string): SyncRpcFsSync {
  const relay = installRemoteSyncFs(call);
  if (remoteFsRoot !== undefined) {
    setSyncMirror(new ProjectTerminalFsSync(relay, remoteFsRoot));
  }
  return relay;
}
