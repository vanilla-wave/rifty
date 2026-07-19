import { expect, test } from '@playwright/test';
import { gotoHarness } from './fixtures.ts';
import { pinPublicEsbuild0280 } from './pinned-public-esbuild.ts';

const workspacePath = process.cwd().replaceAll('\\', '/');
const childEntryUrl = `/@fs${workspacePath}/tests/browser-unit/fixtures/runtime-asset-public-vite-entry.ts`;

test('public Vite 7 cold open attests assets before its real child is published', async ({
  page,
}) => {
  test.setTimeout(300_000);
  await gotoHarness(page);
  const pinnedEsbuildRequests = await pinPublicEsbuild0280(page);

  const result = await page.evaluate(async (fixtureUrl) => {
    type StorageClass = 'opfs-persisted' | 'opfs-best-effort' | 'memory-session';
    type Progress =
      | Readonly<{
          phase: 'cache-check' | 'fetch' | 'verify' | 'persist';
          assetId: string;
          assetIndex: number;
          assetCount: number;
        }>
      | Readonly<{
          phase: 'ready';
          requiredSetDigest: string;
          assetCount: number;
          storageClass: StorageClass;
        }>;
    interface Inspection {
      readonly storageClass: StorageClass;
      readonly entryCount: number;
      readonly storedBytes: number;
      readonly verifiedObjectCount: number;
      readonly verifiedObjectBytes: number;
      readonly readySetCount: number;
    }
    type Exit = { readonly code: number | null; readonly signal: string | null };
    interface Terminal {
      attach(listener: (chunk: string, stream: 'stdout' | 'stderr') => void): () => void;
    }
    interface ProjectRun {
      readonly terminal: Terminal;
      readonly ready: Promise<{ readonly port: number; readonly url: string }>;
      readonly exited: Promise<Exit>;
      close(): Promise<Exit>;
    }
    interface Project {
      run(): ProjectRun;
      close(): Promise<void>;
    }
    interface Workbench {
      readonly runtimeAssets: {
        inspect(): Promise<Inspection>;
        clear(): Promise<Inspection>;
      };
      openProject(
        definition: object,
        options?: { readonly onRuntimeAssetProgress?: (progress: Progress) => void },
      ): Promise<Project>;
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
      readonly wasm: { readonly sqlite: string };
    }
    interface PublicEntry {
      openWorkbench(options: {
        readonly deployment: {
          readonly workers: HostAssets['workers'];
          readonly serviceWorker: { readonly url: string; readonly scope: string };
          readonly wasm: HostAssets['wasm'];
          readonly previewProbeTimeoutMs: number;
        };
        readonly packageAcquisition: { readonly registryUrl: string };
        readonly storage: { readonly persistence: 'ephemeral' };
      }): Promise<Workbench>;
      readonly projects: {
        vite(options: {
          readonly id: string;
          readonly viteVersion: string;
          readonly files: Readonly<Record<string, string>>;
        }): object;
      };
    }
    interface CapabilityProof {
      readonly capabilityKeys: readonly string[];
      readonly requiredSetDigest: string;
      readonly assetId: string;
      readonly assetSha256: string;
      readonly assetSize: number;
    }

    const withTimeout = <T>(operation: Promise<T>, label: string, timeoutMs: number): Promise<T> =>
      new Promise<T>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
          timeoutMs,
        );
        operation.then(
          (value) => {
            clearTimeout(timer);
            resolve(value);
          },
          (error: unknown) => {
            clearTimeout(timer);
            reject(error);
          },
        );
      });
    const waitUntil = async (
      predicate: () => boolean,
      label: string,
      timeoutMs: number,
    ): Promise<void> => {
      const deadline = performance.now() + timeoutMs;
      while (!predicate()) {
        if (performance.now() >= deadline)
          throw new Error(`${label} timed out after ${timeoutMs}ms`);
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    };
    const isEmpty = (inspection: Inspection): boolean =>
      inspection.entryCount === 0 &&
      inspection.storedBytes === 0 &&
      inspection.verifiedObjectCount === 0 &&
      inspection.verifiedObjectBytes === 0 &&
      inspection.readySetCount === 0;

    const [publicModule, hostModule] = await Promise.all([
      import('/src/browser-unit/workbench-public-entry.ts'),
      import('/src/browser-unit/workbench-vite-host-assets.ts'),
    ]);
    const publicEntry = publicModule as unknown as PublicEntry;
    const hostAssets = (hostModule as unknown as { readonly workbenchViteHostAssets: HostAssets })
      .workbenchViteHostAssets;
    const ownerWorkerUrl = new URL(hostAssets.workers.owner, location.href);
    const ownerWorkerBaseUrl = new URL('.', ownerWorkerUrl);
    const ownerWorkerReference = ownerWorkerUrl.href.slice(ownerWorkerBaseUrl.href.length);
    const baseElement = document.createElement('base');
    baseElement.href = ownerWorkerBaseUrl.href;
    document.head.prepend(baseElement);

    const progress: Progress[] = [];
    const order: string[] = [];
    let workbench: Workbench | null = null;
    let project: Project | null = null;
    let run: ProjectRun | null = null;
    try {
      workbench = await withTimeout(
        publicEntry.openWorkbench({
          deployment: {
            workers: {
              ...hostAssets.workers,
              owner: ownerWorkerReference,
              node: new URL(fixtureUrl, location.href).href,
            },
            serviceWorker: { url: '/sw.js', scope: '/' },
            wasm: hostAssets.wasm,
            previewProbeTimeoutMs: 30_000,
          },
          packageAcquisition: { registryUrl: '/npm-registry' },
          storage: { persistence: 'ephemeral' },
        }),
        'Workbench open',
        120_000,
      );
      const definition = publicEntry.projects.vite({
        id: 'browser-unit-runtime-asset-public-acquisition',
        viteVersion: '7.3.6',
        files: {
          '/index.html': '<!doctype html><h1>runtime asset public acquisition</h1>',
        },
      });
      project = await withTimeout(
        workbench.openProject(definition, {
          onRuntimeAssetProgress(next) {
            progress.push(next);
            order.push(`progress:${next.phase}`);
          },
        }),
        'Vite 7 project open',
        180_000,
      );
      order.push('open-resolved');

      const phases = progress.map(({ phase }) => phase);
      const expectedPhases = ['cache-check', 'fetch', 'verify', 'persist', 'ready'];
      if (JSON.stringify(phases) !== JSON.stringify(expectedPhases)) {
        throw new Error(`cold runtime-asset progress drifted: ${phases.join(' -> ')}`);
      }
      const ready = progress.at(-1);
      if (ready?.phase !== 'ready') throw new Error('project open resolved without ready progress');
      if (order.at(-2) !== 'progress:ready' || order.at(-1) !== 'open-resolved') {
        throw new Error(`project open published before ready: ${order.join(' -> ')}`);
      }
      const assetProgress = progress.slice(0, -1);
      if (
        assetProgress.some(
          (entry) =>
            entry.phase === 'ready' ||
            entry.assetIndex !== 0 ||
            entry.assetCount !== 1 ||
            entry.assetId !== 'esbuild-wasm@0.28.0/package/esbuild.wasm',
        )
      ) {
        throw new Error('project open progress did not describe the canonical one-asset plan');
      }
      const beforeChild = await workbench.runtimeAssets.inspect();
      if (beforeChild.verifiedObjectCount !== 1 || beforeChild.readySetCount !== 1) {
        throw new Error('project open resolved without an exact ready receipt in storage');
      }

      run = project.run();
      let output = '';
      const detach = run.terminal.attach((chunk) => {
        output += chunk;
      });
      const preview = await withTimeout(run.ready, 'admitted fixture child preview', 120_000);
      await waitUntil(
        () => output.includes('RIFTY_RUNTIME_ASSET_PUBLIC_PROOF:'),
        'child capability proof output',
        30_000,
      );
      detach();
      const proofLine = output
        .split('\n')
        .find((line) => line.startsWith('RIFTY_RUNTIME_ASSET_PUBLIC_PROOF:'));
      if (proofLine === undefined) throw new Error('child capability proof line disappeared');
      const proof = JSON.parse(
        proofLine.slice('RIFTY_RUNTIME_ASSET_PUBLIC_PROOF:'.length),
      ) as CapabilityProof;
      const previewResponse = await withTimeout(
        fetch(preview.url, { cache: 'no-store' }),
        'published child preview response',
        30_000,
      );
      const publishedProof = (await previewResponse.json()) as CapabilityProof;
      if (!previewResponse.ok || JSON.stringify(publishedProof) !== JSON.stringify(proof)) {
        throw new Error('published child did not retain its pre-publication capability proof');
      }
      if (
        proof.requiredSetDigest !== ready.requiredSetDigest ||
        proof.assetId !== 'esbuild-wasm@0.28.0/package/esbuild.wasm' ||
        proof.assetSha256.length !== 64 ||
        proof.assetSize <= 0 ||
        JSON.stringify(proof.capabilityKeys) !== JSON.stringify(['rifty.shadow-assets.v1'])
      ) {
        throw new Error(
          `child did not receive the exact attested reservation capability: ${JSON.stringify({
            ready,
            proof,
          })}`,
        );
      }

      const closing = run.close();
      const [exit, closeExit] = await Promise.all([
        withTimeout(run.exited, 'fixture child physical exit', 30_000),
        withTimeout(closing, 'fixture child cleanup', 30_000),
      ]);
      run = null;
      const revoked = await withTimeout(
        fetch(preview.url, { cache: 'no-store' }),
        'revoked child preview response',
        30_000,
      );
      const revokedBody = await revoked.text();
      if (revoked.ok && revokedBody === JSON.stringify(proof)) {
        throw new Error('child capability/preview peer survived physical cleanup');
      }

      await withTimeout(project.close(), 'project close', 60_000);
      project = null;
      const retained = await workbench.runtimeAssets.inspect();
      const cleared = await workbench.runtimeAssets.clear();
      if (retained.readySetCount !== 1 || !isEmpty(cleared)) {
        throw new Error('post-child cleanup did not leave one clearable owner asset chain');
      }
      await withTimeout(workbench.close(), 'Workbench close', 60_000);
      workbench = null;
      return { progress, order, beforeChild, proof, publishedProof, exit, closeExit, cleared };
    } finally {
      await run?.close().catch(() => {});
      await project?.close().catch(() => {});
      await workbench?.close().catch(() => {});
      baseElement.remove();
    }
  }, childEntryUrl);

  expect(result.progress.map(({ phase }) => phase)).toEqual([
    'cache-check',
    'fetch',
    'verify',
    'persist',
    'ready',
  ]);
  expect(result.order.slice(-2)).toEqual(['progress:ready', 'open-resolved']);
  expect(result.beforeChild).toMatchObject({
    storageClass: 'memory-session',
    verifiedObjectCount: 1,
    readySetCount: 1,
  });
  expect(result.publishedProof).toEqual(result.proof);
  expect(result.proof).toMatchObject({
    capabilityKeys: ['rifty.shadow-assets.v1'],
    assetId: 'esbuild-wasm@0.28.0/package/esbuild.wasm',
  });
  expect(result.exit).toEqual(result.closeExit);
  expect(result.cleared).toMatchObject({
    entryCount: 0,
    storedBytes: 0,
    verifiedObjectCount: 0,
    verifiedObjectBytes: 0,
    readySetCount: 0,
  });
  expect(pinnedEsbuildRequests).toHaveLength(1);
});
