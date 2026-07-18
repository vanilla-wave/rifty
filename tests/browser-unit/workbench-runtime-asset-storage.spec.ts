import { expect, test } from '@playwright/test';
import { gotoHarness } from './fixtures.ts';

test('real OPFS runtime assets survive reopen, stay private, and clear independently', async ({
  page,
}) => {
  test.setTimeout(300_000);
  await gotoHarness(page);

  const result = await page.evaluate(async () => {
    type StorageClass = 'opfs-persisted' | 'opfs-best-effort' | 'memory-session';
    interface Inspection {
      readonly storageClass: StorageClass;
      readonly entryCount: number;
      readonly storedBytes: number;
      readonly verifiedObjectCount: number;
      readonly verifiedObjectBytes: number;
      readonly readySetCount: number;
    }
    type ProjectDefinition = object;
    interface ProjectSession {
      readonly files: {
        snapshot(): { readonly entries: readonly unknown[] };
        readFile(path: string): Promise<{ readonly bytes: Uint8Array }>;
      };
      close(): Promise<void>;
    }
    interface ProjectTools {
      readonly archive: { export(): Promise<string> };
      readonly scm: { refresh(): Promise<unknown> };
      awaitDurability(): Promise<void>;
    }
    interface PlaygroundWorkbench {
      readonly runtimeAssets: {
        inspect(): Promise<Inspection>;
        clear(): Promise<Inspection>;
      };
      readonly playground: {
        define(plan: {
          readonly kind: 'node-cli';
          readonly id: string;
          readonly starterId: string;
          readonly templateId: string;
          readonly files: Readonly<Record<string, string>>;
          readonly firstMaterialization: { readonly kind: 'install' };
          readonly entryPath: string;
          readonly args: readonly string[];
        }): ProjectDefinition;
        readonly catalog: {
          createScratch(input: { readonly definition: ProjectDefinition }): Promise<unknown>;
          saveScratch(input: {
            readonly id: string;
            readonly name: string;
            readonly definition: ProjectDefinition;
          }): Promise<unknown>;
          reset(input: {
            readonly target: { readonly kind: 'project'; readonly id: string };
            readonly definition: ProjectDefinition;
          }): Promise<unknown>;
          snapshot(): {
            readonly projects: readonly { readonly id: string }[];
          };
        };
        forSession(session: ProjectSession): ProjectTools;
      };
      snapshot(): unknown;
      openProject(definition: ProjectDefinition): Promise<ProjectSession>;
      deleteProject(id: string): Promise<void>;
      close(): Promise<void>;
    }
    interface HostAssets {
      readonly workers: {
        readonly owner: string;
        readonly kernel: string;
        readonly node: string;
        readonly devServer: string;
        readonly typescript: string;
      };
      readonly wasm: { readonly sqlite: string; readonly esbuild: string };
    }
    interface SeedResult {
      readonly assetMarker: string;
      readonly memberSha256: string;
      readonly requiredSetDigest: string;
      readonly tarballMarker: string;
      readonly usage: Inspection;
    }
    interface PhysicalInspection {
      readonly runtimeAssets: {
        readonly entryCount: number;
        readonly storedBytes: number;
        readonly entries: readonly unknown[];
      };
      readonly managerUsage: Inspection;
      readonly lookup: {
        readonly name: string;
        readonly phase: unknown;
        readonly recovery: unknown;
      };
      readonly tarball: string | null;
      readonly retainedProject: boolean;
    }
    interface FixtureModule {
      seedRuntimeAssetStorage(): Promise<SeedResult>;
      inspectRuntimeAssetPhysicalStorage(): Promise<PhysicalInspection>;
    }
    interface CompanionModule {
      openPlaygroundWorkbench(options: {
        readonly deployment: {
          readonly workers: HostAssets['workers'];
          readonly serviceWorker: { readonly url: string; readonly scope: string };
          readonly wasm: HostAssets['wasm'];
          readonly previewProbeTimeoutMs: number;
        };
        readonly packageAcquisition: { readonly registryUrl: string };
        readonly storage: { readonly persistence: 'ephemeral' | 'required' };
      }): Promise<PlaygroundWorkbench>;
    }

    const [fixtureModule, companionModule, hostAssetsModule] = await Promise.all([
      import('/src/browser-unit/workbench-runtime-asset-storage-fixture.ts'),
      import('/src/workbench/playground.ts'),
      import('/src/browser-unit/workbench-vite-host-assets.ts'),
    ]);
    const fixture = fixtureModule as unknown as FixtureModule;
    const companion = companionModule as unknown as CompanionModule;
    const hostAssets = (
      hostAssetsModule as unknown as { readonly workbenchViteHostAssets: HostAssets }
    ).workbenchViteHostAssets;
    const seed = await fixture.seedRuntimeAssetStorage();

    const ownerWorkerUrl = new URL(hostAssets.workers.owner, location.href);
    const ownerWorkerBaseUrl = new URL('.', ownerWorkerUrl);
    const ownerWorkerReference = ownerWorkerUrl.href.slice(ownerWorkerBaseUrl.href.length);
    const baseElement = document.createElement('base');
    baseElement.href = ownerWorkerBaseUrl.href;
    document.head.prepend(baseElement);
    const open = (persistence: 'ephemeral' | 'required'): Promise<PlaygroundWorkbench> =>
      companion.openPlaygroundWorkbench({
        deployment: {
          workers: { ...hostAssets.workers, owner: ownerWorkerReference },
          serviceWorker: { url: '/sw.js', scope: '/' },
          wasm: hostAssets.wasm,
          previewProbeTimeoutMs: 30_000,
        },
        packageAcquisition: { registryUrl: '/npm-registry' },
        storage: { persistence },
      });
    const zeros = (inspection: Inspection): boolean =>
      inspection.entryCount === 0 &&
      inspection.storedBytes === 0 &&
      inspection.verifiedObjectCount === 0 &&
      inspection.verifiedObjectBytes === 0 &&
      inspection.readySetCount === 0;
    const assertSameAssetChain = (inspection: Inspection, label: string): void => {
      if (
        inspection.storageClass !== seed.usage.storageClass ||
        inspection.entryCount !== seed.usage.entryCount ||
        inspection.storedBytes !== seed.usage.storedBytes ||
        inspection.verifiedObjectCount !== 1 ||
        inspection.verifiedObjectBytes !== seed.usage.verifiedObjectBytes ||
        inspection.readySetCount !== 1
      ) {
        throw new Error(`${label} did not observe the seeded runtime-asset chain`);
      }
    };
    const projectPlan = (id: string) => ({
      kind: 'node-cli' as const,
      id,
      starterId: 'browser-runtime-assets',
      templateId: 'browser-runtime-assets-v1',
      files: {
        '/package.json': `${JSON.stringify({ name: 'browser-runtime-assets', private: true, type: 'module' })}\n`,
        '/src/cli.mjs': 'console.log("runtime asset privacy")\n',
      },
      firstMaterialization: { kind: 'install' as const },
      entryPath: '/src/cli.mjs',
      args: [] as const,
    });

    let workbench: PlaygroundWorkbench | null = null;
    let session: ProjectSession | null = null;
    try {
      workbench = await open('ephemeral');
      const ephemeral = await workbench.runtimeAssets.inspect();
      if (ephemeral.storageClass !== 'memory-session' || !zeros(ephemeral)) {
        throw new Error('Ephemeral Workbench falsely reused durable runtime assets');
      }
      await workbench.close();
      workbench = null;

      workbench = await open('required');
      const firstOpen = await workbench.runtimeAssets.inspect();
      if (!firstOpen.storageClass.startsWith('opfs-')) {
        throw new Error('Required Workbench did not report OPFS runtime-asset storage');
      }
      assertSameAssetChain(firstOpen, 'first OPFS open');
      await workbench.close();
      workbench = null;

      workbench = await open('required');
      const reopened = await workbench.runtimeAssets.inspect();
      assertSameAssetChain(reopened, 'reopened OPFS Workbench');

      const scratch = workbench.playground.define(projectPlan('scratch'));
      await workbench.playground.catalog.createScratch({ definition: scratch });
      const projectId = 'browser-runtime-assets-project-a';
      const project = workbench.playground.define(projectPlan(projectId));
      await workbench.playground.catalog.saveScratch({
        id: projectId,
        name: 'Runtime Asset Privacy',
        definition: project,
      });
      session = await workbench.openProject(project);
      const tools = workbench.playground.forSession(session);
      const [archive, scm] = await Promise.all([tools.archive.export(), tools.scm.refresh()]);
      const publicArtifacts = [
        JSON.stringify(session.files.snapshot()),
        archive,
        JSON.stringify(scm),
        JSON.stringify(workbench.snapshot()),
      ];
      const privateNeedles = [
        seed.assetMarker,
        btoa(seed.assetMarker),
        seed.memberSha256,
        seed.requiredSetDigest,
      ];
      for (const [index, artifact] of publicArtifacts.entries()) {
        for (const needle of privateNeedles) {
          if (artifact.includes(needle)) {
            throw new Error(`public artifact ${String(index)} exposed private runtime assets`);
          }
        }
      }
      let privateReadRejected = false;
      try {
        await session.files.readFile(
          `/.rifty/workbench/v1/runtime-assets/v1/objects/${seed.memberSha256}`,
        );
      } catch {
        privateReadRejected = true;
      }
      if (!privateReadRejected) throw new Error('Project Files reached private runtime assets');
      await tools.awaitDurability();
      await session.close();
      session = null;

      await workbench.playground.catalog.reset({
        target: { kind: 'project', id: projectId },
        definition: project,
      });
      assertSameAssetChain(await workbench.runtimeAssets.inspect(), 'project reset');
      await workbench.deleteProject(projectId);
      assertSameAssetChain(await workbench.runtimeAssets.inspect(), 'project delete');

      const retainedScratch = workbench.playground.define(projectPlan('scratch'));
      await workbench.playground.catalog.createScratch({ definition: retainedScratch });
      const retainedId = 'browser-runtime-assets-retained';
      const retained = workbench.playground.define(projectPlan(retainedId));
      await workbench.playground.catalog.saveScratch({
        id: retainedId,
        name: 'Retained Across Asset Clear',
        definition: retained,
      });
      const cleared = await workbench.runtimeAssets.clear();
      if (!zeros(cleared) || cleared.storageClass !== reopened.storageClass) {
        throw new Error('Runtime-asset clear returned an invalid scoped inspection');
      }
      if (!workbench.playground.catalog.snapshot().projects.some(({ id }) => id === retainedId)) {
        throw new Error('Runtime-asset clear removed the retained project catalog entry');
      }
      await workbench.close();
      workbench = null;

      const physical = await fixture.inspectRuntimeAssetPhysicalStorage();
      if (
        physical.runtimeAssets.entryCount !== 0 ||
        physical.runtimeAssets.storedBytes !== 0 ||
        physical.runtimeAssets.entries.length !== 0 ||
        !zeros(physical.managerUsage)
      ) {
        throw new Error('Runtime-asset clear retained physical cache entries');
      }
      if (
        physical.lookup.name !== 'ShadowAssetError' ||
        physical.lookup.phase !== 'cache-check' ||
        physical.lookup.recovery !== 'retry'
      ) {
        throw new Error('Post-clear real manager lookup did not report an honest cache miss');
      }
      if (physical.tarball !== seed.tarballMarker) {
        throw new Error('Runtime-asset clear removed the sibling npm tarball cache');
      }
      if (!physical.retainedProject) {
        throw new Error('Runtime-asset clear removed the retained project tree');
      }
      return {
        seedUsage: seed.usage,
        firstOpen,
        reopened,
        cleared,
        physical,
      };
    } finally {
      await session?.close().catch(() => {});
      await workbench?.close().catch(() => {});
      baseElement.remove();
    }
  });

  expect(result.seedUsage).toMatchObject({
    entryCount: 3,
    verifiedObjectCount: 1,
    readySetCount: 1,
  });
  expect(result.seedUsage.storageClass).toMatch(/^opfs-/);
  expect(result.firstOpen.storageClass).toMatch(/^opfs-/);
  expect(result.reopened).toEqual(result.firstOpen);
  expect(result.cleared).toMatchObject({
    entryCount: 0,
    storedBytes: 0,
    verifiedObjectCount: 0,
    verifiedObjectBytes: 0,
    readySetCount: 0,
  });
  expect(result.physical).toMatchObject({
    runtimeAssets: { entryCount: 0, storedBytes: 0, entries: [] },
    managerUsage: {
      entryCount: 0,
      storedBytes: 0,
      verifiedObjectCount: 0,
      verifiedObjectBytes: 0,
      readySetCount: 0,
    },
    lookup: { name: 'ShadowAssetError', phase: 'cache-check', recovery: 'retry' },
    tarball: 'BROWSER_UNIT_RETAINED_TARBALL',
    retainedProject: true,
  });
  expect(result.physical.managerUsage.storageClass).toBe(result.seedUsage.storageClass);
});
