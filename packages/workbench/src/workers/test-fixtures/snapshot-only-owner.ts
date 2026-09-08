import { RegistryClient } from '@riftydev/npm-client';
import { type CommandContext, Shell } from '@riftydev/shell';
import { setSyncMirror } from '@riftydev/vfs/internal';
import { vi } from 'vitest';
import { SyncMirrorVfs } from '../../glue/sync-mirror-vfs.ts';
import { createPlaygroundProjectCatalog } from '../../workbench/internal/playground-project-catalog.ts';
import { definePlaygroundProject } from '../../workbench/internal/playground-project-definition.ts';
import { type OwnerPackageStateOptions, createOwnerPackageState } from '../owner-package-state.ts';
import { createOwnerVfsAuthorityComposition } from '../owner-vfs-authority.ts';
import { createPlaygroundProjectAuthority } from '../playground-project-authority.ts';
import { workbenchFirstMaterializationPackageConfig } from '../workbench-package-config.ts';
import { DurableOwnerFs } from './durable-owner-fs.ts';
import { savedSnapshotManifest, savedSnapshotSource } from './snapshot-saved-state.ts';

export function snapshotOnlyNetwork() {
  const requests: string[] = [];
  const routes = new Map<string, () => Response | Promise<Response>>();
  const fetch = async (input: string | URL | Request): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    requests.push(url);
    const response = routes.get(url);
    if (response === undefined) throw new Error(`Unexpected external acquisition request: ${url}`);
    return response();
  };
  vi.stubGlobal('fetch', fetch);
  return { fetch, requests, routes };
}

/** Real owner graph; absent registry is an absent capability, never a denying client. */
export async function openSnapshotOnlyOwner(
  network: ReturnType<typeof snapshotOnlyNetwork>,
  fs = new DurableOwnerFs(),
  mode: 'snapshot-only' | 'registry' = 'snapshot-only',
) {
  const composition = createOwnerVfsAuthorityComposition(fs, {
    ownerEpoch: crypto.randomUUID(),
    initialRoots: ['/', '/.rifty'],
  });
  const vfs = new SyncMirrorVfs();
  setSyncMirror(composition.authority, { async: vfs });
  const options = {
    vfs,
    fsSync: composition.authority,
    installStampClaims: composition.installStampClaims,
    flush: () => composition.authority.flush(),
    nodeWorkerRuntimeEnv: {},
    log: () => {},
    ...(mode === 'registry'
      ? {
          registry: new RegistryClient({
            baseUrl: 'https://registry.test',
            maxRetries: 0,
            fetch: network.fetch,
          }),
        }
      : {}),
    resolverUrl: () => undefined,
    resolverBundleBaseUrl: () => undefined,
    resolverPin: () => undefined,
  };
  // I3 RED shape: current type requires a capability absent in the accepted policy.
  const packages = createOwnerPackageState(options as unknown as OwnerPackageStateOptions);
  const owner = await createPlaygroundProjectAuthority({
    ...composition,
    persistence: 'required',
    now: () => '2026-09-08T00:00:00.000Z',
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
  const createShell = (cwd: string, env: Record<string, string> = {}): Shell => {
    const shell = new Shell({
      cwd,
      env,
      fileSystem: composition.authority,
      mutationGuard: (intents, operation) =>
        packages.mutations.guardedMutation(intents, async () => operation()),
      assertPortablePaths: (paths) => composition.authority.assertPortablePaths(paths),
    });
    shell.registerCommand(
      'npm',
      packages.createNpmCommand(async (_name, command, ctx: CommandContext) => {
        const result = await createShell(ctx.cwd, ctx.env).run(command, {
          ...(ctx.signal === undefined ? {} : { signal: ctx.signal }),
          onChunk: (chunk, stream) => ctx[stream].write(chunk),
        });
        return result.exit;
      }),
    );
    return shell;
  };
  return {
    ...composition,
    fs,
    vfs,
    packages,
    owner,
    catalog: createPlaygroundProjectCatalog(owner),
    createShell,
    async close() {
      await owner.close();
      await packages.quiesce();
    },
  };
}

export function installOnlyDefinition(id = 'scratch') {
  return definePlaygroundProject(
    {
      kind: 'node-cli',
      id,
      starterId: 'saved-ms-starter',
      templateId: 'saved-ms',
      entryPath: '/main.cjs',
      files: { '/package.json': savedSnapshotManifest, '/main.cjs': savedSnapshotSource },
      firstMaterialization: { kind: 'install' },
    },
    { apiBaseUrl: 'https://host.test/', clientUrl: 'https://host.test/app/' },
  );
}
