/// <reference lib="webworker" />

import { RegistryClient } from '@riftydev/npm-client';
import { type FsSync, OpfsFsSync, OpfsVfs } from '@riftydev/vfs';
import { setSyncMirror } from '@riftydev/vfs/internal';
import { isInstallStampPath } from '../../../packages/workbench/src/glue/install-stamp.ts';
import { SyncMirrorVfs } from '../../../packages/workbench/src/glue/sync-mirror-vfs.ts';
import { definePlaygroundProject } from '../../../packages/workbench/src/workbench/internal/playground-project-definition.ts';
import { createOwnerPackageState } from '../../../packages/workbench/src/workers/owner-package-state.ts';
import { createOwnerVfsAuthorityComposition } from '../../../packages/workbench/src/workers/owner-vfs-authority.ts';
import { createPlaygroundProjectAuthority } from '../../../packages/workbench/src/workers/playground-project-authority.ts';
import { workbenchFirstMaterializationPackageConfig } from '../../../packages/workbench/src/workers/workbench-package-config.ts';
import {
  type CatalogPointerBoundary,
  pauseCatalogPointer,
} from './opfs-catalog-pointer-boundary.ts';

const scope = globalThis as unknown as DedicatedWorkerGlobalScope;
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const catalogFile = '/.rifty/workbench/playground/catalog.json';
const transactionFile = '/.rifty/workbench/playground/transaction.json';
const projectRoot = '/.rifty/workbench/v1/projects/saved-opfs/tree';
const indexPath = `${projectRoot}/node_modules/ms/index.js`;

interface Input {
  readonly phase: 'victim' | 'verify';
  readonly operation: 'apply' | 'reset';
  readonly boundary: CatalogPointerBoundary;
  readonly archive: readonly number[];
  readonly snapshotId: string;
  readonly manifestText: string;
}

interface TreeEntry {
  readonly path: string;
  readonly kind: 'dir' | 'file';
  readonly bytes?: readonly number[];
}

function tree(fs: FsSync, root = '/'): TreeEntry[] {
  const rows: TreeEntry[] = [{ path: root, kind: 'dir' }];
  const pending = [root];
  for (const directory of pending) {
    for (const entry of fs.readdirSync(directory)) {
      const path = `${directory === '/' ? '' : directory}/${entry.name}`;
      if (entry.isDirectory) {
        rows.push({ path, kind: 'dir' });
        pending.push(path);
      } else rows.push({ path, kind: 'file', bytes: [...fs.readFileBytesSync(path)] });
    }
  }
  return rows.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

async function run(input: Input) {
  let before: TreeEntry[] = [];
  let afterProject: TreeEntry[] = [];
  let beforeCatalog = '';
  const arm =
    input.phase === 'victim'
      ? pauseCatalogPointer(input.boundary, () => {
          scope.postMessage({
            ok: true,
            result: { boundary: input.boundary, before, afterProject, beforeCatalog },
          });
        })
      : undefined;
  const surface = new OpfsVfs();
  await surface.init();
  const fs = await OpfsFsSync.init(surface);
  const composition = createOwnerVfsAuthorityComposition(fs, { initialRoots: ['/', '/.rifty'] });
  const vfs = new SyncMirrorVfs();
  setSyncMirror(composition.authority, { async: vfs });
  const origin = new URL(scope.location.href).origin;
  const assetUrl = `${origin}/snapshot-ms.tar.gz`;
  const requests: string[] = [];
  const network = async (request: string | URL | Request): Promise<Response> => {
    const url =
      typeof request === 'string' ? request : request instanceof URL ? request.href : request.url;
    requests.push(url);
    if (url === assetUrl) return new Response(new Uint8Array(input.archive));
    throw new Error(`Unexpected acquisition request: ${url}`);
  };
  globalThis.fetch = network;
  const packages = createOwnerPackageState({
    vfs,
    fsSync: composition.authority,
    installStampClaims: composition.installStampClaims,
    flush: () => composition.authority.flush(),
    nodeWorkerRuntimeEnv: {},
    log: () => {},
    registry: new RegistryClient({ baseUrl: `${origin}/registry`, maxRetries: 0, fetch: network }),
    resolverUrl: () => undefined,
    resolverBundleBaseUrl: () => undefined,
    resolverPin: () => undefined,
  });
  const owner = await createPlaygroundProjectAuthority({
    ...composition,
    persistence: 'required',
    now: () => '2026-09-08T00:00:00.000Z',
    createStageId: () => crypto.randomUUID(),
    acquisition: {
      ensure: (request) =>
        packages.activateAndEnsure(
          workbenchFirstMaterializationPackageConfig(request.definition, request.projectRoot, {
            packageJsonBytes: composition.authority.readFileBytesSync(
              `${request.snapshotAdmission !== undefined && request.snapshotAdmission.mode !== 'saved' ? (request.snapshotAdmission.preflightRoot ?? request.projectRoot) : request.projectRoot}/package.json`,
            ),
          }),
          request.snapshotAdmission,
        ),
    },
    projectSave: packages,
  });
  const context = Object.freeze({
    apiBaseUrl: `${origin}/`,
    clientUrl: `${origin}/unit-harness.html`,
  });
  const definition = (id: string, apply = false) =>
    definePlaygroundProject(
      {
        kind: 'node-cli',
        id,
        starterId: 'opfs-ms',
        templateId: 'opfs-ms',
        entryPath: '/main.cjs',
        files: {
          '/package.json': input.manifestText,
          '/main.cjs': "console.log(require('ms')('2s'));\n",
        },
        firstMaterialization: {
          kind: 'snapshot',
          snapshot: { snapshotId: input.snapshotId, assetUrl, templateId: 'opfs-ms' },
          ...(apply
            ? { application: { mode: 'apply-snapshot' as const, conflict: 'overwrite' as const } }
            : {}),
        },
      },
      context,
    );

  if (input.phase === 'verify') {
    // Startup recovery already ran; the real package authority must reuse it without arrival.
    const recovered = tree(composition.authority);
    const opened = await owner.openProject(definition('saved-opfs'));
    const acquisition = opened.acquisition;
    await opened.close();
    await owner.close();
    await packages.quiesce();
    return {
      recovered,
      current: tree(composition.authority),
      project: tree(composition.authority, projectRoot).filter(
        (row) => !isInstallStampPath(row.path),
      ),
      acquisition,
      requests,
      catalog: decoder.decode(composition.authority.readFileBytesSync(catalogFile)),
      journalPresent: composition.authority.existsSync(transactionFile),
    };
  }

  await owner.createScratch({ definition: definition('scratch') });
  const initial = await owner.openProject(definition('scratch'));
  if (
    initial.acquisition.kind !== 'ready' ||
    initial.acquisition.provenance.outcome !== 'snapshot'
  ) {
    throw new Error('real snapshot seed failed');
  }
  await initial.close();
  await owner.saveScratch({
    id: 'saved-opfs',
    name: 'Saved OPFS',
    definition: definition('saved-opfs'),
  });
  const warm = await owner.openProject(definition('saved-opfs'));
  if (warm.acquisition.kind !== 'ready' || warm.acquisition.provenance.outcome !== 'existing') {
    throw new Error('named snapshot seed was not trusted before the fault');
  }
  const referenceIndex = [...composition.authority.readFileBytesSync(indexPath)];
  composition.authority.writeFileSync(
    indexPath,
    encoder.encode('module.exports = () => "local edit";\n'),
  );
  composition.authority.writeFileSync(
    `${projectRoot}/user.txt`,
    encoder.encode('retained source\n'),
  );
  composition.authority.writeFileSync(
    `${projectRoot}/node_modules/ms/local.txt`,
    encoder.encode('retained package extra\n'),
  );
  composition.authority.mkdirSync(`${projectRoot}/node_modules/ms/empty-local`, {
    recursive: true,
  });
  await owner.recordMutation({
    project: warm,
    kind: 'file',
    treeRevision: composition.authority.treeRevision,
  });
  await warm.close();
  await composition.authority.flush();
  before = tree(composition.authority);
  beforeCatalog = decoder.decode(composition.authority.readFileBytesSync(catalogFile));
  afterProject = tree(composition.authority, projectRoot)
    .filter((row) => !isInstallStampPath(row.path))
    .map((row) => (row.path === indexPath ? { ...row, bytes: referenceIndex } : row));
  if (requests.length !== 1 || requests[0] !== assetUrl)
    throw new Error('seed performed unexpected acquisition');
  arm?.();
  if (input.operation === 'reset') {
    await owner.reset({
      target: { kind: 'project', id: 'saved-opfs' },
      definition: definition('saved-opfs'),
    });
  } else {
    const opened = await owner.openProject(definition('saved-opfs', true));
    await opened.close();
  }
  throw new Error('operation completed without the native catalog pointer boundary');
}

scope.addEventListener('message', (event: MessageEvent<Input>) => {
  void run(event.data).then(
    (result) => scope.postMessage({ ok: true, result }),
    (error: unknown) =>
      scope.postMessage({ ok: false, error: error instanceof Error ? error.stack : String(error) }),
  );
});
