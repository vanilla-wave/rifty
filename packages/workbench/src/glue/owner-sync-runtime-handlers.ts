import type { SyncRpcDispatcher } from '@riftydev/kernel';
import { installRuntimeJsFsHandlers } from '@riftydev/runtime-js';
import {
  type InstallRuntimeJsExecSyncOptions,
  installRuntimeJsExecSyncHandler,
} from '@riftydev/runtime-js/ipc/exec-sync-handler';
import type { FsSync, VfsMutationGuard } from '@riftydev/vfs';

interface OwnerSyncRuntimeExecOptions {
  readonly getVfs?: () => FsSync;
  readonly runWorker?: NonNullable<InstallRuntimeJsExecSyncOptions['runWorker']>;
}

/** Serve one authoritative VFS to child fs calls and recursive node execution. */
export function installOwnerSyncRuntimeHandlers(
  dispatcher: SyncRpcDispatcher,
  getVfs: () => FsSync,
  mutationGuard?: VfsMutationGuard,
  execSync: OwnerSyncRuntimeExecOptions = {},
): void {
  const getExecSyncVfs = execSync.getVfs ?? getVfs;
  installRuntimeJsFsHandlers(dispatcher, getVfs, mutationGuard);
  installRuntimeJsExecSyncHandler(
    dispatcher,
    (path) => {
      const vfs = getExecSyncVfs();
      return vfs.existsSync(path) ? vfs.readFileBytesSync(path) : null;
    },
    execSync.runWorker === undefined ? {} : { runWorker: execSync.runWorker },
  );
}
