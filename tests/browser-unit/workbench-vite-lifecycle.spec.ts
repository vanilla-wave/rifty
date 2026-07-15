import { expect, test } from '@playwright/test';
import { gotoHarness } from './fixtures.ts';

const RETAINED_BYTES = 'retained-through-project-switch';

test('public Workbench keeps one ephemeral owner across exact Vite A to B to A lifecycle', async ({
  page,
}) => {
  test.setTimeout(300_000);
  await gotoHarness(page);

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

  const result = await page.evaluate(async (retainedBytes) => {
    type Exit = { readonly code: number | null; readonly signal: string | null };
    type Preview = { readonly port: number; readonly url: string };
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
      openWorkbench(options: {
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
      }): Promise<Workbench>;
      readonly projects: {
        vite(options: {
          readonly id: string;
          readonly files: Readonly<Record<string, string | Uint8Array>>;
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
      readonly wasm: { readonly sqlite: string; readonly esbuild: string };
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

    const publicEntryUrl: string = '/src/workbench/public.ts';
    const [publicEntryModule, hostAssetsModule] = await Promise.all([
      import(/* @vite-ignore */ publicEntryUrl),
      import('/src/browser-unit/workbench-vite-host-assets.ts'),
    ]);
    const publicEntry = publicEntryModule as unknown as PublicEntry;
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
        files: {
          '/index.html': '<!doctype html><h1>workbench-owner-a</h1>',
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
      const closeB = await closeProject(projectB, runB, previewBRoot.href, 'project B');
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
        previewB: { port: previewB.port, html: htmlB, close: closeB },
        reopenedPreviewA: {
          port: reopenedPreviewA.port,
          html: reopenedHtmlA,
          close: reopenedCloseA,
        },
        write,
        retained,
      };
    } catch (error) {
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
      baseElement.remove();
      ownerCarrierProbe.restore();
    }
  }, RETAINED_BYTES);

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
  expect(result.previewB.port).toBe(result.previewA.port);
  expect(result.reopenedPreviewA.port).toBe(result.previewA.port);
  for (const closed of [
    result.previewA.close,
    result.previewB.close,
    result.reopenedPreviewA.close,
  ]) {
    expect(closed.order).toEqual(['run-exited', 'project-closed']);
    expect(closed.exit).toEqual({ code: null, signal: 'SIGTERM' });
    expect(closed.closeExit).toEqual(closed.exit);
    expect(closed.terminalClosure.default).toMatchObject({
      rejected: true,
      name: 'ClosedHandleError',
    });
    expect(closed.revoked.status).toBe(503);
  }
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
});
