import type { SyncRpcDispatcher } from '@riftydev/kernel';
import { installRuntimeJsFsHandlers } from '@riftydev/runtime-js';
import {
  type InstallRuntimeJsExecSyncOptions,
  installRuntimeJsExecSyncHandler,
} from '@riftydev/runtime-js/ipc/exec-sync-handler';
import type { FsSync, VfsMutationGuard } from '@riftydev/vfs';

export interface OwnerSyncRuntimeHandlerOptions {
  readonly mutationGuard?: VfsMutationGuard;
  /** Guest-logical preflight view; nested fs relay may intentionally stay physical. */
  readonly execSyncVfs?: () => FsSync;
  readonly execSync?: InstallRuntimeJsExecSyncOptions;
}

/** Serve one authoritative VFS to child fs calls and recursive node execution. */
export function installOwnerSyncRuntimeHandlers(
  dispatcher: SyncRpcDispatcher,
  getVfs: () => FsSync,
  options: OwnerSyncRuntimeHandlerOptions = {},
): void {
  installRuntimeJsFsHandlers(dispatcher, getVfs, options.mutationGuard);
  installRuntimeJsExecSyncHandler(
    dispatcher,
    (path) => {
      const vfs = (options.execSyncVfs ?? getVfs)();
      return vfs.existsSync(path) ? vfs.readFileBytesSync(path) : null;
    },
    options.execSync,
  );
}
