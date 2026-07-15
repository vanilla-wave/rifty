import type { SyncRpcDispatcher } from '@riftydev/kernel';
import { installRuntimeJsFsHandlers } from '@riftydev/runtime-js';
import { installRuntimeJsExecSyncHandler } from '@riftydev/runtime-js/ipc/exec-sync-handler';
import type { FsSync, VfsMutationGuard } from '@riftydev/vfs';

/** Serve one authoritative VFS to child fs calls and recursive node execution. */
export function installOwnerSyncRuntimeHandlers(
  dispatcher: SyncRpcDispatcher,
  getVfs: () => FsSync,
  mutationGuard?: VfsMutationGuard,
): void {
  installRuntimeJsFsHandlers(dispatcher, getVfs, mutationGuard);
  installRuntimeJsExecSyncHandler(dispatcher, (path) => {
    const vfs = getVfs();
    return vfs.existsSync(path) ? vfs.readFileBytesSync(path) : null;
  });
}
