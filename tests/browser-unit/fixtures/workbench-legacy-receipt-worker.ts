/// <reference lib="webworker" />

import { RegistryClient } from '@riftydev/npm-client';
import { type FsSync, OpfsFsSync, OpfsVfs } from '@riftydev/vfs';
import { setSyncMirror } from '@riftydev/vfs/internal';
import { SyncMirrorVfs } from '../../../packages/workbench/src/glue/sync-mirror-vfs.ts';
import { definePlaygroundProject } from '../../../packages/workbench/src/workbench/internal/playground-project-definition.ts';
import type { ProjectAcquisitionPlan } from '../../../packages/workbench/src/workbench/project-materialization.ts';
import { createOwnerPackageState } from '../../../packages/workbench/src/workers/owner-package-state.ts';
import { createOwnerVfsAuthorityComposition } from '../../../packages/workbench/src/workers/owner-vfs-authority.ts';
import { createPlaygroundProjectAuthority } from '../../../packages/workbench/src/workers/playground-project-authority.ts';
import { workbenchFirstMaterializationPackageConfig } from '../../../packages/workbench/src/workers/workbench-package-config.ts';
import {
  type CatalogPointerBoundary,
  pauseCatalogPointer,
} from './opfs-catalog-pointer-boundary.ts';
import type { bakeApplicationPackage } from './snapshot-application-package.ts';

const scope = globalThis as unknown as DedicatedWorkerGlobalScope;
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const prefix = '/workspaces/legacy_receipt_opfs';
const targetId = 'legacy-target';
const siblingId = 'legacy-pending';
const projectRoot = `/.rifty/workbench/v1/projects/${targetId}/tree`;
const journalFile = '/.rifty/workbench/playground/migration-journal.json';
const transactionFile = '/.rifty/workbench/playground/transaction.json';
const editedIndex = 'module.exports = () => "retained before retirement";\n';

export type LegacyReceiptInput = Awaited<ReturnType<typeof bakeApplicationPackage>> & {
  readonly phase: 'seed' | 'victim' | 'verify';
  readonly boundary: CatalogPointerBoundary;
};

export interface ReceiptTreeEntry {
  readonly path: string;
  readonly kind: 'dir' | 'file';
  readonly bytes?: readonly number[];
}

export interface ReceiptSeed {
  readonly phase: 'seed';
  readonly receipt: readonly number[];
  readonly requests: readonly string[];
}

export interface ReceiptPaused {
  readonly phase: 'paused';
  readonly boundary: CatalogPointerBoundary;
  readonly before: readonly ReceiptTreeEntry[];
  readonly requests: readonly string[];
}

export interface ReceiptRecovered {
  readonly phase: 'verify';
  readonly beforeOpen: readonly ReceiptTreeEntry[];
  readonly recovered: readonly ReceiptTreeEntry[];
  readonly current: readonly ReceiptTreeEntry[];
  readonly acquisition: ProjectAcquisitionPlan;
  readonly requests: readonly string[];
  readonly transactionPresent: boolean;
}

function tree(fs: FsSync): ReceiptTreeEntry[] {
  const rows: ReceiptTreeEntry[] = [{ path: '/', kind: 'dir' }];
  const pending = ['/'];
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

async function run(input: LegacyReceiptInput): Promise<ReceiptSeed | ReceiptRecovered> {
  let before: readonly ReceiptTreeEntry[] = [];
  let receipt: Uint8Array | undefined;
  const requests: string[] = [];
  const arm = pauseCatalogPointer(
    input.boundary,
    () => {
      scope.postMessage({
        ok: true,
        result: {
          phase: 'paused',
          boundary: input.boundary,
          before,
          requests,
        } satisfies ReceiptPaused,
      });
    },
    {
      targetPath: journalFile,
      afterNativeClose: async (handle) => {
        if (input.phase !== 'seed') return;
        const bytes = new Uint8Array(await (await handle.getFile()).arrayBuffer());
        const journal = JSON.parse(decoder.decode(bytes)) as {
          refs: { id: string; phase: { kind: string } }[];
        };
        if (
          journal.refs.some((ref) => ref.id === targetId && ref.phase.kind === 'adopted') &&
          journal.refs.some((ref) => ref.id === siblingId && ref.phase.kind === 'pending')
        )
          receipt = bytes;
      },
    },
  );
  const surface = new OpfsVfs();
  await surface.init();
  const fs = await OpfsFsSync.init(surface);
  const composition = createOwnerVfsAuthorityComposition(fs, { initialRoots: ['/', '/.rifty'] });
  const authority = composition.authority;
  const vfs = new SyncMirrorVfs();
  setSyncMirror(authority, { async: vfs });
  const write = (path: string, bytes: string | Uint8Array) => {
    authority.mkdirSync(path.slice(0, path.lastIndexOf('/')), { recursive: true });
    authority.writeFileSync(path, typeof bytes === 'string' ? encoder.encode(bytes) : bytes);
  };
  if (input.phase === 'seed') {
    for (const id of [targetId, siblingId]) {
      const root = `${prefix}/projects/${id}`;
      write(`${root}/package.json`, input.manifestText);
      write(`${root}/main.cjs`, "console.log(require('ms')('2s'));\n");
      write(`${root}/user.bin`, new Uint8Array([0, 129, 255, 17]));
      write(`${root}/node_modules/ms/index.js`, 'legacy dependency bytes\n');
      write(`${root}/node_modules/ms/local.txt`, 'retained local dependency\n');
      authority.mkdirSync(`${root}/empty-local`, { recursive: true });
    }
    write(
      `${prefix}/.rifty-project-index.json`,
      JSON.stringify({
        activeId: targetId,
        scratch: null,
        projects: [targetId, siblingId].map((id) => ({
          id,
          name: id,
          starter: 'opfs-ms',
          editedAt: '2026-09-08T00:00:00.000Z',
        })),
      }),
    );
    await authority.flush();
  }
  const beforeOpen = tree(authority);
  const origin = new URL(scope.location.href).origin;
  const assetUrl = `${origin}/snapshot-ms.tar.gz`;
  const unusedAssetUrl = `${origin}/unused-legacy-snapshot.tar.gz`;
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
    fsSync: authority,
    installStampClaims: composition.installStampClaims,
    flush: () => authority.flush(),
    nodeWorkerRuntimeEnv: {},
    log: () => {},
    registry: new RegistryClient({ baseUrl: `${origin}/registry`, maxRetries: 0, fetch: network }),
    resolverUrl: () => undefined,
    resolverBundleBaseUrl: () => undefined,
    resolverPin: () => undefined,
  });
  const owner = await createPlaygroundProjectAuthority({
    ...composition,
    legacyWorkspacePrefix: prefix,
    persistence: 'required',
    now: () => '2026-09-08T00:00:00.000Z',
    createStageId: () => crypto.randomUUID(),
    acquisition: {
      ensure: (request) =>
        packages.activateAndEnsure(
          workbenchFirstMaterializationPackageConfig(request, authority),
          request.snapshotAdmission,
        ),
    },
    projectSave: packages,
  });
  const context = Object.freeze({
    apiBaseUrl: `${origin}/`,
    clientUrl: `${origin}/unit-harness.html`,
  });
  const definition = (apply: boolean) =>
    definePlaygroundProject(
      {
        kind: 'node-cli',
        id: targetId,
        starterId: 'opfs-ms',
        templateId: 'opfs-ms',
        entryPath: '/main.cjs',
        files: {
          '/package.json': input.manifestText,
          '/main.cjs': "console.log(require('ms')('2s'));\n",
        },
        firstMaterialization: {
          kind: 'snapshot',
          snapshot: {
            snapshotId: apply ? input.snapshotId : `sha256:${'0'.repeat(64)}`,
            assetUrl: apply ? assetUrl : unusedAssetUrl,
            templateId: 'opfs-ms',
          },
          ...(apply
            ? { application: { mode: 'apply-snapshot' as const, conflict: 'overwrite' as const } }
            : {}),
        },
      },
      context,
    );

  if (input.phase === 'seed') {
    const opened = await owner.openProject(definition(true));
    if (
      opened.acquisition.kind !== 'ready' ||
      opened.acquisition.provenance.outcome !== 'snapshot'
    ) {
      throw new Error('legacy target did not acquire the real snapshot');
    }
    await opened.close();
    await owner.close();
    await packages.quiesce();
    if (receipt === undefined)
      throw new Error('no actual adopted receipt observed at native close');
    // Reconstruct an older committed receipt only after the real owner has closed.
    await surface.writeFile(journalFile, receipt);
    const restored = await surface.readFile(journalFile);
    if (decoder.decode(restored) !== decoder.decode(receipt))
      throw new Error('receipt restore drift');
    return { phase: 'seed', receipt: [...restored], requests };
  }

  const recovered = tree(authority);
  const opened = await owner.openProject(definition(false));
  const acquisition = opened.acquisition;
  if (acquisition.kind !== 'ready' || acquisition.provenance.outcome !== 'existing') {
    throw new Error('legacy target does not retain real saved trust');
  }
  if (input.phase === 'verify') {
    await opened.close();
    await owner.close();
    await packages.quiesce();
    return {
      phase: 'verify',
      beforeOpen,
      recovered,
      current: tree(authority),
      acquisition,
      requests,
      transactionPresent: authority.existsSync(transactionFile),
    };
  }
  write(`${projectRoot}/node_modules/ms/index.js`, editedIndex);
  await owner.recordMutation({
    project: opened,
    kind: 'file',
    treeRevision: authority.treeRevision,
  });
  await opened.close();
  await authority.flush();
  before = tree(authority);
  if (requests.length !== 0) throw new Error('unused snapshot fetched before retirement');
  arm();
  const applied = await owner.openProject(definition(true));
  await applied.close();
  throw new Error('operation completed without the native migration receipt retirement boundary');
}

scope.addEventListener('message', (event: MessageEvent<LegacyReceiptInput>) => {
  void run(event.data).then(
    (result) => scope.postMessage({ ok: true, result }),
    (error: unknown) =>
      scope.postMessage({ ok: false, error: error instanceof Error ? error.stack : String(error) }),
  );
});
