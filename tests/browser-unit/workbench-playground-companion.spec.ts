import { type Page, expect, test } from '@playwright/test';
import {
  bootOwner,
  closeOwner,
  flushOwnerDurable,
  gotoHarness,
  writeOwnerFile,
} from './fixtures.ts';

const OUTPUT_MARKER = 'WORKBENCH_COMPANION_KLEUR_OK';
const ARGUMENT_MARKER = '--from-companion';
const SELECTED_LEGACY_WORKSPACE_ID = 'selected legacy /tab?';
const DECOY_LEGACY_WORKSPACE_ID = 'decoy legacy /tab?';

async function seedLegacyCatalog(
  page: Page,
  input: {
    readonly workspaceId: string;
    readonly label: string;
    readonly marker: string;
  },
): Promise<void> {
  await bootOwner(page, {
    workspaceId: input.workspaceId,
    template: 'hidden-empty',
    root: '/projects/project-a',
    slug: 'project-a',
    starter: 'starter-a',
    hiddenEmptyBoot: true,
  });
  try {
    await writeOwnerFile(
      page,
      '/projects/project-a/package.json',
      '{"name":"legacy-project-a","private":true,"type":"module"}\n',
    );
    await writeOwnerFile(page, '/projects/project-a/legacy-marker.txt', `${input.marker}:a`);
    await writeOwnerFile(
      page,
      '/projects/project-b/package.json',
      '{"name":"legacy-project-b","private":true,"type":"module"}\n',
    );
    await writeOwnerFile(page, '/projects/project-b/legacy-marker.txt', `${input.marker}:b`);
    await writeOwnerFile(
      page,
      '/.rifty-project-index.json',
      `${JSON.stringify({
        activeId: 'project-a',
        scratch: null,
        projects: [
          {
            id: 'project-a',
            name: `${input.label} A`,
            starter: 'starter-a',
            editedAt: '2026-07-01T01:00:00.000Z',
          },
          {
            id: 'project-b',
            name: `${input.label} B`,
            starter: 'starter-b',
            editedAt: '2026-07-02T02:00:00.000Z',
          },
        ],
      })}\n`,
    );
    await flushOwnerDurable(page);
  } finally {
    await closeOwner(page);
  }
}

test('Playground companion installs and executes a Node CLI through one real Workbench owner', async ({
  page,
}) => {
  test.setTimeout(300_000);
  await gotoHarness(page);

  const registryRequests: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/npm-registry/')) {
      registryRequests.push(request.url());
    }
  });

  const result = await page.evaluate(
    async ({ argumentMarker, outputMarker }) => {
      type ProcessExit = { readonly code: number | null; readonly signal: string | null };
      type ProjectDefinition = object;
      type ProjectRun = {
        readonly terminal: {
          attach(listener: (chunk: string, stream: 'stdout' | 'stderr') => void): () => void;
        };
        readonly ready: Promise<void>;
        readonly exited: Promise<ProcessExit>;
        close(): Promise<ProcessExit>;
      };
      type ProjectSession = {
        readonly files: {
          readFile(path: string): Promise<{ readonly bytes: Uint8Array }>;
        };
        run(): ProjectRun;
        close(): Promise<void>;
      };
      type CatalogSnapshot = {
        readonly active:
          | { readonly kind: 'scratch' }
          | { readonly kind: 'project'; readonly id: string }
          | null;
        readonly scratch: {
          readonly starterId: string;
          readonly dirty: boolean;
          readonly editedAt: string;
        } | null;
      };
      type PlaygroundWorkbench = {
        readonly playground: {
          define(plan: {
            readonly kind: 'node-cli';
            readonly id: string;
            readonly starterId: string;
            readonly templateId: string;
            readonly files: Readonly<Record<string, string | Uint8Array>>;
            readonly dependencies: Readonly<Record<string, string>>;
            readonly firstMaterialization: { readonly kind: 'install' };
            readonly entryPath: string;
            readonly args: readonly string[];
          }): ProjectDefinition;
          readonly catalog: {
            createScratch(input: {
              readonly definition: ProjectDefinition;
            }): Promise<CatalogSnapshot>;
            snapshot(): CatalogSnapshot;
          };
        };
        openProject(definition: ProjectDefinition): Promise<ProjectSession>;
        close(): Promise<void>;
      };
      type CompanionEntry = {
        openPlaygroundWorkbench(options: {
          readonly deployment: {
            readonly workers: {
              readonly owner: string;
              readonly kernel: string;
              readonly node: string;
              readonly devServer: string;
            };
            readonly serviceWorker: { readonly url: string; readonly scope: string };
            readonly wasm: { readonly sqlite: string; readonly esbuild: string };
            readonly previewProbeTimeoutMs: number;
          };
          readonly packageAcquisition: { readonly registryUrl: string };
          readonly storage: { readonly persistence: 'ephemeral' };
        }): Promise<PlaygroundWorkbench>;
      };
      type HostAssets = {
        readonly workers: {
          readonly owner: string;
          readonly kernel: string;
          readonly node: string;
          readonly devServer: string;
        };
        readonly wasm: { readonly sqlite: string; readonly esbuild: string };
      };

      const withTimeout = <T>(
        operation: Promise<T>,
        label: string,
        timeoutMs: number,
      ): Promise<T> =>
        new Promise<T>((resolve, reject) => {
          const timer = window.setTimeout(
            () => reject(new Error(`${label} timed out after ${String(timeoutMs)}ms`)),
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

      const companionEntryUrl = '/src/workbench/playground.ts';
      const [companionModule, hostAssetsModule] = await Promise.all([
        import(/* @vite-ignore */ companionEntryUrl),
        import('/src/browser-unit/workbench-vite-host-assets.ts'),
      ]);
      const companionEntry = companionModule as unknown as CompanionEntry;
      const hostAssets = (hostAssetsModule as { readonly workbenchViteHostAssets: HostAssets })
        .workbenchViteHostAssets;
      const ownerWorkerUrl = new URL(hostAssets.workers.owner, location.href);
      const ownerWorkerBaseUrl = new URL('.', ownerWorkerUrl);
      const ownerWorkerReference = ownerWorkerUrl.href.slice(ownerWorkerBaseUrl.href.length);
      const baseElement = document.createElement('base');
      baseElement.href = ownerWorkerBaseUrl.href;
      document.head.prepend(baseElement);

      let workbench: PlaygroundWorkbench | null = null;
      let session: ProjectSession | null = null;
      let run: ProjectRun | null = null;
      let detach: (() => void) | null = null;
      try {
        workbench = await withTimeout(
          companionEntry.openPlaygroundWorkbench({
            deployment: {
              workers: { ...hostAssets.workers, owner: ownerWorkerReference },
              serviceWorker: { url: '/sw.js', scope: '/' },
              wasm: hostAssets.wasm,
              previewProbeTimeoutMs: 30_000,
            },
            packageAcquisition: { registryUrl: '/npm-registry' },
            storage: { persistence: 'ephemeral' },
          }),
          'Playground Workbench open',
          120_000,
        );
        const definition = workbench.playground.define({
          kind: 'node-cli',
          id: 'scratch',
          starterId: 'browser-unit-kleur-starter',
          templateId: 'browser-unit-kleur-cli-v1',
          files: {
            '/package.json': '{"name":"companion-kleur","private":true,"type":"module"}\n',
            '/src/cli.mjs': [
              "import kleur from 'kleur';",
              'kleur.enabled = true;',
              `console.log(kleur.green(${JSON.stringify(outputMarker)}), process.argv.slice(2).join(' '));`,
              '',
            ].join('\n'),
          },
          dependencies: { kleur: '4.1.5' },
          firstMaterialization: { kind: 'install' },
          entryPath: '/src/cli.mjs',
          args: [argumentMarker],
        });

        const created = await withTimeout(
          workbench.playground.catalog.createScratch({ definition }),
          'Scratch creation',
          30_000,
        );
        session = await withTimeout(workbench.openProject(definition), 'Scratch open', 120_000);
        run = session.run();
        const chunks: { readonly chunk: string; readonly stream: 'stdout' | 'stderr' }[] = [];
        detach = run.terminal.attach((chunk, stream) => chunks.push({ chunk, stream }));

        await withTimeout(run.ready, 'Node CLI admission', 30_000);
        const exit = await withTimeout(run.exited, 'Node CLI exit', 180_000);
        const closeExit = await withTimeout(run.close(), 'Node CLI run close', 30_000);
        run = null;
        detach();
        detach = null;

        const installedManifest = await withTimeout(
          session.files.readFile('/node_modules/kleur/package.json'),
          'installed kleur package read',
          30_000,
        );
        const installedVersion = (
          JSON.parse(new TextDecoder().decode(installedManifest.bytes)) as {
            readonly version: string;
          }
        ).version;
        const catalog = workbench.playground.catalog.snapshot();
        await withTimeout(session.close(), 'Scratch close', 60_000);
        session = null;
        await withTimeout(workbench.close(), 'Playground Workbench close', 60_000);
        workbench = null;

        return {
          created,
          catalog,
          exit,
          closeExit,
          installedVersion,
          output: chunks.map(({ chunk }) => chunk).join(''),
        };
      } finally {
        detach?.();
        if (run !== null) await run.close().catch(() => {});
        if (session !== null) await session.close().catch(() => {});
        if (workbench !== null) await workbench.close().catch(() => {});
        baseElement.remove();
      }
    },
    { argumentMarker: ARGUMENT_MARKER, outputMarker: OUTPUT_MARKER },
  );

  expect(result.created.active).toEqual({ kind: 'scratch' });
  expect(result.catalog.active).toEqual({ kind: 'scratch' });
  expect(result.catalog.scratch).toMatchObject({
    starterId: 'browser-unit-kleur-starter',
    dirty: false,
  });
  expect(result.exit).toEqual({ code: 0, signal: null });
  expect(result.closeExit).toEqual({ code: 0, signal: null });
  expect(result.installedVersion).toBe('4.1.5');

  const installCommand = result.output.indexOf('$ npm install');
  const install = result.output.indexOf('npm: installing all from package.json');
  const progress = result.output.indexOf('npm: + kleur@4.1.5');
  const childOutput = result.output.indexOf(OUTPUT_MARKER);
  expect(installCommand, result.output).toBeGreaterThanOrEqual(0);
  expect(install, result.output).toBeGreaterThan(installCommand);
  expect(progress, result.output).toBeGreaterThan(install);
  expect(childOutput, result.output).toBeGreaterThan(progress);
  expect(result.output).toContain(ARGUMENT_MARKER);
  expect(
    registryRequests.some((url) => /\/npm-registry\/kleur(?:\/|$)/u.test(new URL(url).pathname)),
  ).toBe(true);
});

test('real instant Vite preset keeps mapper port 5174 through snapshot restore and preview', async ({
  page,
}) => {
  test.setTimeout(300_000);
  await gotoHarness(page);

  const registryRequests: string[] = [];
  const snapshotRequests: string[] = [];
  page.context().on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith('/npm-registry/')) registryRequests.push(request.url());
    if (path === '/snapshots/vite-node-modules.json.gz') snapshotRequests.push(request.url());
  });

  const result = await page.evaluate(async () => {
    type ProcessExit = { readonly code: number | null; readonly signal: string | null };
    type Preview = { readonly port: number; readonly url: string };
    type ProjectDefinition = object;
    type ProjectRun = {
      readonly terminal: {
        attach(listener: (chunk: string, stream: 'stdout' | 'stderr') => void): () => void;
      };
      readonly ready: Promise<Preview>;
      close(): Promise<ProcessExit>;
    };
    type ProjectSession = {
      readonly files: {
        readFile(path: string): Promise<{ readonly bytes: Uint8Array }>;
      };
      run(): ProjectRun;
      close(): Promise<void>;
    };
    type PlaygroundPlan = {
      readonly kind: 'vite';
      readonly id: string;
      readonly port: number;
      readonly firstMaterialization:
        | { readonly kind: 'install' }
        | {
            readonly kind: 'snapshot';
            readonly snapshot: {
              readonly snapshotId: string;
              readonly assetUrl: string;
              readonly templateId: string;
            };
          };
    };
    type Preset = {
      readonly id: string;
      readonly setup: 'instant' | 'from-scratch';
    };
    type PlaygroundWorkbench = {
      readonly playground: {
        define(plan: PlaygroundPlan): ProjectDefinition;
        readonly catalog: {
          createScratch(input: {
            readonly definition: ProjectDefinition;
          }): Promise<unknown>;
        };
      };
      openProject(definition: ProjectDefinition): Promise<ProjectSession>;
      close(): Promise<void>;
    };
    type CompanionEntry = {
      openPlaygroundWorkbench(options: {
        readonly deployment: {
          readonly workers: {
            readonly owner: string;
            readonly kernel: string;
            readonly node: string;
            readonly devServer: string;
          };
          readonly serviceWorker: { readonly url: string; readonly scope: string };
          readonly wasm: { readonly sqlite: string; readonly esbuild: string };
          readonly previewProbeTimeoutMs: number;
        };
        readonly packageAcquisition: { readonly registryUrl: string };
        readonly storage: { readonly persistence: 'ephemeral' };
      }): Promise<PlaygroundWorkbench>;
    };
    type HostAssets = {
      readonly workers: {
        readonly owner: string;
        readonly kernel: string;
        readonly node: string;
        readonly devServer: string;
      };
      readonly wasm: { readonly sqlite: string; readonly esbuild: string };
    };

    const withTimeout = <T>(operation: Promise<T>, label: string, timeoutMs: number): Promise<T> =>
      new Promise<T>((resolve, reject) => {
        const timer = window.setTimeout(
          () => reject(new Error(`${label} timed out after ${String(timeoutMs)}ms`)),
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

    const companionEntryUrl = '/src/workbench/playground.ts';
    const mapperUrl = '/src/adapters/playground-project-plan.ts';
    const [companionModule, mapperModule, presetsModule, starterModule, hostAssetsModule] =
      await Promise.all([
        import(/* @vite-ignore */ companionEntryUrl),
        import(/* @vite-ignore */ mapperUrl),
        import('/src/presets.ts'),
        import('/src/glue/starter.ts'),
        import('/src/browser-unit/workbench-vite-host-assets.ts'),
      ]);
    const companionEntry = companionModule as unknown as CompanionEntry;
    const toPlaygroundProjectPlan = (
      mapperModule as {
        readonly toPlaygroundProjectPlan: (input: {
          readonly projectId: string;
          readonly starter: unknown;
          readonly setup: 'instant' | 'from-scratch';
        }) => PlaygroundPlan;
      }
    ).toPlaygroundProjectPlan;
    const presets = (presetsModule as { readonly PRESETS: readonly Preset[] }).PRESETS;
    const starterFromPreset = (
      starterModule as { readonly starterFromPreset: (preset: Preset) => unknown }
    ).starterFromPreset;
    const preset = presets.find((candidate) => candidate.id === 'project-files');
    if (preset === undefined || preset.setup !== 'instant') {
      throw new Error('Real project-files instant preset is missing');
    }
    const plan = toPlaygroundProjectPlan({
      projectId: 'scratch',
      starter: starterFromPreset(preset),
      setup: preset.setup,
    });
    if (plan.kind !== 'vite') throw new Error('project-files did not map to Vite');
    if (plan.firstMaterialization.kind !== 'snapshot') {
      throw new Error('project-files did not map to its baked snapshot');
    }

    const hostAssets = (hostAssetsModule as { readonly workbenchViteHostAssets: HostAssets })
      .workbenchViteHostAssets;
    const ownerWorkerUrl = new URL(hostAssets.workers.owner, location.href);
    const ownerWorkerBaseUrl = new URL('.', ownerWorkerUrl);
    const ownerWorkerReference = ownerWorkerUrl.href.slice(ownerWorkerBaseUrl.href.length);
    const baseElement = document.createElement('base');
    baseElement.href = ownerWorkerBaseUrl.href;
    document.head.prepend(baseElement);

    let workbench: PlaygroundWorkbench | null = null;
    let session: ProjectSession | null = null;
    let run: ProjectRun | null = null;
    let detach: (() => void) | null = null;
    try {
      workbench = await withTimeout(
        companionEntry.openPlaygroundWorkbench({
          deployment: {
            workers: { ...hostAssets.workers, owner: ownerWorkerReference },
            serviceWorker: { url: '/sw.js', scope: '/' },
            wasm: hostAssets.wasm,
            previewProbeTimeoutMs: 30_000,
          },
          packageAcquisition: { registryUrl: '/npm-registry' },
          storage: { persistence: 'ephemeral' },
        }),
        'Playground Workbench open',
        120_000,
      );
      const definition = workbench.playground.define(plan);
      await withTimeout(
        workbench.playground.catalog.createScratch({ definition }),
        'Vite Scratch creation',
        30_000,
      );
      session = await withTimeout(workbench.openProject(definition), 'Vite Scratch open', 120_000);
      run = session.run();
      const chunks: string[] = [];
      detach = run.terminal.attach((chunk) => chunks.push(chunk));

      const preview = await withTimeout(run.ready, 'Vite preview ready', 180_000);
      const response = await withTimeout(
        fetch(new URL(preview.url, location.href), { cache: 'no-store' }),
        'Vite preview response',
        30_000,
      );
      const previewBody = await withTimeout(response.text(), 'Vite preview body', 30_000);
      const viteManifestRead = await withTimeout(
        session.files.readFile('/node_modules/vite/package.json'),
        'snapshot-restored Vite manifest read',
        30_000,
      );
      const parsedViteManifest = JSON.parse(new TextDecoder().decode(viteManifestRead.bytes)) as {
        readonly name: string;
        readonly version: string;
      };
      const viteManifest = {
        name: parsedViteManifest.name,
        version: parsedViteManifest.version,
      };
      const closeExit = await withTimeout(run.close(), 'Vite run close', 60_000);
      run = null;
      detach();
      detach = null;
      await withTimeout(session.close(), 'Vite Scratch close', 60_000);
      session = null;
      await withTimeout(workbench.close(), 'Playground Workbench close', 60_000);
      workbench = null;

      return {
        plan: {
          id: plan.id,
          port: plan.port,
          materializationKind: plan.firstMaterialization.kind,
          snapshot: plan.firstMaterialization.snapshot,
        },
        preview,
        previewStatus: response.status,
        previewBody,
        viteManifest,
        closeExit,
        output: chunks.join(''),
      };
    } finally {
      detach?.();
      if (run !== null) await run.close().catch(() => {});
      if (session !== null) await session.close().catch(() => {});
      if (workbench !== null) await workbench.close().catch(() => {});
      baseElement.remove();
    }
  });

  expect(result.plan.id).toBe('scratch');
  expect(result.plan.port).toBe(5174);
  expect(result.plan.materializationKind).toBe('snapshot');
  expect(result.plan.snapshot.snapshotId).toMatch(/^sha256:[0-9a-f]{64}$/u);
  expect(new URL(result.plan.snapshot.assetUrl, 'http://localhost').pathname).toBe(
    '/snapshots/vite-node-modules.json.gz',
  );
  expect(result.preview.port).toBe(5174);
  expect(result.preview.port).not.toBe(5173);
  expect(new URL(result.preview.url, 'http://localhost').pathname).toContain('/5174/');
  expect(result.previewStatus).toBe(200);
  expect(result.previewBody).toContain('<div id="app"></div>');
  expect(result.viteManifest).toEqual({ name: 'vite', version: expect.stringMatching(/^7\./u) });
  expect(result.closeExit).toEqual({ code: null, signal: 'SIGTERM' });
  expect(result.output).not.toContain('npm: installing');
  expect(registryRequests).toEqual([]);
  expect(snapshotRequests).toHaveLength(1);
});

test('selected historical workspace migrates through one physical Workbench owner across project sessions', async ({
  page,
}) => {
  test.setTimeout(300_000);
  await gotoHarness(page);
  await seedLegacyCatalog(page, {
    workspaceId: DECOY_LEGACY_WORKSPACE_ID,
    label: 'Decoy',
    marker: 'decoy-workspace',
  });
  await seedLegacyCatalog(page, {
    workspaceId: SELECTED_LEGACY_WORKSPACE_ID,
    label: 'Selected',
    marker: 'selected-workspace',
  });
  await page.evaluate((workspaceId) => {
    sessionStorage.setItem('rifty.workspaceId', workspaceId);
  }, SELECTED_LEGACY_WORKSPACE_ID);

  const result = await page.evaluate(async () => {
    type ProjectDefinition = object;
    type ProjectSession = {
      readonly files: {
        readFile(path: string): Promise<{ readonly bytes: Uint8Array }>;
      };
      close(): Promise<void>;
    };
    type CatalogSnapshot = {
      readonly active:
        | { readonly kind: 'scratch' }
        | { readonly kind: 'project'; readonly id: string }
        | null;
      readonly scratch: {
        readonly starterId: string;
        readonly dirty: boolean;
        readonly editedAt: string;
      } | null;
      readonly projects: readonly {
        readonly id: string;
        readonly name: string;
        readonly starterId: string;
        readonly editedAt: string;
      }[];
    };
    type PlaygroundWorkbench = {
      readonly playground: {
        define(plan: {
          readonly kind: 'node-cli';
          readonly id: string;
          readonly starterId: string;
          readonly templateId: string;
          readonly files: Readonly<Record<string, string | Uint8Array>>;
          readonly firstMaterialization: { readonly kind: 'install' };
          readonly entryPath: string;
          readonly args: readonly string[];
        }): ProjectDefinition;
        readonly catalog: {
          snapshot(): CatalogSnapshot;
          activate(target: {
            readonly kind: 'project';
            readonly id: string;
          }): Promise<CatalogSnapshot>;
        };
      };
      openProject(definition: ProjectDefinition): Promise<ProjectSession>;
      close(): Promise<void>;
    };
    type CompanionEntry = {
      openPlaygroundWorkbench(options: {
        readonly deployment: {
          readonly workers: {
            readonly owner: string;
            readonly kernel: string;
            readonly node: string;
            readonly devServer: string;
          };
          readonly serviceWorker: { readonly url: string; readonly scope: string };
          readonly wasm: { readonly sqlite: string; readonly esbuild: string };
          readonly previewProbeTimeoutMs: number;
        };
        readonly packageAcquisition: { readonly registryUrl: string };
        readonly storage: { readonly persistence: 'required' };
      }): Promise<PlaygroundWorkbench>;
    };
    type HostAssets = {
      readonly workers: {
        readonly owner: string;
        readonly kernel: string;
        readonly node: string;
        readonly devServer: string;
      };
      readonly wasm: { readonly sqlite: string; readonly esbuild: string };
    };

    const withTimeout = <T>(operation: Promise<T>, label: string, timeoutMs: number): Promise<T> =>
      new Promise<T>((resolve, reject) => {
        const timer = window.setTimeout(
          () => reject(new Error(`${label} timed out after ${String(timeoutMs)}ms`)),
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

    const hostAssetsModule = await import('/src/browser-unit/workbench-vite-host-assets.ts');
    const hostAssets = (hostAssetsModule as { readonly workbenchViteHostAssets: HostAssets })
      .workbenchViteHostAssets;
    const ownerWorkerUrl = new URL(hostAssets.workers.owner, location.href);
    const ownerWorkerBaseUrl = new URL('.', ownerWorkerUrl);
    const ownerWorkerReference = ownerWorkerUrl.href.slice(ownerWorkerBaseUrl.href.length);
    const baseElement = document.createElement('base');
    baseElement.href = ownerWorkerBaseUrl.href;
    document.head.prepend(baseElement);

    const workerSpawns: { readonly argv: readonly string[]; readonly entryUrl: string }[] = [];
    const NativeWorker = window.Worker;
    const ObservedWorker = new Proxy(NativeWorker, {
      construct(target, args) {
        const worker = Reflect.construct(target, args, target) as Worker;
        const postMessage = worker.postMessage.bind(worker);
        worker.postMessage = ((
          message: unknown,
          transferOrOptions?: StructuredSerializeOptions | Transferable[],
        ): void => {
          const frame = message as {
            readonly type?: unknown;
            readonly spec?: {
              readonly argv?: readonly unknown[];
              readonly entry?: { readonly url?: unknown };
            };
          };
          if (frame.type === 'init' && Array.isArray(frame.spec?.argv)) {
            workerSpawns.push({
              argv: frame.spec.argv.map(String),
              entryUrl: String(frame.spec.entry?.url),
            });
          }
          Reflect.apply(
            postMessage,
            worker,
            transferOrOptions === undefined ? [message] : [message, transferOrOptions],
          );
        }) as Worker['postMessage'];
        return worker;
      },
    });
    (window as unknown as { Worker: typeof Worker }).Worker = ObservedWorker;

    const defineLegacyProject = (
      workbench: PlaygroundWorkbench,
      id: 'project-a' | 'project-b',
      starterId: 'starter-a' | 'starter-b',
    ): ProjectDefinition =>
      workbench.playground.define({
        kind: 'node-cli',
        id,
        starterId,
        templateId: 'legacy-browser-cli-v1',
        files: {
          '/package.json': '{"name":"legacy-baseline","private":true,"type":"module"}\n',
          '/src/cli.mjs': 'console.log("legacy baseline");\n',
        },
        firstMaterialization: { kind: 'install' },
        entryPath: '/src/cli.mjs',
        args: [],
      });

    let workbench: PlaygroundWorkbench | null = null;
    let session: ProjectSession | null = null;
    try {
      const companionModule = await import(/* @vite-ignore */ '/src/workbench/playground.ts');
      const companionEntry = companionModule as unknown as CompanionEntry;
      workbench = await withTimeout(
        companionEntry.openPlaygroundWorkbench({
          deployment: {
            workers: { ...hostAssets.workers, owner: ownerWorkerReference },
            serviceWorker: { url: '/sw.js', scope: '/' },
            wasm: hostAssets.wasm,
            previewProbeTimeoutMs: 30_000,
          },
          packageAcquisition: { registryUrl: '/npm-registry' },
          storage: { persistence: 'required' },
        }),
        'legacy Playground Workbench open',
        120_000,
      );
      const migrated = workbench.playground.catalog.snapshot();
      const projectA = defineLegacyProject(workbench, 'project-a', 'starter-a');
      session = await withTimeout(
        workbench.openProject(projectA),
        'legacy project A adoption',
        120_000,
      );
      const markerA = new TextDecoder().decode(
        (
          await withTimeout(
            session.files.readFile('/legacy-marker.txt'),
            'legacy project A marker read',
            30_000,
          )
        ).bytes,
      );
      await withTimeout(session.close(), 'legacy project A close', 60_000);
      session = null;

      await withTimeout(
        workbench.playground.catalog.activate({ kind: 'project', id: 'project-b' }),
        'legacy project B activation',
        30_000,
      );
      const projectB = defineLegacyProject(workbench, 'project-b', 'starter-b');
      session = await withTimeout(
        workbench.openProject(projectB),
        'legacy project B adoption',
        120_000,
      );
      const markerB = new TextDecoder().decode(
        (
          await withTimeout(
            session.files.readFile('/legacy-marker.txt'),
            'legacy project B marker read',
            30_000,
          )
        ).bytes,
      );
      await withTimeout(session.close(), 'legacy project B close', 60_000);
      session = null;
      const afterSwitch = workbench.playground.catalog.snapshot();
      await withTimeout(workbench.close(), 'legacy Playground Workbench close', 60_000);
      workbench = null;

      return { migrated, afterSwitch, markerA, markerB, workerSpawns };
    } finally {
      if (session !== null) await session.close().catch(() => {});
      if (workbench !== null) await workbench.close().catch(() => {});
      (window as unknown as { Worker: typeof Worker }).Worker = NativeWorker;
      sessionStorage.removeItem('rifty.workspaceId');
      baseElement.remove();
    }
  });

  expect(result.migrated).toEqual({
    active: { kind: 'project', id: 'project-a' },
    scratch: null,
    projects: [
      {
        id: 'project-a',
        name: 'Selected A',
        starterId: 'starter-a',
        editedAt: '2026-07-01T01:00:00.000Z',
      },
      {
        id: 'project-b',
        name: 'Selected B',
        starterId: 'starter-b',
        editedAt: '2026-07-02T02:00:00.000Z',
      },
    ],
  });
  expect(result.markerA).toBe('selected-workspace:a');
  expect(result.markerB).toBe('selected-workspace:b');
  expect(result.afterSwitch.active).toEqual({ kind: 'project', id: 'project-b' });
  expect(result.workerSpawns).toEqual([
    {
      argv: ['rifty', 'workbench-owner'],
      entryUrl: expect.stringContaining('workbench-owner-bootstrap'),
    },
  ]);
});

test('forSession TypeScript uses the real owner service and returns only project-rooted paths', async ({
  page,
}) => {
  test.setTimeout(300_000);
  await gotoHarness(page);

  const result = await page.evaluate(async () => {
    type Diagnostic = { readonly code?: number | string; readonly message: string };
    type DefinitionLinks = {
      readonly locations: readonly { readonly targetUri: string }[];
    };
    type ProjectDefinition = object;
    type ProjectSession = { close(): Promise<void> };
    type PlaygroundTypeScript = {
      open(path: string, text: string): Promise<void>;
      getSemanticDiagnostics(path: string): Promise<readonly Diagnostic[]>;
      getDefinitionLinks(
        path: string,
        position: { readonly line: number; readonly character: number },
      ): Promise<DefinitionLinks>;
    };
    type PlaygroundPlan = {
      readonly kind: 'vite';
      readonly id: string;
      readonly starterId: string;
      readonly templateId: string;
      readonly files: Readonly<Record<string, string | Uint8Array>>;
      readonly dependencies?: Readonly<Record<string, string>>;
      readonly devDependencies?: Readonly<Record<string, string>>;
      readonly port: number;
      readonly firstMaterialization:
        | { readonly kind: 'install' }
        | {
            readonly kind: 'snapshot';
            readonly snapshot: {
              readonly snapshotId: string;
              readonly assetUrl: string;
              readonly templateId: string;
            };
          };
    };
    type PlaygroundWorkbench = {
      readonly playground: {
        define(plan: PlaygroundPlan): ProjectDefinition;
        readonly catalog: {
          createScratch(input: {
            readonly definition: ProjectDefinition;
          }): Promise<unknown>;
        };
        forSession(session: ProjectSession): {
          readonly typescript: PlaygroundTypeScript;
        };
      };
      openProject(definition: ProjectDefinition): Promise<ProjectSession>;
      close(): Promise<void>;
    };
    type CompanionEntry = {
      openPlaygroundWorkbench(options: {
        readonly deployment: {
          readonly workers: {
            readonly owner: string;
            readonly kernel: string;
            readonly node: string;
            readonly devServer: string;
          };
          readonly serviceWorker: { readonly url: string; readonly scope: string };
          readonly wasm: { readonly sqlite: string; readonly esbuild: string };
          readonly previewProbeTimeoutMs: number;
        };
        readonly packageAcquisition: { readonly registryUrl: string };
        readonly storage: { readonly persistence: 'ephemeral' };
      }): Promise<PlaygroundWorkbench>;
    };
    type Preset = { readonly id: string; readonly setup: 'instant' | 'from-scratch' };
    type HostAssets = {
      readonly workers: {
        readonly owner: string;
        readonly kernel: string;
        readonly node: string;
        readonly devServer: string;
      };
      readonly wasm: { readonly sqlite: string; readonly esbuild: string };
    };

    const withTimeout = <T>(operation: Promise<T>, label: string, timeoutMs: number): Promise<T> =>
      new Promise<T>((resolve, reject) => {
        const timer = window.setTimeout(
          () => reject(new Error(`${label} timed out after ${String(timeoutMs)}ms`)),
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

    const [companionModule, mapperModule, presetsModule, starterModule, hostAssetsModule] =
      await Promise.all([
        import(/* @vite-ignore */ '/src/workbench/playground.ts'),
        import(/* @vite-ignore */ '/src/adapters/playground-project-plan.ts'),
        import('/src/presets.ts'),
        import('/src/glue/starter.ts'),
        import('/src/browser-unit/workbench-vite-host-assets.ts'),
      ]);
    const companionEntry = companionModule as unknown as CompanionEntry;
    const toPlaygroundProjectPlan = (
      mapperModule as {
        readonly toPlaygroundProjectPlan: (input: {
          readonly projectId: string;
          readonly starter: unknown;
          readonly setup: 'instant' | 'from-scratch';
        }) => PlaygroundPlan;
      }
    ).toPlaygroundProjectPlan;
    const presets = (presetsModule as { readonly PRESETS: readonly Preset[] }).PRESETS;
    const starterFromPreset = (
      starterModule as { readonly starterFromPreset: (preset: Preset) => unknown }
    ).starterFromPreset;
    const preset = presets.find((candidate) => candidate.id === 'typescript-ls');
    if (preset === undefined || preset.setup !== 'instant') {
      throw new Error('Real TypeScript instant preset is missing');
    }
    const plan = toPlaygroundProjectPlan({
      projectId: 'scratch',
      starter: starterFromPreset(preset),
      setup: preset.setup,
    });
    if (plan.kind !== 'vite' || plan.firstMaterialization.kind !== 'snapshot') {
      throw new Error('TypeScript preset did not map to its exact Vite snapshot');
    }

    const hostAssets = (hostAssetsModule as { readonly workbenchViteHostAssets: HostAssets })
      .workbenchViteHostAssets;
    const ownerWorkerUrl = new URL(hostAssets.workers.owner, location.href);
    const ownerWorkerBaseUrl = new URL('.', ownerWorkerUrl);
    const ownerWorkerReference = ownerWorkerUrl.href.slice(ownerWorkerBaseUrl.href.length);
    const baseElement = document.createElement('base');
    baseElement.href = ownerWorkerBaseUrl.href;
    document.head.prepend(baseElement);

    let workbench: PlaygroundWorkbench | null = null;
    let session: ProjectSession | null = null;
    try {
      workbench = await withTimeout(
        companionEntry.openPlaygroundWorkbench({
          deployment: {
            workers: { ...hostAssets.workers, owner: ownerWorkerReference },
            serviceWorker: { url: '/sw.js', scope: '/' },
            wasm: hostAssets.wasm,
            previewProbeTimeoutMs: 30_000,
          },
          packageAcquisition: { registryUrl: '/npm-registry' },
          storage: { persistence: 'ephemeral' },
        }),
        'TypeScript Playground Workbench open',
        120_000,
      );
      const definition = workbench.playground.define(plan);
      await withTimeout(
        workbench.playground.catalog.createScratch({ definition }),
        'TypeScript Scratch creation',
        30_000,
      );
      session = await withTimeout(
        workbench.openProject(definition),
        'TypeScript Scratch open',
        120_000,
      );
      const typescript = workbench.playground.forSession(session).typescript;
      const source = [
        "import { clamp } from './math';",
        'const broken: string = clamp(1, 0, 2);',
        '',
      ].join('\n');
      await withTimeout(
        typescript.open('/src/main.ts', source),
        'real TypeScript document open',
        60_000,
      );
      const diagnostics = await withTimeout(
        typescript.getSemanticDiagnostics('/src/main.ts'),
        'real TypeScript diagnostics',
        120_000,
      );
      const links = await withTimeout(
        typescript.getDefinitionLinks('/src/main.ts', {
          line: 1,
          character: 'const broken: string = '.length,
        }),
        'real TypeScript definition',
        120_000,
      );
      await withTimeout(session.close(), 'TypeScript Scratch close', 60_000);
      session = null;
      await withTimeout(workbench.close(), 'TypeScript Playground Workbench close', 60_000);
      workbench = null;

      return { diagnostics, links };
    } finally {
      if (session !== null) await session.close().catch(() => {});
      if (workbench !== null) await workbench.close().catch(() => {});
      baseElement.remove();
    }
  });

  expect(result.diagnostics.map(({ code }) => code)).toContain(2322);
  expect(
    result.diagnostics.some(({ message }) => /number.*string|string.*number/u.test(message)),
  ).toBe(true);
  expect(result.links.locations.map(({ targetUri }) => targetUri)).toEqual(['/src/math.ts']);
  expect(result.links.locations.every(({ targetUri }) => targetUri.startsWith('/'))).toBe(true);
  expect(result.links.locations.every(({ targetUri }) => !targetUri.includes('/.rifty/'))).toBe(
    true,
  );
});
