import {
  type SyncBinaryCall,
  type SyncCall,
  type SyncRpcFsSync,
  installRemoteSyncFs,
} from '@riftydev/runtime-js';
import { setSyncMirror } from '@riftydev/vfs/internal';
import { createGuestLayout } from './guest-layout.ts';
import { ProjectTerminalFsSync } from './project-terminal-namespace.ts';

/** Install the guest view; return the unrooted relay used by nested sync-RPC children. */
export function installNodeEntryRemoteFs(
  call: SyncCall,
  callBinary: SyncBinaryCall,
  remoteFsRoot?: string,
  publicRoot?: string,
): SyncRpcFsSync {
  const relay = installRemoteSyncFs(call, callBinary);
  if (remoteFsRoot !== undefined && publicRoot !== undefined) {
    setSyncMirror(new ProjectTerminalFsSync(relay, createGuestLayout(publicRoot, remoteFsRoot)));
  }
  return relay;
}
