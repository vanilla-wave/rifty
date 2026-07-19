import { expect, test } from '@playwright/test';
import { gotoHarness } from './fixtures.ts';
import { pinPublicEsbuild0280 } from './pinned-public-esbuild.ts';

const RETAINED_BYTES = 'retained-through-project-switch';
const INITIAL_HMR_MARKER = 'workbench-public-files-v1';
const UPDATED_HMR_MARKER = 'workbench-public-files-v2';
const HMR_EVENT_TYPE = 'rifty:workbench-public-hmr';

test('public Workbench keeps one ephemeral owner across exact Vite A to B to A lifecycle', async ({
  page,
}) => {
  test.setTimeout(300_000);
  await gotoHarness(page);
  const pinnedEsbuildRequests = await pinPublicEsbuild0280(page);

  const workerAssets = await page.evaluate(async () => {
    const hostAssetsModule = await import('/src/browser-unit/workbench-vite-host-assets.ts');
    const workers = (
      hostAssetsModule as {
        readonly workbenchViteHostAssets: {
          readonly workers: { readonly owner: string; readonly kernel: string };
        };
      }
    ).workbenchViteHostAssets.workers;
    return {
      owner: new URL(workers.owner, location.href).href,
      kernel: new URL(workers.kernel, location.href).href,
    };
  });
  const ownerLifecycle: string[] = [];
  let ownerCarrierObserved = false;
  let ownerEntryLoads = 0;
  await page.exposeFunction('__recordWorkbenchLifecycle', (event: string) => {
    ownerLifecycle.push(event);
  });
  page.on('request', (request) => {
    if (request.url() === workerAssets.owner) ownerEntryLoads += 1;
  });
  page.on('worker', (worker) => {
    if (ownerCarrierObserved || worker.url() !== workerAssets.kernel) return;
    ownerCarrierObserved = true;
    ownerLifecycle.push('owner-started');
    worker.on('close', () => ownerLifecycle.push('owner-closed'));
  });
  await page.evaluate((kernelWorkerAsset) => {
    const NativeWorker = globalThis.Worker;
    let ownerCarrierConstructions = 0;
    const ObservedWorker = new Proxy(NativeWorker, {
      construct(target, args) {
        const worker = Reflect.construct(target, args) as Worker;
        const script = args[0];
        if (
          (typeof script === 'string' || script instanceof URL) &&
          new URL(String(script), location.href).href === kernelWorkerAsset
        ) {
          ownerCarrierConstructions += 1;
        }
        return worker;
      },
    });
    Object.defineProperty(globalThis, '__workbenchOwnerCarrierProbe', {
      configurable: true,
      value: Object.freeze({
        constructions: () => ownerCarrierConstructions,
        restore: () => {
          globalThis.Worker = NativeWorker;
          Reflect.deleteProperty(globalThis, '__workbenchOwnerCarrierProbe');
        },
      }),
    });
    globalThis.Worker = ObservedWorker;
  }, workerAssets.kernel);

  const evaluationInput = JSON.stringify({
    retainedBytes: RETAINED_BYTES,
    initialHmrMarker: INITIAL_HMR_MARKER,
    updatedHmrMarker: UPDATED_HMR_MARKER,
    hmrEventType: HMR_EVENT_TYPE,
  });
  const result = await page.evaluate(async (serializedInput) => {
    const { retainedBytes, initialHmrMarker, updatedHmrMarker, hmrEventType } = JSON.parse(
      serializedInput,
    ) as {
      readonly retainedBytes: string;
      readonly initialHmrMarker: string;
      readonly updatedHmrMarker: string;
      readonly hmrEventType: string;
    };
    type Exit = { readonly code: number | null; readonly signal: string | null };
    type Preview = { readonly port: number; readonly url: string };
    type ProjectFileEntry = {
      readonly path: string;
      readonly kind: 'file' | 'dir';
      readonly size: number;
      readonly version: string;
    };
    type ProjectFiles = {
      readFile(path: string): Promise<{
        readonly path: string;
        readonly bytes: Uint8Array;
        readonly version: string;
      }>;
      readdir(path: string): Promise<readonly ProjectFileEntry[]>;
      writeFile(
        path: string,
        data: Uint8Array,
        options: { readonly expectedVersion: string | null },
      ): Promise<{ readonly path: string; readonly version: string }>;
      rename(
        sourcePath: string,
        targetPath: string,
        options: {
          readonly expectedSourceVersion: string;
          readonly expectedTargetVersion: string | null;
        },
      ): Promise<{ readonly path: string; readonly version: string }>;
      remove(
        path: string,
        options: { readonly expectedVersion: string; readonly recursive?: boolean },
      ): Promise<void>;
      snapshot(): { readonly entries: readonly ProjectFileEntry[] };
    };
    type PublicFileConflictError = Error & {
      readonly path: string;
      readonly expectedVersion: string | null;
      readonly actualVersion: string | null;
      readonly actualEntry: ProjectFileEntry | null;
      readonly actualBytes: Uint8Array | null;
    };
    type PublicProjectFileOperationError = Error & {
      readonly operation: string;
      readonly path: string;
      readonly mutationOutcome: 'applied' | 'unknown' | null;
    };
    type ProjectDocument = {
      snapshot(): {
        readonly bytes: Uint8Array;
        readonly version: string | null;
        readonly dirty: boolean;
        readonly conflict: {
          readonly actualVersion: string | null;
          readonly actualEntry: ProjectFileEntry | null;
          readonly actualBytes: Uint8Array | null;
        } | null;
      };
      replace(data: string | Uint8Array): void;
      save(): Promise<void>;
      close(options?: { readonly dirty: 'save' | 'discard' }): Promise<void>;
    };
    type ProjectDocuments = {
      open(path: string): Promise<ProjectDocument>;
    };
    type TerminalRun = {
      readonly ready: Promise<void>;
      readonly exited: Promise<Exit>;
      close(): Promise<Exit>;
    };
    type Terminal = {
      run(line: string): TerminalRun;
      attach(listener: (chunk: string, stream: 'stdout' | 'stderr') => void): () => void;
      resize(cols: number, rows: number): Promise<void>;
      close(): Promise<void>;
    };
    type ProjectRun = {
      readonly terminal: Terminal;
      readonly ready: Promise<Preview>;
      readonly exited: Promise<Exit>;
      close(): Promise<Exit>;
    };
    type Project = {
      readonly files: ProjectFiles;
      readonly documents: ProjectDocuments;
      run(): ProjectRun;
      readonly terminals: { open(): Terminal };
      close(): Promise<void>;
    };
    type Workbench = {
      snapshot(): {
        readonly storage: {
          readonly policy: string;
          readonly backend: string;
          readonly durability: string;
        };
      };
      openProject(definition: unknown): Promise<Project>;
      close(): Promise<void>;
    };
    type PublicEntry = {
      readonly FileConflictError: new (details: {
        readonly path: string;
        readonly expectedVersion: string | null;
        readonly actualVersion: string | null;
        readonly actualEntry: ProjectFileEntry | null;
        readonly actualBytes: Uint8Array | null;
      }) => PublicFileConflictError;
      readonly ProjectFileOperationError: new (details: {
        readonly operation: string;
        readonly path: string;
        readonly mutationOutcome: 'applied' | 'unknown' | null;
      }) => PublicProjectFileOperationError;
      openWorkbench(options: {
        readonly deployment: {
          readonly workers: {
            readonly owner: string;
            readonly kernel: string;
            readonly node: string;
            readonly devServer: string;
          };
          readonly serviceWorker: { readonly url: string; readonly scope: string };
          readonly wasm: { readonly sqlite: string };
          readonly previewProbeTimeoutMs: number;
        };
        readonly packageAcquisition: { readonly registryUrl: string };
        readonly storage: { readonly persistence: 'ephemeral' };
      }): Promise<Workbench>;
      readonly projects: {
        vite(options: {
          readonly id: string;
          readonly files: Readonly<Record<string, string | Uint8Array>>;
          readonly viteVersion?: string;
        }): unknown;
      };
    };
    type HostAssets = {
      readonly workers: {
        readonly owner: string;
        readonly kernel: string;
        readonly node: string;
        readonly devServer: string;
      };
      readonly wasm: { readonly sqlite: string };
    };
    type LifecycleProbe = {
      __recordWorkbenchLifecycle(event: string): Promise<void>;
    };
    type OwnerCarrierProbe = {
      constructions(): number;
      restore(): void;
    };

    const withTimeout = <T>(operation: Promise<T>, label: string, timeoutMs: number): Promise<T> =>
      new Promise<T>((resolve, reject) => {
        const timer = window.setTimeout(
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
        if (performance.now() >= deadline) {
          throw new Error(`${label} timed out after ${timeoutMs}ms`);
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    };

    const responseText = async (url: string, label: string) => {
      const response = await withTimeout(
        fetch(url, { cache: 'no-store' }),
        `${label} request`,
        30_000,
      );
      const body = await withTimeout(response.text(), `${label} body`, 30_000);
      return {
        status: response.status,
        contentType: response.headers.get('content-type') ?? '',
        body,
      };
    };

    const hmrSource = (marker: string): string => `
const generationKey = '__riftyWorkbenchPublicHmrGeneration';
const generation = (globalThis[generationKey] ?? 0) + 1;
globalThis[generationKey] = generation;
const marker = ${JSON.stringify(marker)};
const app = document.getElementById('app');
if (!app) throw new Error('Missing #app root');
app.textContent = marker;
parent.postMessage({ type: ${JSON.stringify(hmrEventType)}, marker, generation }, '*');
if (import.meta.hot) import.meta.hot.accept();
`;

    const runTerminal = async (project: Project, line: string, label: string) => {
      const terminal = project.terminals.open();
      let output = '';
      const detach = terminal.attach((chunk) => {
        output += chunk;
      });
      try {
        const run = terminal.run(line);
        const exit = await withTimeout(run.exited, `${label} exit`, 30_000);
        const closeExit = await withTimeout(run.close(), `${label} close`, 30_000);
        return { exit, closeExit, output };
      } finally {
        detach();
        await withTimeout(terminal.close(), `${label} terminal close`, 30_000);
      }
    };

    const closeRun = async (run: ProjectRun, previewUrl: string, label: string) => {
      const closing = run.close();
      const exit = await withTimeout(run.exited, `${label} exit`, 30_000);
      const closeExit = await withTimeout(closing, `${label} close`, 30_000);
      const revoked = await responseText(previewUrl, `${label} revoked preview`);
      await withTimeout(run.terminal.resize(81, 25), `${label} open-project resize`, 30_000);
      return { exit, closeExit, revoked };
    };

    const closeProject = async (
      project: Project,
      run: ProjectRun,
      previewUrl: string,
      label: string,
      sibling?: { readonly terminal: Terminal; readonly run: TerminalRun },
    ) => {
      const runOrder: string[] = [];
      const runExit = run.exited.then((exit) => {
        runOrder.push('run-exited');
        return exit;
      });
      const siblingOrder: string[] = [];
      const siblingExit = sibling?.run.exited.then((exit) => {
        siblingOrder.push('sibling-exited');
        return exit;
      });

      await withTimeout(
        project.close().then(() => {
          runOrder.push('project-closed');
          siblingOrder.push('project-closed');
        }),
        `${label} close`,
        60_000,
      );
      const closedHandle = async (operation: () => Promise<void>, operationLabel: string) => {
        try {
          await withTimeout(
            Promise.resolve().then(operation),
            `${operationLabel} rejection`,
            10_000,
          );
          return { rejected: false, name: '', message: '' };
        } catch (error) {
          return {
            rejected: true,
            name: error instanceof Error ? error.name : '',
            message: error instanceof Error ? error.message : String(error),
          };
        }
      };
      const terminalClosure = {
        default: await closedHandle(
          () => run.terminal.resize(80, 24),
          `${label} default terminal resize`,
        ),
        sibling:
          sibling === undefined
            ? null
            : await closedHandle(
                () => sibling.terminal.resize(80, 24),
                `${label} sibling terminal resize`,
              ),
      };
      const exit = await withTimeout(runExit, `${label} run exit`, 30_000);
      const closeExit = await withTimeout(run.close(), `${label} run close`, 30_000);
      const siblingClose =
        sibling === undefined || siblingExit === undefined
          ? null
          : {
              order: siblingOrder,
              exit: await withTimeout(siblingExit, `${label} sibling exit`, 30_000),
              closeExit: await withTimeout(
                sibling.run.close(),
                `${label} sibling run close`,
                30_000,
              ),
            };
      const revoked = await responseText(previewUrl, `${label} revoked preview`);
      return {
        order: runOrder,
        exit,
        closeExit,
        sibling: siblingClose,
        terminalClosure,
        revoked,
      };
    };

    const publicEntryUrl: string = '/src/browser-unit/workbench-public-entry.ts';
    const [publicEntryModule, hostAssetsModule] = await Promise.all([
      import(/* @vite-ignore */ publicEntryUrl),
      import('/src/browser-unit/workbench-vite-host-assets.ts'),
    ]);
    const publicEntry = publicEntryModule as unknown as PublicEntry;
    const expectFileConflict = async (
      operation: Promise<unknown>,
    ): Promise<PublicFileConflictError> => {
      try {
        await operation;
      } catch (error) {
        if (error instanceof publicEntry.FileConflictError) return error;
        throw error;
      }
      throw new Error('Expected FileConflictError');
    };
    const expectFileOperationError = async (
      operation: Promise<unknown>,
    ): Promise<PublicProjectFileOperationError> => {
      try {
        await operation;
      } catch (error) {
        if (error instanceof publicEntry.ProjectFileOperationError) return error;
        throw error;
      }
      throw new Error('Expected ProjectFileOperationError');
    };
    const hostAssets = (hostAssetsModule as { readonly workbenchViteHostAssets: HostAssets })
      .workbenchViteHostAssets;
    const ownerWorkerUrl = new URL(hostAssets.workers.owner, location.href);
    const ownerWorkerBaseUrl = new URL('.', ownerWorkerUrl);
    const ownerWorkerReference = ownerWorkerUrl.href.slice(ownerWorkerBaseUrl.href.length);
    const baseElement = document.createElement('base');
    baseElement.href = ownerWorkerBaseUrl.href;
    document.head.prepend(baseElement);

    const defineProjectA = () =>
      publicEntry.projects.vite({
        id: 'browser-unit-workbench-owner-a',
        viteVersion: '7.3.6',
        files: {
          '/index.html':
            '<!doctype html><h1 hidden>workbench-owner-a</h1><div id="app"></div><script type="module" src="/src/main.js"></script>',
          '/src/main.js': hmrSource(initialHmrMarker),
        },
      });
    const definitionA = defineProjectA();
    const definitionB = publicEntry.projects.vite({
      id: 'browser-unit-workbench-owner-b',
      files: {
        '/index.html': '<!doctype html><h1>workbench-owner-b</h1>',
      },
    });

    const cleanupErrors: string[] = [];
    const ownerCarrierProbe = (
      globalThis as unknown as { readonly __workbenchOwnerCarrierProbe: OwnerCarrierProbe }
    ).__workbenchOwnerCarrierProbe;
    let workbench: Workbench | null = null;
    let activeProject: Project | null = null;
    let activeDocument: ProjectDocument | null = null;
    let previewFrame: HTMLIFrameElement | null = null;
    const hmrEvents: { readonly marker: string; readonly generation: number }[] = [];
    const onHmrMessage = (event: MessageEvent<unknown>): void => {
      if (previewFrame === null || event.source !== previewFrame.contentWindow) return;
      const data = event.data;
      if (
        typeof data !== 'object' ||
        data === null ||
        !('type' in data) ||
        data.type !== hmrEventType ||
        !('marker' in data) ||
        typeof data.marker !== 'string' ||
        !('generation' in data) ||
        !Number.isSafeInteger(data.generation)
      ) {
        return;
      }
      hmrEvents.push({ marker: data.marker, generation: data.generation as number });
    };
    globalThis.addEventListener('message', onHmrMessage);
    const recordCleanup = async (label: string, operation: () => Promise<unknown>) => {
      try {
        await operation();
      } catch (error) {
        cleanupErrors.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
      }
    };

    try {
      workbench = await withTimeout(
        publicEntry.openWorkbench({
          deployment: {
            workers: { ...hostAssets.workers, owner: ownerWorkerReference },
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
      const storage = workbench.snapshot().storage;

      const projectA = await withTimeout(
        workbench.openProject(definitionA),
        'project A open',
        120_000,
      );
      activeProject = projectA;
      const runA = projectA.run();
      const previewA = await withTimeout(runA.ready, 'project A Vite ready', 120_000);
      const previewARoot = new URL(previewA.url, location.href);
      const htmlA = await responseText(previewARoot.href, 'project A HTML');
      const viteClientA = await responseText(
        new URL('@vite/client', previewARoot).href,
        'project A guest Vite client',
      );

      previewFrame = document.createElement('iframe');
      previewFrame.src = previewARoot.href;
      document.body.append(previewFrame);
      await waitUntil(
        () =>
          hmrEvents.some((event) => event.marker === initialHmrMarker && event.generation === 1),
        'project A initial HMR module',
        30_000,
      );

      const encoder = new TextEncoder();
      const decoder = new TextDecoder();
      const describeConflict = (error: PublicFileConflictError) => ({
        name: error.name,
        path: error.path,
        expectedVersion: error.expectedVersion,
        actualVersion: error.actualVersion,
        actualEntry: error.actualEntry,
        actualBytes: error.actualBytes === null ? null : decoder.decode(error.actualBytes),
      });
      const createdPath = '/src/public-files-probe.txt';
      const renamedPath = '/src/public-files-probe-renamed.txt';
      const created = await projectA.files.writeFile(createdPath, encoder.encode('created'), {
        expectedVersion: null,
      });
      const createdRead = await projectA.files.readFile(createdPath);
      const createdReflected = projectA.files
        .snapshot()
        .entries.some((entry) => entry.path === createdPath && entry.version === created.version);
      const createConflict = await expectFileConflict(
        projectA.files.writeFile(createdPath, encoder.encode('blocked'), {
          expectedVersion: null,
        }),
      );
      const updated = await projectA.files.writeFile(createdPath, encoder.encode('current'), {
        expectedVersion: created.version,
      });
      const staleConflict = await expectFileConflict(
        projectA.files.writeFile(createdPath, encoder.encode('stale!!'), {
          expectedVersion: created.version,
        }),
      );
      const conflictRead = await projectA.files.readFile(createdPath);
      const targetCreated = await projectA.files.writeFile(renamedPath, encoder.encode('target!'), {
        expectedVersion: null,
      });
      const renameSourceConflict = await expectFileConflict(
        projectA.files.rename(createdPath, renamedPath, {
          expectedSourceVersion: created.version,
          expectedTargetVersion: targetCreated.version,
        }),
      );
      const renameTargetConflict = await expectFileConflict(
        projectA.files.rename(createdPath, renamedPath, {
          expectedSourceVersion: updated.version,
          expectedTargetVersion: null,
        }),
      );
      const renamed = await projectA.files.rename(createdPath, renamedPath, {
        expectedSourceVersion: updated.version,
        expectedTargetVersion: targetCreated.version,
      });
      const renamedRead = await projectA.files.readFile(renamedPath);
      const sourceReadFailure = await expectFileOperationError(
        projectA.files.readFile(createdPath),
      );
      const renamedDirectory = await projectA.files.readdir('/src');
      const renamedSnapshot = projectA.files.snapshot();
      const renamedReflected =
        renamedDirectory.some(
          (entry) => entry.path === renamedPath && entry.version === renamed.version,
        ) &&
        renamedSnapshot.entries.some(
          (entry) => entry.path === renamedPath && entry.version === renamed.version,
        );
      const sourceAbsentAfterRename =
        !renamedDirectory.some((entry) => entry.path === createdPath) &&
        !renamedSnapshot.entries.some((entry) => entry.path === createdPath);
      const removeConflict = await expectFileConflict(
        projectA.files.remove(renamedPath, { expectedVersion: targetCreated.version }),
      );
      const removeConflictRead = await projectA.files.readFile(renamedPath);
      await projectA.files.remove(renamedPath, { expectedVersion: renamed.version });
      const removedReflected =
        !(await projectA.files.readdir('/src')).some((entry) => entry.path === renamedPath) &&
        !projectA.files.snapshot().entries.some((entry) => entry.path === renamedPath);
      const fileCrud = {
        created: {
          path: created.path,
          version: created.version,
          readVersion: createdRead.version,
          bytes: decoder.decode(createdRead.bytes),
          reflected: createdReflected,
        },
        createConflict: describeConflict(createConflict),
        updated: {
          version: updated.version,
          preservedVersion: conflictRead.version,
          preservedBytes: decoder.decode(conflictRead.bytes),
        },
        staleConflict: describeConflict(staleConflict),
        targetCreated: { version: targetCreated.version },
        renameSourceConflict: describeConflict(renameSourceConflict),
        renameTargetConflict: describeConflict(renameTargetConflict),
        renamed: {
          path: renamed.path,
          version: renamed.version,
          readVersion: renamedRead.version,
          bytes: decoder.decode(renamedRead.bytes),
          reflected: renamedReflected,
          sourceAbsent: sourceAbsentAfterRename,
          sourceReadFailure: {
            name: sourceReadFailure.name,
            operation: sourceReadFailure.operation,
            path: sourceReadFailure.path,
            mutationOutcome: sourceReadFailure.mutationOutcome,
          },
        },
        removeConflict: {
          ...describeConflict(removeConflict),
          preservedVersion: removeConflictRead.version,
          preservedBytes: decoder.decode(removeConflictRead.bytes),
        },
        removed: removedReflected,
      };

      const conflictingDocument = await projectA.documents.open('/src/main.js');
      activeDocument = conflictingDocument;
      const openedDocument = conflictingDocument.snapshot();
      if (openedDocument.version === null) throw new Error('opened document version missing');
      const updatedSource = hmrSource(updatedHmrMarker);
      conflictingDocument.replace(updatedSource);
      const remoteSource = hmrSource('workbench-public-conflict-remote');
      const remoteWrite = await projectA.files.writeFile(
        '/src/main.js',
        encoder.encode(remoteSource),
        { expectedVersion: openedDocument.version },
      );
      const documentConflict = await expectFileConflict(conflictingDocument.save());
      const conflictedDocument = conflictingDocument.snapshot();
      await conflictingDocument.close({ dirty: 'discard' });
      activeDocument = null;

      const projectDocument = await projectA.documents.open('/src/main.js');
      activeDocument = projectDocument;
      const reopenedDocument = projectDocument.snapshot();
      projectDocument.replace(updatedSource);
      const dirtyBeforeSave = projectDocument.snapshot().dirty;
      await projectDocument.save();
      const savedDocument = projectDocument.snapshot();
      const reflectedDocument = await projectA.files.readFile('/src/main.js');
      const reflectedSnapshotVersion = projectA.files
        .snapshot()
        .entries.find((entry) => entry.path === '/src/main.js')?.version;
      await waitUntil(
        () => hmrEvents.some((event) => event.marker === updatedHmrMarker && event.generation >= 2),
        'project A public document HMR update',
        30_000,
      );
      const hmrUpdate = hmrEvents.findLast(
        (event) => event.marker === updatedHmrMarker && event.generation >= 2,
      );
      await projectDocument.close();
      activeDocument = null;
      const documentEdit = {
        opened: {
          version: openedDocument.version,
          bytes: decoder.decode(openedDocument.bytes),
        },
        remote: { version: remoteWrite.version },
        conflict: {
          ...describeConflict(documentConflict),
          localBytes: decoder.decode(conflictedDocument.bytes),
          localVersion: conflictedDocument.version,
          dirty: conflictedDocument.dirty,
          snapshotActualVersion: conflictedDocument.conflict?.actualVersion ?? null,
          snapshotActualEntry: conflictedDocument.conflict?.actualEntry ?? null,
          snapshotActualBytes:
            conflictedDocument.conflict?.actualBytes === null ||
            conflictedDocument.conflict?.actualBytes === undefined
              ? null
              : decoder.decode(conflictedDocument.conflict.actualBytes),
        },
        reopened: {
          version: reopenedDocument.version,
          bytes: decoder.decode(reopenedDocument.bytes),
        },
        dirtyBeforeSave,
        saved: { version: savedDocument.version, dirty: savedDocument.dirty },
        reflected: {
          version: reflectedDocument.version,
          snapshotVersion: reflectedSnapshotVersion ?? null,
          bytes: decoder.decode(reflectedDocument.bytes),
        },
        hmrUpdate,
      };
      previewFrame.remove();
      previewFrame = null;

      const write = await runTerminal(
        projectA,
        `printf %s ${retainedBytes} > retained.txt`,
        'project A retained write',
      );
      const siblingTerminalA = projectA.terminals.open();
      const siblingRunA = siblingTerminalA.run('sleep 60');
      await withTimeout(siblingRunA.ready, 'project A sibling admission', 30_000);
      const closeA = await closeProject(projectA, runA, previewARoot.href, 'project A', {
        terminal: siblingTerminalA,
        run: siblingRunA,
      });
      activeProject = null;
      await (globalThis as unknown as LifecycleProbe).__recordWorkbenchLifecycle(
        'project-a-closed',
      );

      const projectB = await withTimeout(
        workbench.openProject(definitionB),
        'project B open',
        120_000,
      );
      activeProject = projectB;
      const runB = projectB.run();
      const previewB = await withTimeout(runB.ready, 'project B Vite ready', 120_000);
      const previewBRoot = new URL(previewB.url, location.href);
      const htmlB = await responseText(previewBRoot.href, 'project B HTML');
      const closeBRun = await closeRun(runB, previewBRoot.href, 'project B run');
      const projectBStillOpen = await runTerminal(
        projectB,
        'printf workbench-project-b-still-open',
        'project B after run close',
      );
      await withTimeout(projectB.close(), 'project B close', 60_000);
      activeProject = null;
      await (globalThis as unknown as LifecycleProbe).__recordWorkbenchLifecycle(
        'project-b-closed',
      );

      const reopenedA = await withTimeout(
        workbench.openProject(defineProjectA()),
        'project A reopen',
        120_000,
      );
      activeProject = reopenedA;
      const reopenedRunA = reopenedA.run();
      const reopenedPreviewA = await withTimeout(
        reopenedRunA.ready,
        'reopened project A Vite ready',
        120_000,
      );
      const reopenedPreviewARoot = new URL(reopenedPreviewA.url, location.href);
      const reopenedHtmlA = await responseText(
        reopenedPreviewARoot.href,
        'reopened project A HTML',
      );
      const retained = await runTerminal(reopenedA, 'cat retained.txt', 'project A retained read');
      const reopenedCloseA = await closeProject(
        reopenedA,
        reopenedRunA,
        reopenedPreviewARoot.href,
        'reopened project A',
      );
      activeProject = null;
      await (globalThis as unknown as LifecycleProbe).__recordWorkbenchLifecycle(
        'reopened-project-a-closed',
      );

      await (globalThis as unknown as LifecycleProbe).__recordWorkbenchLifecycle(
        'workbench-close-started',
      );
      await withTimeout(workbench.close(), 'Workbench close', 60_000);
      workbench = null;
      await (globalThis as unknown as LifecycleProbe).__recordWorkbenchLifecycle(
        'workbench-closed',
      );

      return {
        storage,
        ownerCarrierConstructions: ownerCarrierProbe.constructions(),
        previewA: { port: previewA.port, html: htmlA, viteClient: viteClientA, close: closeA },
        previewB: {
          port: previewB.port,
          html: htmlB,
          runClose: closeBRun,
          projectStillOpen: projectBStillOpen,
        },
        reopenedPreviewA: {
          port: reopenedPreviewA.port,
          html: reopenedHtmlA,
          close: reopenedCloseA,
        },
        fileCrud,
        documentEdit,
        write,
        retained,
      };
    } catch (error) {
      if (activeDocument !== null) {
        const document = activeDocument;
        await recordCleanup('active document discard', () =>
          withTimeout(
            document.close({ dirty: 'discard' }),
            'active document cleanup discard',
            30_000,
          ),
        );
      }
      if (activeProject !== null) {
        await recordCleanup('active project close', () =>
          withTimeout(activeProject!.close(), 'active project cleanup close', 30_000),
        );
      }
      if (workbench !== null) {
        await recordCleanup('Workbench close', () =>
          withTimeout(workbench!.close(), 'Workbench cleanup close', 30_000),
        );
      }
      const cleanup = cleanupErrors.length === 0 ? '' : `; cleanup: ${cleanupErrors.join('; ')}`;
      throw new Error(`${error instanceof Error ? error.message : String(error)}${cleanup}`);
    } finally {
      previewFrame?.remove();
      globalThis.removeEventListener('message', onHmrMessage);
      baseElement.remove();
      ownerCarrierProbe.restore();
    }
  }, evaluationInput);

  expect(result.storage).toEqual({
    policy: 'ephemeral',
    backend: 'memory',
    durability: 'ephemeral',
  });
  expect(result.previewA.html).toMatchObject({ status: 200 });
  expect(result.previewA.html.contentType).toContain('text/html');
  expect(result.previewA.html.body).toContain('workbench-owner-a');
  expect(result.previewA.viteClient).toMatchObject({ status: 200 });
  expect(result.previewA.viteClient.contentType).toContain('javascript');
  expect(result.previewA.viteClient.body).toContain('createHotContext');
  expect(result.previewB.html).toMatchObject({ status: 200 });
  expect(result.previewB.html.contentType).toContain('text/html');
  expect(result.previewB.html.body).toContain('workbench-owner-b');
  expect(result.reopenedPreviewA.html).toMatchObject({ status: 200 });
  expect(result.reopenedPreviewA.html.contentType).toContain('text/html');
  expect(result.reopenedPreviewA.html.body).toContain('workbench-owner-a');
  const sourcePath = '/src/public-files-probe.txt';
  const targetPath = '/src/public-files-probe-renamed.txt';
  expect(result.fileCrud.created).toMatchObject({
    path: sourcePath,
    bytes: 'created',
    reflected: true,
  });
  expect(result.fileCrud.created.readVersion).toBe(result.fileCrud.created.version);
  expect(result.fileCrud.createConflict).toEqual({
    name: 'FileConflictError',
    path: sourcePath,
    expectedVersion: null,
    actualVersion: result.fileCrud.created.version,
    actualEntry: {
      path: sourcePath,
      kind: 'file',
      size: 7,
      version: result.fileCrud.created.version,
    },
    actualBytes: 'created',
  });
  expect(result.fileCrud.updated).toEqual({
    version: result.fileCrud.staleConflict.actualVersion,
    preservedVersion: result.fileCrud.staleConflict.actualVersion,
    preservedBytes: 'current',
  });
  expect(result.fileCrud.staleConflict).toEqual({
    name: 'FileConflictError',
    path: sourcePath,
    expectedVersion: result.fileCrud.created.version,
    actualVersion: result.fileCrud.updated.version,
    actualEntry: {
      path: sourcePath,
      kind: 'file',
      size: 7,
      version: result.fileCrud.updated.version,
    },
    actualBytes: 'current',
  });
  expect(result.fileCrud.renameSourceConflict).toEqual({
    name: 'FileConflictError',
    path: sourcePath,
    expectedVersion: result.fileCrud.created.version,
    actualVersion: result.fileCrud.updated.version,
    actualEntry: {
      path: sourcePath,
      kind: 'file',
      size: 7,
      version: result.fileCrud.updated.version,
    },
    actualBytes: 'current',
  });
  expect(result.fileCrud.renameTargetConflict).toEqual({
    name: 'FileConflictError',
    path: targetPath,
    expectedVersion: null,
    actualVersion: result.fileCrud.targetCreated.version,
    actualEntry: {
      path: targetPath,
      kind: 'file',
      size: 7,
      version: result.fileCrud.targetCreated.version,
    },
    actualBytes: 'target!',
  });
  expect(result.fileCrud.renamed).toEqual({
    path: targetPath,
    version: result.fileCrud.renamed.version,
    readVersion: result.fileCrud.renamed.version,
    bytes: 'current',
    reflected: true,
    sourceAbsent: true,
    sourceReadFailure: {
      name: 'ProjectFileOperationError',
      operation: 'readFile',
      path: sourcePath,
      mutationOutcome: null,
    },
  });
  expect(result.fileCrud.removeConflict).toEqual({
    name: 'FileConflictError',
    path: targetPath,
    expectedVersion: result.fileCrud.targetCreated.version,
    actualVersion: result.fileCrud.renamed.version,
    actualEntry: {
      path: targetPath,
      kind: 'file',
      size: 7,
      version: result.fileCrud.renamed.version,
    },
    actualBytes: 'current',
    preservedVersion: result.fileCrud.renamed.version,
    preservedBytes: 'current',
  });
  expect(result.fileCrud.removed).toBe(true);

  expect(result.documentEdit.opened.bytes).toContain(INITIAL_HMR_MARKER);
  expect(result.documentEdit.opened.version).not.toBeNull();
  expect(result.documentEdit.conflict).toMatchObject({
    name: 'FileConflictError',
    path: '/src/main.js',
    expectedVersion: result.documentEdit.opened.version,
    actualVersion: result.documentEdit.remote.version,
    actualEntry: {
      path: '/src/main.js',
      kind: 'file',
      version: result.documentEdit.remote.version,
    },
    localVersion: result.documentEdit.opened.version,
    dirty: true,
    snapshotActualVersion: result.documentEdit.remote.version,
    snapshotActualEntry: {
      path: '/src/main.js',
      kind: 'file',
      version: result.documentEdit.remote.version,
    },
  });
  expect(result.documentEdit.conflict.actualBytes).toContain('workbench-public-conflict-remote');
  expect(result.documentEdit.conflict.localBytes).toContain(UPDATED_HMR_MARKER);
  expect(result.documentEdit.conflict.snapshotActualBytes).toContain(
    'workbench-public-conflict-remote',
  );
  expect(result.documentEdit.conflict.actualEntry?.size).toBe(
    new TextEncoder().encode(result.documentEdit.conflict.actualBytes ?? '').byteLength,
  );
  expect(result.documentEdit.reopened.version).toBe(result.documentEdit.remote.version);
  expect(result.documentEdit.reopened.bytes).toContain('workbench-public-conflict-remote');
  expect(result.documentEdit.dirtyBeforeSave).toBe(true);
  expect(result.documentEdit.saved.dirty).toBe(false);
  expect(result.documentEdit.saved.version).not.toBeNull();
  expect(result.documentEdit.saved.version).not.toBe(result.documentEdit.reopened.version);
  expect(result.documentEdit.reflected).toMatchObject({
    version: result.documentEdit.saved.version,
    snapshotVersion: result.documentEdit.saved.version,
  });
  expect(result.documentEdit.reflected.bytes).toContain(UPDATED_HMR_MARKER);
  expect(result.documentEdit.hmrUpdate).toMatchObject({ marker: UPDATED_HMR_MARKER });
  expect(result.documentEdit.hmrUpdate?.generation).toBeGreaterThanOrEqual(2);
  expect(result.previewB.port).toBe(result.previewA.port);
  expect(result.reopenedPreviewA.port).toBe(result.previewA.port);
  for (const closed of [result.previewA.close, result.reopenedPreviewA.close]) {
    expect(closed.order).toEqual(['run-exited', 'project-closed']);
    expect(closed.exit).toEqual({ code: null, signal: 'SIGTERM' });
    expect(closed.closeExit).toEqual(closed.exit);
    expect(closed.terminalClosure.default).toMatchObject({
      rejected: true,
      name: 'ClosedHandleError',
    });
    expect(closed.revoked.status).toBe(503);
  }
  expect(result.previewB.runClose.exit).toEqual({ code: null, signal: 'SIGTERM' });
  expect(result.previewB.runClose.closeExit).toEqual(result.previewB.runClose.exit);
  expect(result.previewB.runClose.revoked.status).toBe(503);
  expect(result.previewB.projectStillOpen).toEqual({
    exit: { code: 0, signal: null },
    closeExit: { code: 0, signal: null },
    output: 'workbench-project-b-still-open',
  });
  expect(result.previewA.close.sibling).toEqual({
    order: ['sibling-exited', 'project-closed'],
    exit: { code: null, signal: 'SIGINT' },
    closeExit: { code: null, signal: 'SIGINT' },
  });
  expect(result.previewA.close.terminalClosure.sibling).toMatchObject({
    rejected: true,
    name: 'ClosedHandleError',
  });
  expect(result.write).toEqual({
    exit: { code: 0, signal: null },
    closeExit: { code: 0, signal: null },
    output: '',
  });
  expect(result.retained).toEqual({
    exit: { code: 0, signal: null },
    closeExit: { code: 0, signal: null },
    output: RETAINED_BYTES,
  });
  expect(result.ownerCarrierConstructions).toBe(1);
  expect(ownerCarrierObserved).toBe(true);
  expect(ownerEntryLoads).toBe(1);
  await expect
    .poll(() => page.workers().filter((worker) => worker.url() === workerAssets.kernel).length, {
      timeout: 5_000,
    })
    .toBe(0);
  await expect.poll(() => ownerLifecycle.length, { timeout: 5_000 }).toBe(7);
  expect(ownerLifecycle.slice(0, 5)).toEqual([
    'owner-started',
    'project-a-closed',
    'project-b-closed',
    'reopened-project-a-closed',
    'workbench-close-started',
  ]);
  // Playwright observes Worker.close on the driver event loop; its callback
  // may run on either side of the page's already-settled close continuation.
  expect(ownerLifecycle.slice(5).sort()).toEqual(['owner-closed', 'workbench-closed']);
  expect(pinnedEsbuildRequests).toHaveLength(1);
});
