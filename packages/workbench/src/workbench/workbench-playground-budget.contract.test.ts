import { EventEmitter } from 'node:events';
import { setImmediate as nativeImmediate, setTimeout as nativeTimeout } from 'node:timers';
import { type WorkerProcessHandle, clearKernelDispatcher } from '@riftydev/kernel';
import { syncMirror } from '@riftydev/vfs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runWorkbenchOwner } from '../workers/workbench-owner-runtime.ts';
import type {
  PageToPlaygroundOwnerMessage,
  PlaygroundOwnerToPageMessage,
} from './internal/playground-owner-protocol.ts';
import { definePlaygroundProject } from './internal/playground-project-definition.ts';
import { validateUrlContext, validateWorkbenchOptions } from './internal/workbench-options.ts';
import type { PageToWorkbenchOwnerMessage, WorkbenchOwnerToPageMessage } from './owner-protocol.ts';
import type { BrowserOwnerDependencies } from './workbench-browser-owner-spawn.ts';
import { startBrowserWorkspaceOwner } from './workbench-browser-owner.ts';

type PageMessage = PageToWorkbenchOwnerMessage | PageToPlaygroundOwnerMessage;
type OwnerMessage = WorkbenchOwnerToPageMessage | PlaygroundOwnerToPageMessage;
const context = Object.freeze({
  apiBaseUrl: 'https://budget.test/app/',
  clientUrl: 'https://budget.test/app/index.html',
});

// Only the native Worker/IPC boundary is replaced. All owner code and results are real.
class LocalOwnerWorker extends EventEmitter {
  readonly kind = 'worker' as const;
  readonly output = new EventEmitter();
  readonly received: PageMessage[] = [];
  readonly heldPage: PageMessage[] = [];
  holdPage: (message: PageMessage) => boolean = () => false;
  readonly emitted: OwnerMessage[] = [];
  readonly held: OwnerMessage[] = [];
  hold: (message: OwnerMessage) => boolean = () => false;
  receive: ((message: unknown) => void) | undefined;
  killed = false;
  readonly lifetime: Promise<void>;
  constructor() {
    super();
    this.lifetime = runWorkbenchOwner({
      onMessage: (listener) => {
        this.receive = listener;
      },
      send: (message) => {
        const owned = structuredClone(message) as OwnerMessage;
        this.emitted.push(owned);
        if (this.hold(owned)) this.held.push(owned);
        else nativeImmediate(() => this.emit('message', owned));
      },
    });
    void this.lifetime.then(
      () => this.emit('exit', 0, null),
      (error: unknown) => this.emit('peererror', error),
    );
  }
  send(message: unknown) {
    const owned = structuredClone(message) as PageMessage;
    this.received.push(owned);
    if (this.holdPage(owned)) this.heldPage.push(owned);
    else nativeImmediate(() => this.receive?.(owned));
    return true;
  }
  releasePage() {
    for (const message of this.heldPage.splice(0)) nativeImmediate(() => this.receive?.(message));
  }
  stdout() {
    return this.output;
  }
  stderr() {
    return this.output;
  }
  kill(signal = 'SIGTERM') {
    this.killed = true;
    this.emit('exit', null, signal);
    return true;
  }
  die(error: Error) {
    this.killed = true;
    this.emit('peererror', error);
  }
  async release() {
    await Promise.all(
      this.held.splice(0).map(
        (message) =>
          new Promise<void>((resolve) =>
            nativeImmediate(() => {
              this.emit('message', message);
              resolve();
            }),
          ),
      ),
    );
  }
}
function watch<T>(promise: Promise<T>) {
  const result: { state: 'pending' | 'fulfilled' | 'rejected'; value?: T; error?: unknown } = {
    state: 'pending',
  };
  const settled = promise.then(
    (value) => {
      result.state = 'fulfilled';
      result.value = value;
    },
    (error) => {
      result.state = 'rejected';
      result.error = error;
    },
  );
  return Object.assign(result, { settled });
}
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
  clearKernelDispatcher();
  vi.useRealTimers();
});
async function boot(budget?: number, silence?: number) {
  clearKernelDispatcher();
  const normalized = validateWorkbenchOptions(
    {
      deployment: {
        workers: {
          owner: 'owner.js',
          kernel: 'kernel.js',
          node: 'node.js',
          devServer: 'dev.js',
          typescript: 'ts.js',
        },
        serviceWorker: { url: 'sw.js', scope: './' },
        wasm: { sqlite: 'sqlite.wasm' },
        ...(budget === undefined ? {} : { playgroundRequestTimeoutMs: budget }),
        ...(silence === undefined ? {} : { ownerOperationSilenceTimeoutMs: silence }),
      },
      storage: { persistence: 'ephemeral' },
      packageAcquisition: { mode: 'registry', registryUrl: 'https://registry.invalid/' },
    },
    validateUrlContext(context),
  );
  const worker = new LocalOwnerWorker();
  let id = 0;
  const dependencies: BrowserOwnerDependencies = {
    spawnOwner: () => worker as unknown as WorkerProcessHandle,
    serviceWorker: { controller: null, addEventListener() {}, removeEventListener() {} },
    timers: {
      setTimeout: () => {
        throw new Error('unexpected preview timer');
      },
      clearTimeout() {},
    },
    fetch: async () => {
      throw new Error('unexpected preview fetch');
    },
    mountPreview: () => {
      throw new Error('unexpected preview mount');
    },
    operationId: () => `budget-${++id}`,
  };
  const raw = startBrowserWorkspaceOwner(
    { ...normalized.owner, storage: normalized.storage, playgroundUrlContext: context },
    dependencies,
  );
  void raw.closed.catch(() => {});
  cleanups.push(async () => {
    worker.hold = () => false;
    worker.holdPage = () => false;
    worker.releasePage();
    await worker.release();
    raw.close();
    if (worker.killed) worker.send({ type: 'workbench:shutdown' });
    await worker.lifetime;
  });
  await raw.ready;
  const companion = raw.playground;
  if (!companion) throw new Error('missing companion');
  return { worker, raw, companion };
}
function definition() {
  return definePlaygroundProject(
    {
      kind: 'node-cli',
      id: 'scratch',
      starterId: 'budget-starter',
      templateId: 'budget-template',
      entryPath: '/src/main.ts',
      files: { '/src/main.ts': 'export const value = 1;\n' },
      firstMaterialization: { kind: 'install' },
    },
    context,
  );
}
async function open(budget?: number) {
  const h = await boot(budget);
  const project = definition();
  await h.companion.catalog.createScratch({ definition: project });
  const session = await h.companion.openProject(project);
  const lifecycle = h.companion.sessionTools(session);
  const opened = h.worker.emitted.find(
    (message) => message.type === 'workbench:playground-project-opened',
  );
  if (!opened || opened.type !== 'workbench:playground-project-opened')
    throw new Error('missing real project root');
  return { ...h, session, lifecycle, projectRoot: opened.projectRoot };
}

type Harness = Awaited<ReturnType<typeof open>>;
const calls = [
  { kind: 'SCM', result: 'scm:snapshot', invoke: (h: Harness) => h.lifecycle.tools.scm.refresh() },
  {
    kind: 'archive',
    result: 'archive:export',
    invoke: (h: Harness) => h.lifecycle.tools.archive.export(),
  },
  {
    kind: 'awaitDurability',
    result: 'durability:void',
    invoke: (h: Harness) => h.lifecycle.tools.awaitDurability(),
  },
  { kind: 'close', result: 'closed', invoke: (h: Harness) => h.lifecycle.close() },
] as const;
function holdOwnerResponse(worker: LocalOwnerWorker, matches: (message: OwnerMessage) => boolean) {
  // Actual IPC completion, independent of native Git scheduling and the fake request clock.
  return new Promise<void>((resolve) => {
    worker.hold = (message) => {
      if (!matches(message)) return false;
      resolve();
      return true;
    };
  });
}
function holdToolResponses(worker: LocalOwnerWorker) {
  return holdOwnerResponse(
    worker,
    (message) =>
      message.type === 'workbench:playground-project-tools' &&
      message.frame.type === 'workbench:playground-session-tools-response',
  );
}
function toolRequests(worker: LocalOwnerWorker) {
  return worker.received.filter(
    (message): message is Extract<PageMessage, { type: 'workbench:playground-project-tools' }> =>
      message.type === 'workbench:playground-project-tools' &&
      message.frame.type === 'workbench:playground-session-tools-request',
  );
}
function heldResult(worker: LocalOwnerWorker) {
  const message = worker.held[0];
  if (
    message?.type !== 'workbench:playground-project-tools' ||
    message.frame.type !== 'workbench:playground-session-tools-response' ||
    !message.frame.response.ok
  )
    throw new Error('missing real successful tool response');
  return message.frame.response.result;
}
function fakeClock() {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
}
function exportedSource(json: string) {
  const archive = JSON.parse(json) as { files: { path: string; content: string }[] };
  const source = archive.files.find((file) => file.path === 'src/main.ts');
  if (!source) throw new Error('missing exported source');
  return atob(source.content);
}

describe('public Playground request budget with real owner composition', () => {
  it('baseline full graph produces real SCM/archive/durability/close results', async () => {
    const h = await open();
    expect((await h.lifecycle.tools.scm.refresh()).history.length).toBeGreaterThan(0);
    expect(exportedSource(await h.lifecycle.tools.archive.export())).toBe(
      'export const value = 1;\n',
    );
    await h.lifecycle.tools.awaitDurability();
    await h.lifecycle.close();
    expect(h.worker.killed).toBe(false);
  });

  it('omitted T preserves the 60000 request default and ignores the late actual response', async () => {
    const h = await open();
    fakeClock();
    const responseReady = holdToolResponses(h.worker);
    const outcome = watch(h.lifecycle.tools.scm.refresh());
    await responseReady;
    expect(heldResult(h.worker).type).toBe('scm:snapshot');
    await vi.advanceTimersByTimeAsync(59_999);
    expect(outcome.state).toBe('pending');
    await vi.advanceTimersByTimeAsync(2);
    expect(outcome.state).toBe('rejected');
    expect(String(outcome.error)).toContain('timed out after 60000ms');
    await h.worker.release();
    expect(outcome.state).toBe('rejected');
    expect(h.worker.killed).toBe(false);
  });

  it('waits for native owner scheduling without consuming the fake request budget', async () => {
    const h = await open(90_000);
    fakeClock();
    const responseReady = holdToolResponses(h.worker);
    h.worker.holdPage = (message) => message.type === 'workbench:playground-project-tools';
    const started = Date.now();
    const outcome = watch(h.lifecycle.tools.scm.refresh());
    const delivered = new Promise<void>((resolve) =>
      nativeTimeout(() => {
        h.worker.releasePage();
        resolve();
      }, 50),
    );
    try {
      await responseReady;
      expect(heldResult(h.worker).type).toBe('scm:snapshot');
      expect(Date.now()).toBe(started);
      expect(vi.getTimerCount()).toBe(1);
      await vi.advanceTimersByTimeAsync(70_000);
      expect(outcome.state).toBe('pending');
      await h.worker.release();
      await outcome.settled;
      expect(outcome.state).toBe('fulfilled');
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      await delivered;
    }
  });

  // I7 / sibling-drift: public normalization and the actual browser composition must reach T.
  it.each(calls)(
    'public T=90000 retains actual delayed $kind response at 70000',
    async ({ invoke, result }) => {
      const h = await open(90_000);
      fakeClock();
      const responseReady = holdToolResponses(h.worker);
      const outcome = watch<unknown>(invoke(h));
      await responseReady;
      expect(h.worker.held).toHaveLength(1);
      expect(heldResult(h.worker).type).toBe(result);
      const ownerResult = heldResult(h.worker);
      expect(vi.getTimerCount()).toBe(1);
      await vi.advanceTimersByTimeAsync(70_000);
      expect.soft(outcome.state).toBe('pending');
      await h.worker.release();
      await outcome.settled;
      expect.soft(outcome.state).toBe('fulfilled');
      if (ownerResult.type === 'scm:snapshot')
        expect.soft(outcome.value).toEqual(ownerResult.snapshot);
      if (ownerResult.type === 'archive:export')
        expect.soft(outcome.value).toBe(ownerResult.archiveJson);
      if (typeof outcome.value === 'string')
        expect(exportedSource(outcome.value)).toBe('export const value = 1;\n');
      expect(h.worker.killed).toBe(false);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it.each(calls)(
    'public short T rejects only $kind request and ignores its late result',
    async ({ invoke, result }) => {
      const h = await open(1_000);
      fakeClock();
      const responseReady = holdToolResponses(h.worker);
      const outcome = watch<unknown>(invoke(h));
      await responseReady;
      expect(heldResult(h.worker).type).toBe(result);
      await vi.advanceTimersByTimeAsync(999);
      expect(outcome.state).toBe('pending');
      await vi.advanceTimersByTimeAsync(2);
      expect.soft(outcome.state).toBe('rejected');
      expect.soft(outcome.error).toBeInstanceOf(Error);
      expect.soft(String(outcome.error)).toContain('timed out after 1000ms');
      expect(h.worker.killed).toBe(false);
      await h.worker.release();
      await outcome.settled;
      expect.soft(outcome.state).toBe('rejected');
      // A request timeout leaves the real owner/catalog alive, including close.
      expect(await h.companion.catalog.listRetainedScratch()).toEqual([]);
      expect(h.worker.killed).toBe(false);
    },
  );

  // I7 / observable-order: late completion may mutate; timeout cannot promise rollback.
  it('short T preserves the rejected result while an admitted archive later changes real owner bytes', async () => {
    const h = await open(1_000);
    const initialArchive = JSON.parse(await h.lifecycle.tools.archive.export()) as {
      files: { path: string; content: string }[];
    };
    const next = 'export const value = "after timeout";\n';
    const file = initialArchive.files.find((file) => file.path === 'src/main.ts');
    if (!file) throw new Error('missing source');
    file.content = btoa(next);
    fakeClock();
    const responseReady = holdToolResponses(h.worker);
    const admitted = new Promise<void>((resolve) => {
      h.worker.holdPage = (message) => {
        if (
          message.type !== 'workbench:playground-project-tools' ||
          message.frame.type !== 'workbench:playground-session-tools-request' ||
          message.frame.operation.type !== 'archive:import'
        )
          return false;
        resolve();
        return true;
      };
    });
    const outcome = watch(h.lifecycle.tools.archive.import(JSON.stringify(initialArchive)));
    await admitted;
    expect(h.worker.heldPage).toHaveLength(1);
    expect(
      new TextDecoder().decode(syncMirror().readFileBytesSync(`${h.projectRoot}/src/main.ts`)),
    ).toBe('export const value = 1;\n');
    await vi.advanceTimersByTimeAsync(1_001);
    expect.soft(outcome.state).toBe('rejected');
    const timeout = outcome.error;
    h.worker.releasePage();
    await responseReady;
    expect(heldResult(h.worker).type).toBe('archive:import');
    await h.worker.release();
    expect(
      new TextDecoder().decode(syncMirror().readFileBytesSync(`${h.projectRoot}/src/main.ts`)),
    ).toBe(next);
    expect.soft(outcome.state).toBe('rejected');
    expect.soft(outcome.error).toBe(timeout);
    expect(
      toolRequests(h.worker).filter(
        (message) =>
          message.frame.type === 'workbench:playground-session-tools-request' &&
          message.frame.operation.type === 'archive:import',
      ),
    ).toHaveLength(1);
    expect(h.worker.killed).toBe(false);
  });

  // Baseline settlement: T starts after document admission; close waits admitted work.
  it('document-save barrier outlives T before one archive send; close waits the admitted archive', async () => {
    const h = await open(1_000);
    const document = await h.session.documents.open('/src/main.ts');
    document.replace('export const value = "saved";\n');
    fakeClock();
    const responseReady = holdOwnerResponse(
      h.worker,
      (message) =>
        message.type === 'workbench:project-vfs' &&
        message.frame.type === 'rifty:owner-vfs-commit-ack',
    );
    const saved = watch(document.save());
    const archive = watch(h.lifecycle.tools.archive.export());
    const closed = watch(h.lifecycle.close());
    await responseReady;
    expect(h.worker.held).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(70_000);
    expect(saved.state).toBe('pending');
    expect(archive.state).toBe('pending');
    expect(closed.state).toBe('pending');
    expect(toolRequests(h.worker)).toHaveLength(0);
    await h.worker.release();
    await Promise.all([saved.settled, archive.settled, closed.settled]);
    expect(saved.state).toBe('fulfilled');
    expect(archive.state).toBe('fulfilled');
    expect(closed.state).toBe('fulfilled');
    expect(exportedSource(archive.value ?? '')).toBe('export const value = "saved";\n');
    expect(
      h.worker.received.filter(
        (message) =>
          message.type === 'workbench:project-vfs' &&
          message.frame.type === 'rifty:owner-vfs-commit',
      ),
    ).toHaveLength(1);
    expect(
      toolRequests(h.worker).map((message) =>
        message.frame.type === 'workbench:playground-session-tools-request'
          ? message.frame.operation.type
          : '',
      ),
    ).toEqual(['archive:export', 'close']);
  });

  it('owner death settles admitted requests without waiting for T or accepting late success', async () => {
    const h = await open(90_000);
    fakeClock();
    const responseReady = holdToolResponses(h.worker);
    const outcome = watch(h.lifecycle.tools.scm.refresh());
    await responseReady;
    expect(heldResult(h.worker).type).toBe('scm:snapshot');
    h.worker.die(new Error('native owner worker died'));
    await outcome.settled;
    expect(outcome.state).toBe('rejected');
    expect(String(outcome.error)).toContain('native owner worker died');
    expect(String(outcome.error)).not.toContain('timed out');
    const failure = outcome.error;
    await h.worker.release();
    expect(outcome.error).toBe(failure);
    expect(vi.getTimerCount()).toBe(0);
  });

  // Existing S owner: public catalog stays on its uniform owner-operation timer.
  it('catalog S=90000 survives an actual catalog completion delayed to 70000 independently of T=1000', async () => {
    const h = await boot(1_000, 90_000);
    fakeClock();
    const responseReady = holdOwnerResponse(
      h.worker,
      (message) => message.type === 'workbench:playground-catalog-completed',
    );
    const outcome = watch(h.companion.catalog.createScratch({ definition: definition() }));
    await responseReady;
    expect(h.worker.held).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(70_000);
    expect(outcome.state).toBe('pending');
    await h.worker.release();
    await outcome.settled;
    expect(outcome.state).toBe('fulfilled');
    expect(outcome.value?.scratch).not.toBeNull();
    expect(h.worker.killed).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('catalog short S kills the owner while preserving already applied Scratch bytes', async () => {
    const h = await boot(90_000, 1_000);
    fakeClock();
    const responseReady = holdOwnerResponse(
      h.worker,
      (message) => message.type === 'workbench:playground-catalog-completed',
    );
    const outcome = watch(h.companion.catalog.createScratch({ definition: definition() }));
    await responseReady;
    expect(h.worker.held).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1_001);
    expect(outcome.state).toBe('rejected');
    expect(String(outcome.error)).toContain('1000ms without owner durability progress');
    expect(h.worker.killed).toBe(true);
    const tree = '/.rifty/workbench/v1/projects/scratch/tree/src/main.ts';
    expect(new TextDecoder().decode(syncMirror().readFileBytesSync(tree))).toBe(
      'export const value = 1;\n',
    );
    const failure = outcome.error;
    await h.worker.release();
    expect(outcome.error).toBe(failure);
  });
});
