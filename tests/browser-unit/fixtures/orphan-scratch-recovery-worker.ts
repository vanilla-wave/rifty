/// <reference lib="webworker" />
import { installOpfsFs, setSyncMirror } from '@riftydev/vfs/internal';
import { SyncMirrorVfs } from '../../../packages/workbench/src/glue/sync-mirror-vfs.ts';
import { definePlaygroundProject } from '../../../packages/workbench/src/workbench/internal/playground-project-definition.ts';
import { createOwnerPackageState } from '../../../packages/workbench/src/workers/owner-package-state.ts';
import { createOwnerVfsAuthorityComposition } from '../../../packages/workbench/src/workers/owner-vfs-authority.ts';
import { createPlaygroundProjectAuthority } from '../../../packages/workbench/src/workers/playground-project-authority.ts';
import { workbenchFirstMaterializationPackageConfig } from '../../../packages/workbench/src/workers/workbench-package-config.ts';
import {
  type NativeFault,
  custody,
  installNativeBoundary,
} from './orphan-scratch-recovery-boundary.ts';
import { type RetainedCatalog, recoveryNamespace } from './orphan-scratch-recovery-data.ts';

declare const self: DedicatedWorkerGlobalScope;
export interface RecoveryRequest {
  readonly phase: 'victim' | 'verify' | 'export';
  readonly fault?: NativeFault;
}

async function run(input: RecoveryRequest) {
  const boundary = await installNativeBoundary(input.fault, async (checkpoint) => {
    self.postMessage({ kind: 'paused', checkpoint, custody: await custody() });
  });
  const root = await navigator.storage
    .getDirectory()
    .then((origin) => origin.getDirectoryHandle(recoveryNamespace));
  const pair = await installOpfsFs(root);
  const composition = createOwnerVfsAuthorityComposition(pair.fsSync, {
    initialRoots: ['/', '/.rifty'],
  });
  const vfs = new SyncMirrorVfs();
  setSyncMirror(composition.authority, { async: vfs });
  const packages = createOwnerPackageState({
    vfs,
    fsSync: composition.authority,
    installStampClaims: composition.installStampClaims,
    flush: () => composition.authority.flush(),
    nodeWorkerRuntimeEnv: {},
    log: () => {},
  });
  const owner = await createPlaygroundProjectAuthority({
    ...composition,
    persistence: 'required',
    now: () => '2026-09-09T00:00:00.000Z',
    createStageId: () => crypto.randomUUID(),
    acquisition: {
      ensure: (request) =>
        packages.activateAndEnsure(
          workbenchFirstMaterializationPackageConfig(request, composition.authority),
          request.snapshotAdmission,
        ),
    },
    projectSave: packages,
  });
  const retained = owner as unknown as RetainedCatalog;
  const origin = new URL(self.location.href).origin;
  const definition = definePlaygroundProject(
    {
      kind: 'node-cli',
      id: 'scratch',
      starterId: 'orphan-fresh',
      templateId: 'orphan-fresh',
      entryPath: '/main.cjs',
      files: {
        '/package.json': '{"name":"orphan-fresh","private":true}',
        '/main.cjs': 'console.log("fresh");\n',
        '/fresh.txt': 'fresh Scratch\n',
      },
      firstMaterialization: { kind: 'install' },
    },
    { apiBaseUrl: `${origin}/`, clientUrl: `${origin}/unit-harness.html` },
  );
  let outcome: Record<string, unknown>;
  try {
    if (input.phase === 'victim') boundary.arm();
    const before = input.phase === 'victim' ? undefined : await retained.listRetainedScratch();
    if (input.phase !== 'export') await owner.createScratch({ definition });
    const records = await retained.listRetainedScratch();
    const exports = await Promise.all(
      records.map(async ({ id }) => ({ id, text: await retained.exportRetainedScratch(id) })),
    );
    outcome = {
      kind: 'completed',
      ok: true,
      before,
      records,
      exports,
      catalog: owner.catalogSnapshot(),
    };
  } catch (error) {
    outcome = {
      kind: 'completed',
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    boundary.restore();
    await owner.close();
    await packages.quiesce();
    pair.fsSync.closeAll();
  }
  return { ...outcome, deniedReads: boundary.deniedReads(), custody: await custody() };
}

self.onmessage = (event: MessageEvent<RecoveryRequest>) => {
  void run(event.data).then(
    (result) => self.postMessage(result),
    (error: unknown) =>
      self.postMessage({
        kind: 'completed',
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }),
  );
};
