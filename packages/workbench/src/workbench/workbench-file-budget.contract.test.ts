import { EventEmitter } from 'node:events';
import type { WorkerProcessHandle } from '@riftydev/kernel';
import { RegistryClient } from '@riftydev/npm-client';
import { createMemoryFs } from '@riftydev/vfs/internal';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createOwnerPackageState } from '../workers/owner-package-state.ts';
import { createOwnerVfsAuthorityComposition } from '../workers/owner-vfs-authority.ts';
import { createWorkbenchProjectVfs } from '../workers/workbench-project-vfs.ts';
import { ProjectFileOperationError } from './errors.ts';
import { validateUrlContext, validateWorkbenchOptions } from './internal/workbench-options.ts';
import type { PageToWorkbenchOwnerMessage } from './owner-protocol.ts';
import { inspectProjectDefinition, projects } from './project-definition.ts';
import type { OwnerProjectVfsFrame, PageProjectVfsFrame } from './project-vfs-protocol.ts';
import type { BrowserOwnerDependencies } from './workbench-browser-owner-spawn.ts';
import { startBrowserWorkspaceOwner } from './workbench-browser-owner.ts';

const ROOT = '/.rifty/workbench/v1/projects/file-budget/tree';
const SOURCE = `${ROOT}/src/main.ts`;
const TOKEN = 'file-budget-project';
const encoder = new TextEncoder();

// Only the physical Worker boundary is substituted. File IPC is generated and
// consumed by actual shipping owners; each directional port keeps FIFO order.
class ControlledPhysicalOwner extends EventEmitter {
  readonly kind = 'worker' as const;
  readonly output = new EventEmitter();
  readonly sent: PageToWorkbenchOwnerMessage[] = [];
  killedWith: string | null = null;
  receive: (frame: PageToWorkbenchOwnerMessage) => void = () => {
    throw new Error('physical owner receive not installed');
  };
  send(value: unknown): boolean {
    const frame = structuredClone(value) as PageToWorkbenchOwnerMessage;
    this.sent.push(frame);
    void Promise.resolve().then(() => this.receive(frame));
    return true;
  }
  stdout() {
    return this.output;
  }
  stderr() {
    return this.output;
  }
  kill(signal = 'SIGTERM'): boolean {
    this.killedWith = signal;
    this.emit('exit', null, signal);
    return true;
  }
}

function hostOptions(projectFileCommitTimeoutMs?: number) {
  return {
    deployment: {
      workers: {
        owner: '/workers/owner.js',
        kernel: '/workers/kernel.js',
        node: '/workers/node.js',
        devServer: '/workers/dev.js',
      },
      serviceWorker: { url: '/sandbox/sw.js', scope: '/sandbox/' },
      wasm: { sqlite: '/wasm/sqlite.wasm' },
      ...(projectFileCommitTimeoutMs === undefined ? {} : { projectFileCommitTimeoutMs }),
    },
    packageAcquisition: { mode: 'registry', registryUrl: '/registry/' },
    storage: { persistence: 'ephemeral' },
  };
}

const urlContext = validateUrlContext({
  apiBaseUrl: 'https://workbench.test/sandbox/',
  clientUrl: 'https://workbench.test/sandbox/index.html',
});

type Observed<T> =
  | { state: 'pending' }
  | { state: 'fulfilled'; value: T }
  | { state: 'rejected'; error: unknown };
function watch<T>(promise: Promise<T>) {
  let result: Observed<T> = { state: 'pending' };
  let settlements = 0;
  void promise.then(
    (value) => {
      settlements += 1;
      result = { state: 'fulfilled', value };
    },
    (error: unknown) => {
      settlements += 1;
      result = { state: 'rejected', error };
    },
  );
  return { result: () => result, settlements: () => settlements };
}

async function tick(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
}

const cleanup: (() => Promise<void>)[] = [];

async function harness(budget?: number) {
  const validated = validateWorkbenchOptions(hostOptions(budget), urlContext);
  const memory = createMemoryFs();
  const { authority, appliedMutations, installStampClaims } = createOwnerVfsAuthorityComposition(
    memory.fsSync,
    {
      ownerEpoch: 'file-budget-owner',
      initialRoots: ['/'],
    },
  );
  authority.mkdirSync(`${ROOT}/src`, { recursive: true });
  authority.writeFileSync(SOURCE, encoder.encode('initial'));
  const packageState = createOwnerPackageState({
    initial: {
      cfg: {
        runtime: 'node-cli',
        root: ROOT,
        entryPath: SOURCE,
        packageName: 'file-budget',
        packageVersion: '1.0.0',
        installDeps: {},
        packageJson: '{"name":"file-budget","version":"1.0.0"}\n',
        seedFiles: {},
      },
      templateId: 'file-budget',
      slug: 'file-budget',
      fromScratch: true,
    },
    vfs: memory.vfs,
    fsSync: authority,
    installStampClaims,
    flush: () => authority.flush(),
    nodeWorkerRuntimeEnv: {},
    log: () => {},
    registry: new RegistryClient({
      baseUrl: 'https://workbench.test/registry/',
      fetch: async () => {
        throw new Error('unexpected registry egress');
      },
    }),
    resolverUrl: () => undefined,
    resolverBundleBaseUrl: () => undefined,
    resolverPin: () => undefined,
  });
  const worker = new ControlledPhysicalOwner();
  const emitted: OwnerProjectVfsFrame[] = [];
  const delivered: OwnerProjectVfsFrame[] = [];
  const pendingInbound: OwnerProjectVfsFrame[] = [];
  const pendingOutbound: PageProjectVfsFrame[] = [];
  const backgroundFailures: unknown[] = [];
  let holdInbound: OwnerProjectVfsFrame['type'] | null = null;
  let holdOutbound = false;
  let operationSequence = 0;

  const deliver = (frame: OwnerProjectVfsFrame) => {
    delivered.push(frame);
    worker.emit('message', { type: 'workbench:project-vfs', projectToken: TOKEN, frame });
  };
  const vfs = createWorkbenchProjectVfs({
    projectRoot: ROOT,
    authority,
    appliedMutations,
    packageMutations: packageState.mutations,
    durability: 'ephemeral',
    fatal: (error) => backgroundFailures.push(error),
    emit(frame) {
      const owned = structuredClone(frame);
      emitted.push(owned);
      if (pendingInbound.length > 0 || owned.type === holdInbound) pendingInbound.push(owned);
      else deliver(owned);
    },
  });
  const handle = (frame: PageProjectVfsFrame) => {
    const task = vfs.handleFrame(frame);
    if (task !== undefined) void task.catch((error: unknown) => backgroundFailures.push(error));
  };
  worker.receive = (message) => {
    if (message.type === 'workbench:project-vfs') {
      if (holdOutbound || pendingOutbound.length > 0) pendingOutbound.push(message.frame);
      else handle(message.frame);
    }
    // Lifecycle boot/open is controlled by this native-worker fixture. The
    // selected file path never uses a fabricated VFS terminal/snapshot/receipt.
  };
  const dependencies: BrowserOwnerDependencies = {
    spawnOwner: () => worker as unknown as WorkerProcessHandle,
    serviceWorker: { controller: null, addEventListener: () => {}, removeEventListener: () => {} },
    timers: {
      setTimeout: () => {
        throw new Error('unused preview timer');
      },
      clearTimeout: () => {},
    },
    fetch: async () => {
      throw new Error('unused preview fetch');
    },
    mountPreview: () => {
      throw new Error('unused preview route');
    },
    operationId: () => `file-budget-${String(++operationSequence)}`,
  };
  const raw = startBrowserWorkspaceOwner(
    { ...validated.owner, storage: validated.storage },
    dependencies,
  );
  void raw.closed.catch(() => {});
  cleanup.push(async () => {
    raw.close();
    worker.emit('exit', 0, null);
    await raw.closed.catch(() => {});
    await vfs.close();
  });
  worker.emit('message', {
    type: 'workbench:owner-ready',
    storage: { policy: 'ephemeral', backend: 'memory', durability: 'ephemeral' },
  });
  await raw.ready;
  const opening = raw.openProject(
    inspectProjectDefinition(
      projects.vite({ id: 'file-budget', files: { '/src/main.ts': 'initial' } }),
    ),
  );
  const request = worker.sent.find((frame) => frame.type === 'workbench:open-project');
  if (request?.type !== 'workbench:open-project') throw new Error('missing open request');
  worker.emit('message', {
    type: 'workbench:project-opened',
    opId: request.opId,
    projectToken: TOKEN,
    projectRoot: ROOT,
  });
  await tick();
  const project = await opening;
  for (const message of worker.sent) {
    if (message.type === 'workbench:project-pty' && message.frame.type === 'pty:open') {
      worker.emit('message', {
        type: 'workbench:project-pty',
        projectToken: TOKEN,
        frame: { type: 'pty:ready', sid: message.frame.sid },
      });
    }
  }
  await tick();
  expect(backgroundFailures).toEqual([]);

  return {
    authority,
    worker,
    project,
    emitted,
    delivered,
    pendingInbound,
    backgroundFailures,
    holdIncoming(type: OwnerProjectVfsFrame['type']) {
      holdInbound = type;
    },
    releaseIncoming() {
      holdInbound = null;
      for (const frame of pendingInbound.splice(0)) deliver(frame);
    },
    holdOutgoing() {
      holdOutbound = true;
    },
    releaseOutgoing() {
      holdOutbound = false;
      for (const frame of pendingOutbound.splice(0)) handle(frame);
    },
    sent(type: PageProjectVfsFrame['type']) {
      return worker.sent.filter(
        (frame) => frame.type === 'workbench:project-vfs' && frame.frame.type === type,
      );
    },
    write() {
      const version = project.files
        .snapshot()
        .entries.find((entry) => entry.path === '/src/main.ts')?.version;
      if (version === undefined) throw new Error('missing initial public file version');
      return watch(
        project.files.writeFile('/src/main.ts', encoder.encode('next'), {
          expectedVersion: version,
        }),
      );
    },
  };
}

function assertActualApplied(h: Awaited<ReturnType<typeof harness>>) {
  const ack = h.delivered.find((frame) => frame.type === 'rifty:owner-vfs-commit-ack');
  expect(ack).toMatchObject({
    ok: true,
    ack: {
      ownerEpoch: h.authority.ownerEpoch,
      treeRevision: h.authority.treeRevision,
      versions: [{ path: SOURCE, version: h.authority.versionOf(SOURCE) }],
    },
  });
  expect(h.authority.readFileBytesSync(SOURCE)).toEqual(encoder.encode('next'));
  expect(h.sent('rifty:owner-vfs-commit')).toHaveLength(1);
  expect(h.sent('rifty:owner-vfs-durability')).toHaveLength(1);
  expect(h.backgroundFailures).toEqual([]);
}

function assertAppliedFailure(result: Observed<unknown>) {
  expect(result.state).toBe('rejected');
  if (result.state !== 'rejected') throw new Error('expected bounded rejection');
  expect(result.error).toBeInstanceOf(ProjectFileOperationError);
  expect(result.error).toMatchObject({
    operation: 'writeFile',
    path: '/src/main.ts',
    mutationOutcome: 'applied',
  });
}

describe('I7 public file budget through actual browser owner and owner VFS', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(async () => {
    for (const release of cleanup.splice(0)) await release();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  // Two shorter siblings: 40 s specifically crosses the 35 s ACK default;
  // 70 s additionally discriminates a remaining 60 s coordinator timer.
  it.each([40_000, 70_000])('F=90s admits actual durability ACK delayed to %ims', async (delay) => {
    const h = await harness(90_000);
    h.holdIncoming('rifty:owner-vfs-durability-ack');
    const writing = h.write();
    await tick();
    assertActualApplied(h);
    expect(h.pendingInbound).toHaveLength(1);
    expect(h.pendingInbound[0]).toMatchObject({ type: 'rifty:owner-vfs-durability-ack', ok: true });
    await vi.advanceTimersByTimeAsync(delay);
    expect
      .soft(writing.result(), 'public F must reach every shorter file observation owner')
      .toEqual({ state: 'pending' });
    h.releaseIncoming();
    await tick();
    expect(writing.result()).toMatchObject({
      state: 'fulfilled',
      value: { path: '/src/main.ts', version: expect.any(String) },
    });
    expect(writing.settlements()).toBe(1);
    assertActualApplied(h);
    expect(h.worker.killedWith).toBeNull();
  });

  it('F=15ms rejects applied durability honestly; late ACK never resends or changes promise outcome', async () => {
    const h = await harness(15);
    h.holdIncoming('rifty:owner-vfs-durability-ack');
    const writing = h.write();
    await tick();
    assertActualApplied(h);
    await vi.advanceTimersByTimeAsync(14);
    expect(writing.result()).toEqual({ state: 'pending' });
    await vi.advanceTimersByTimeAsync(1);
    assertAppliedFailure(writing.result());
    const terminal = writing.result();
    h.releaseIncoming();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(writing.result()).toBe(terminal);
    expect(writing.settlements()).toBe(1);
    assertActualApplied(h);
    expect(h.worker.killedWith).toBeNull();
  });

  it('omitted F preserves the existing 35s durability ACK default and applied outcome', async () => {
    const h = await harness();
    h.holdIncoming('rifty:owner-vfs-durability-ack');
    const writing = h.write();
    await tick();
    await vi.advanceTimersByTimeAsync(34_999);
    expect(writing.result()).toEqual({ state: 'pending' });
    await vi.advanceTimersByTimeAsync(1);
    assertAppliedFailure(writing.result());
    const terminal = writing.result();
    h.releaseIncoming();
    await tick();
    expect(writing.result()).toBe(terminal);
    assertActualApplied(h);
  });

  it('F=15ms never adds a pre-ACK admission timeout or replay; actual late owner terminal settles', async () => {
    const h = await harness(15);
    h.holdOutgoing();
    const writing = h.write();
    await vi.advanceTimersByTimeAsync(70_000);
    expect(writing.result()).toEqual({ state: 'pending' });
    expect(h.sent('rifty:owner-vfs-commit')).toHaveLength(1);
    expect(h.sent('rifty:owner-vfs-durability')).toHaveLength(0);
    expect(h.authority.readFileBytesSync(SOURCE)).toEqual(encoder.encode('initial'));
    h.releaseOutgoing();
    await tick();
    expect(writing.result()).toMatchObject({ state: 'fulfilled', value: { path: '/src/main.ts' } });
    assertActualApplied(h);
  });

  it('slow publication keeps FIFO state-before-ACK order and has no synthetic reflection timeout', async () => {
    const h = await harness(15);
    h.holdIncoming('workbench:project-vfs-state');
    const writing = h.write();
    await tick();
    expect(h.pendingInbound.map((frame) => frame.type)).toEqual([
      'workbench:project-vfs-state',
      'rifty:owner-vfs-commit-ack',
    ]);
    await vi.advanceTimersByTimeAsync(70_000);
    expect(writing.result()).toEqual({ state: 'pending' });
    expect(h.authority.readFileBytesSync(SOURCE)).toEqual(encoder.encode('next'));
    expect(h.sent('rifty:owner-vfs-commit')).toHaveLength(1);
    h.releaseIncoming();
    await tick();
    expect(writing.result()).toMatchObject({ state: 'fulfilled' });
    assertActualApplied(h);
  });

  it.each(['before-ACK', 'after-ACK'] as const)(
    'owner death %s settles pending work with honest evidence',
    async (stage) => {
      const h = await harness(90_000);
      if (stage === 'before-ACK') h.holdOutgoing();
      else h.holdIncoming('rifty:owner-vfs-durability-ack');
      const writing = h.write();
      await tick();
      expect(writing.result()).toEqual({ state: 'pending' });
      h.worker.emit('exit', null, 'SIGKILL');
      await tick();
      expect(writing.result()).toMatchObject({
        state: 'rejected',
        error: {
          name: 'ProjectFileOperationError',
          mutationOutcome: stage === 'before-ACK' ? 'unknown' : 'applied',
        },
      });
      expect(writing.settlements()).toBe(1);
      expect(h.sent('rifty:owner-vfs-commit')).toHaveLength(1);
      expect(h.authority.readFileBytesSync(SOURCE)).toEqual(
        encoder.encode(stage === 'before-ACK' ? 'initial' : 'next'),
      );
    },
  );
});
