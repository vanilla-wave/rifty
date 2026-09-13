/// <reference lib="webworker" />
import { installOpfsFs } from '../../../packages/vfs/src/internal/index.ts';
import { createOwnerVfsAuthority } from '../../../packages/workbench/src/workers/owner-vfs-authority.ts';
import { createWorkbenchProjectStore } from '../../../packages/workbench/src/workers/workbench-project-store.ts';
self.onmessage = async ({ data }: { data: { namespace: string } }) => {
  try {
    const root = await (await navigator.storage.getDirectory()).getDirectoryHandle(data.namespace);
    const { fsSync } = await installOpfsFs(root, { layout: 'replica' });
    try {
      const authority = createOwnerVfsAuthority(fsSync, { initialRoots: ['/'] });
      const store = createWorkbenchProjectStore(authority);
      const { stageId } = await store.beginStage('valid');
      await store.writeStageFile(
        stageId,
        '/source.txt',
        new TextEncoder().encode('materialized by real store'),
      );
      const { revision } = await store.promoteStage({
        stageId,
        projectKey: 'valid',
        definitionIdentity: 'native-valid-definition',
      });
      await store.waitForDurability(revision);
      self.postMessage({ ok: true });
    } finally {
      fsSync.closeAll();
    }
  } catch (error) {
    self.postMessage({ ok: false, error: String(error) });
  }
};
