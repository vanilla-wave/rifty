import type { LogEntry } from '@riftydev/git';
import { SW_FRAME_VERSION, SW_PONG, SW_ROUTING_VERSION } from '@riftydev/service-worker';
import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import { SnapshotFs } from '../../glue/snapshot-fs.ts';
import { createVfsCommitCoordinator } from '../../glue/vfs-commit-coordinator.ts';
import { ClosedHandleError, DirtyProjectDocumentError } from '../errors.ts';
import {
  type OpenWorkbenchDependencies,
  type Workbench,
  type WorkbenchOptions,
  createOpenWorkbench,
} from '../open-workbench.ts';
import * as companionModule from '../playground.ts';
import {
  type NodeCliPlaygroundPlan,
  type NodeServerPlaygroundPlan,
  type PlaygroundArchive,
  type PlaygroundPreview,
  type PlaygroundPreviewRegistry,
  type PlaygroundProjectCatalog,
  type PlaygroundProjectOpenOptions,
  type PlaygroundProjectPlan,
  type PlaygroundScm,
  type PlaygroundScmBlob,
  type PlaygroundScmChange,
  type PlaygroundScmDiff,
  type PlaygroundScmSnapshot,
  type PlaygroundSessionTools,
  type PlaygroundTypeScript,
  type PlaygroundWorkbench,
  type VitePlaygroundPlan,
  openPlaygroundWorkbench,
} from '../playground.ts';
import { createProjectContentController } from '../project-content.ts';
import {
  type InspectedProjectDefinition,
  defineNodeCliProject,
  defineNodeServerProject,
  projects,
} from '../project-definition.ts';
import type { ProjectDocumentReadEntry } from '../project-documents.ts';
import {
  type ProjectRuntime,
  type ProjectSession,
  createProjectSession,
} from '../project-session.ts';
import {
  type ProjectTerminal,
  type ProjectTerminalSnapshot,
  createProjectTerminal,
} from '../project-terminal.ts';
import * as rootModule from '../public.ts';
import type { PreviewHandle, ProjectDefinition } from '../public.ts';
import {
  createOpenPlaygroundWorkbench,
  createPlaygroundWorkbenchFacade,
} from './playground-workbench.ts';

const encoder = new TextEncoder();
const CONTENT_ROOT = '/.rifty/workbench/projects/contract';
const OWNER_EPOCH = 'playground-contract-owner';
const CAPTURED_URL_CONTEXT = Object.freeze({
  apiBaseUrl: 'https://playground.invalid/app/index.html',
  clientUrl: 'https://playground.invalid/app/index.html',
});

interface CapturedUrlContext {
  readonly apiBaseUrl: string;
  readonly clientUrl: string;
}

type ExpectedPlaygroundScmChange = {
  readonly path: string;
  readonly code: string;
  readonly area: 'staged' | 'working';
};

type ExpectedPlaygroundScmSnapshot = {
  readonly branch?: string;
  readonly history: readonly LogEntry[];
  readonly changes: readonly PlaygroundScmChange[];
};

type ExpectedPlaygroundScmBlob = {
  readonly source: 'head' | 'index' | 'working' | 'empty';
  readonly bytes: Uint8Array;
};

type ExpectedPlaygroundScmDiff = {
  readonly original: PlaygroundScmBlob;
  readonly modified: PlaygroundScmBlob;
};

type ExpectedPlaygroundScm = {
  snapshot(): PlaygroundScmSnapshot;
  subscribe(listener: (snapshot: PlaygroundScmSnapshot) => void): () => void;
  refresh(): Promise<PlaygroundScmSnapshot>;
  diff(change: PlaygroundScmChange): Promise<PlaygroundScmDiff>;
  stage(path: string): Promise<void>;
  unstage(path: string): Promise<void>;
  discard(path: string): Promise<void>;
  commit(message: string): Promise<string>;
};

type ExpectedPlaygroundArchive = {
  export(): Promise<string>;
  import(archiveJson: string): Promise<void>;
};

type ExpectedProjectTerminalSnapshot = {
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
};

type ExpectedPlaygroundProjectOpenOptions = {
  readonly initialTerminalState?: ProjectTerminalSnapshot;
};

type ExpectedPlaygroundPreview = {
  readonly port: number;
  readonly url: string;
  readonly label: string;
  readonly source: 'dev-server' | 'preview' | 'node';
};

type ExpectedPlaygroundPreviewRegistry = {
  snapshot(): readonly PlaygroundPreview[];
  subscribe(listener: (snapshot: readonly PlaygroundPreview[]) => void): () => void;
};

type ExpectedPlaygroundSessionTools = {
  readonly typescript: PlaygroundTypeScript;
  readonly scm: PlaygroundScm;
  readonly archive: PlaygroundArchive;
  readonly previews: PlaygroundPreviewRegistry;
};

afterEach(() => vi.unstubAllGlobals());

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function options(): WorkbenchOptions {
  return {
    deployment: {
      workers: {
        owner: '/owner.js',
        kernel: '/kernel.js',
        node: '/node.js',
        devServer: '/dev-server.js',
      },
      serviceWorker: { url: '/service-worker.js', scope: '/' },
      wasm: { sqlite: '/sqlite.wasm', esbuild: '/esbuild.wasm' },
    },
    packageAcquisition: { registryUrl: '/npm-registry' },
    storage: { persistence: 'ephemeral' },
  };
}

function createContent() {
  const snapshots = new SnapshotFs(CONTENT_ROOT);
  snapshots.bindOwner(OWNER_EPOCH, CONTENT_ROOT);
  snapshots.update({
    type: 'snapshot',
    root: CONTENT_ROOT,
    ownerEpoch: OWNER_EPOCH,
    treeRevision: 1,
    nodeModulesPresent: false,
    entries: [
      {
        path: `${CONTENT_ROOT}/src`,
        kind: 'dir',
        size: 0,
        version: 'dir-v1',
      },
      {
        path: `${CONTENT_ROOT}/src/main.ts`,
        kind: 'file',
        size: 3,
        content: encoder.encode('old'),
        version: 'file-v1',
      },
    ],
  });
  const ownerClosed = deferred<void>();
  const committer = createVfsCommitCoordinator({
    captureOwner: () => ({
      ownerEpoch: OWNER_EPOCH,
      isAlive: () => true,
      closed: ownerClosed.promise,
      applyHostCommit: async () => {
        throw new Error('Playground companion contract did not expect a content commit');
      },
      durabilityBarrier: async (treeRevision) => ({
        ownerEpoch: OWNER_EPOCH,
        treeRevision,
        durability: 'ephemeral' as const,
      }),
    }),
    subscribeSnapshots: (listener) => snapshots.subscribeRevisions(listener),
    timeoutMs: 1_000,
  });
  const readVersionedFile = async (path: string): Promise<ProjectDocumentReadEntry> => ({
    path,
    kind: 'file',
    size: 3,
    content: encoder.encode('old'),
    version: 'file-v1',
    ownerEpoch: OWNER_EPOCH,
    treeRevision: 1,
  });
  return createProjectContentController({
    projectRoot: CONTENT_ROOT,
    snapshots,
    committer,
    readVersionedFile,
    readVersionedDirectory: async () => [],
  });
}

function createOwnerSession<TReady>(
  beforeCoreClose: () => Promise<void>,
  coreRuntimeFailure: () => Error | null,
  events: string[],
): ProjectSession<TReady> {
  const content = createContent();
  const neverClosed = deferred<void>();
  const terminal = createProjectTerminal({
    id: 'playground-contract-terminal',
    port: {
      closed: neverClosed.promise,
      isAlive: () => true,
      openSession: async () => {},
      snapshot: () => ({ cwd: '/', env: {} }),
      execResult: async () => {
        throw new Error('Playground companion contract did not run a terminal command');
      },
      writeStdin: async () => {},
      endStdin: async () => {},
      resizeSession: async () => {},
      resize: async () => {},
      signal: () => {},
      closeSession: async () => {
        events.push('core:terminal');
      },
    },
  });
  const runtime: ProjectRuntime<TReady> = {
    start() {
      throw new Error('Playground companion contract did not start a runtime');
    },
    async close() {
      events.push('core:runtime');
      const failure = coreRuntimeFailure();
      if (failure !== null) throw failure;
    },
  };
  const session = createProjectSession({
    content,
    runtime,
    terminal,
    createTerminal: () => {
      throw new Error('Playground companion contract did not open another terminal');
    },
    async closeOwner() {
      events.push('core:project-transport');
    },
  });
  return Object.freeze({
    files: session.files,
    documents: session.documents,
    run: () => session.run(),
    terminals: session.terminals,
    async close() {
      content.preflightClose();
      await beforeCoreClose();
      await session.close();
    },
  });
}

interface RootHarness {
  readonly workbench: Workbench;
  readonly ownerStart: ReturnType<typeof vi.fn>;
  readonly ownerOpen: ReturnType<typeof vi.fn>;
  readonly ownerSessions: readonly ProjectSession<unknown>[];
  readonly ownerDelete: ReturnType<typeof vi.fn>;
  readonly ownerClose: ReturnType<typeof vi.fn>;
  readonly events: string[];
  setBeforeCoreClose(hook: () => Promise<void>): void;
  failCoreRuntimeWith(error: Error | null): void;
}

async function createRootHarness(): Promise<RootHarness> {
  const events: string[] = [];
  const ownerSessions: ProjectSession<unknown>[] = [];
  let beforeCoreClose = async (): Promise<void> => {};
  let coreRuntimeFailure: Error | null = null;
  const ownerOpen = vi.fn((_definition: InspectedProjectDefinition) => {});
  const openProject = async <TReady>(
    definition: InspectedProjectDefinition<TReady>,
  ): Promise<ProjectSession<TReady>> => {
    ownerOpen(definition);
    const session = createOwnerSession<TReady>(
      () => beforeCoreClose(),
      () => coreRuntimeFailure,
      events,
    );
    ownerSessions.push(session as ProjectSession<unknown>);
    return session;
  };
  const ownerClose = vi.fn(async () => {
    events.push('owner:close');
  });
  const ownerDelete = vi.fn(async () => {});
  const ownerStart = vi.fn(async () => ({
    storage: Object.freeze({
      policy: 'ephemeral' as const,
      backend: 'memory' as const,
      durability: 'ephemeral' as const,
    }),
    owner: Object.freeze({
      openProject,
      deleteProject: ownerDelete,
      close: ownerClose,
    }),
  }));
  const controller = {
    postMessage(_message: unknown, transfer: Transferable[]) {
      const port = transfer[0];
      if (!(port instanceof MessagePort)) throw new Error('Missing service-worker reply port');
      port.postMessage({
        type: SW_PONG,
        from: 'service-worker',
        frameVersion: SW_FRAME_VERSION,
        routingVersion: SW_ROUTING_VERSION,
      });
    },
  };
  const dependencies = {
    urlContext: () => ({
      apiBaseUrl: 'https://playground.invalid/app/',
      clientUrl: 'https://playground.invalid/app/index.html',
    }),
    capabilities: () => ({ dom: true, worker: true, crossOriginIsolated: true, webLocks: true }),
    locks: {
      request: async (
        name: string,
        options: { readonly mode: 'exclusive'; readonly ifAvailable: true },
        callback: (
          lock: { readonly name: string; readonly mode: 'exclusive' } | null,
        ) => void | Promise<void>,
      ) => {
        await callback({ name, mode: options.mode });
      },
    },
    serviceWorker: {
      register: async () => {},
      controller,
      addEventListener: () => {},
      removeEventListener: () => {},
    },
    owner: { start: ownerStart },
    timers: { setTimeout: () => 1, clearTimeout: () => {} },
  } satisfies OpenWorkbenchDependencies;
  const workbench = await createOpenWorkbench(dependencies)(options());
  return {
    workbench,
    ownerStart,
    ownerOpen,
    ownerSessions,
    ownerDelete,
    ownerClose,
    events,
    setBeforeCoreClose(hook) {
      beforeCoreClose = hook;
    },
    failCoreRuntimeWith(error) {
      coreRuntimeFailure = error;
    },
  };
}

function catalog(
  activeId = 'vite-project',
): PlaygroundProjectCatalog & { readonly delete: ReturnType<typeof vi.fn> } {
  const snapshot = Object.freeze({
    active: Object.freeze({ kind: 'project' as const, id: activeId }),
    scratch: null,
    projects: Object.freeze([]),
  });
  const deleteProject = vi.fn(async () => snapshot);
  return Object.freeze({
    snapshot: () => snapshot,
    subscribe(listener: (value: typeof snapshot) => void) {
      listener(snapshot);
      return () => {};
    },
    createScratch: async () => snapshot,
    saveScratch: async () => snapshot,
    activate: async () => snapshot,
    rename: async () => snapshot,
    reset: async () => snapshot,
    delete: deleteProject,
  });
}

function typescriptTool(): PlaygroundTypeScript {
  const workspaceEdit = () => ({ changes: {} });
  return Object.freeze({
    open: async () => {},
    update: async () => {},
    close: async () => {},
    invalidate: async () => {},
    getSemanticDiagnostics: async () => [],
    getSyntacticDiagnostics: async () => [],
    getQuickInfo: async () => null,
    getDefinitionLinks: async () => ({ locations: [] }),
    getTypeDefinition: async () => [],
    getCompletions: async () => ({
      isIncomplete: false,
      isGlobalCompletion: false,
      isMemberCompletion: false,
      isNewIdentifierLocation: false,
      items: [],
    }),
    getCompletionDetails: async () => null,
    getReferences: async () => [],
    prepareRename: async () => null,
    getRenameEdits: async () => workspaceEdit(),
    getSignatureHelp: async () => null,
    getCodeFixes: async () => [],
    getCombinedCodeFix: async () => workspaceEdit(),
    organizeImports: async () => workspaceEdit(),
    getRefactorActions: async () => [],
    getFormattingEdits: async () => [],
    getRangeFormattingEdits: async () => [],
    getOnTypeFormattingEdits: async () => [],
    getImplementation: async () => [],
    getDocumentSymbols: async () => [],
    getFoldingRanges: async () => [],
    getInlayHints: async () => [],
    getDocumentHighlights: async () => [],
    getEncodedSemanticClassifications: async () => ({ spans: [], endOfLineState: 0 }),
    getSelectionRange: async () => null,
    getLinkedEditingRange: async () => null,
  } satisfies PlaygroundTypeScript);
}

function scmTool(): PlaygroundScm {
  const snapshot = Object.freeze({
    history: Object.freeze([]),
    changes: Object.freeze([]),
  }) satisfies PlaygroundScmSnapshot;
  const emptyBlob = (): PlaygroundScmBlob => ({
    source: 'empty',
    bytes: new Uint8Array(),
  });
  return Object.freeze({
    snapshot: () => snapshot,
    subscribe(listener: (snapshot: PlaygroundScmSnapshot) => void) {
      listener(snapshot);
      return () => {};
    },
    refresh: async () => snapshot,
    diff: async () => ({ original: emptyBlob(), modified: emptyBlob() }),
    stage: async () => {},
    unstage: async () => {},
    discard: async () => {},
    commit: async () => 'contract-commit',
  } satisfies PlaygroundScm);
}

function archiveTool(): PlaygroundArchive {
  return Object.freeze({
    export: async () => JSON.stringify({ version: 1, root: '/', files: [] }),
    import: async () => {},
  } satisfies PlaygroundArchive);
}

function previewTool(): PlaygroundPreviewRegistry {
  const snapshot: readonly PlaygroundPreview[] = Object.freeze([]);
  return Object.freeze({
    snapshot: () => snapshot,
    subscribe(listener: (value: readonly PlaygroundPreview[]) => void) {
      listener(snapshot);
      return () => {};
    },
  });
}

function tools(overrides: { readonly archive?: PlaygroundArchive } = {}): PlaygroundSessionTools {
  return Object.freeze({
    typescript: typescriptTool(),
    scm: scmTool(),
    archive: overrides.archive ?? archiveTool(),
    previews: previewTool(),
  } satisfies PlaygroundSessionTools);
}

function admittedArchiveTools(
  events: string[],
  gate: { readonly promise: Promise<void> },
): {
  readonly tools: PlaygroundSessionTools;
  readonly close: ReturnType<typeof vi.fn>;
} {
  let closing = false;
  let admitted: Promise<string> | null = null;
  const assertOpen = (): void => {
    if (closing) throw new ClosedHandleError('Playground archive');
  };
  const archive = Object.freeze({
    export() {
      try {
        assertOpen();
      } catch (error) {
        return Promise.reject(error);
      }
      events.push('tools:archive:start');
      const running = gate.promise.then(() => {
        events.push('tools:archive:end');
        return JSON.stringify({ version: 1, root: '/', files: [] });
      });
      admitted = running;
      return running;
    },
    import() {
      try {
        assertOpen();
        return Promise.resolve();
      } catch (error) {
        return Promise.reject(error);
      }
    },
  } satisfies PlaygroundArchive);
  const close = vi.fn(async () => {
    closing = true;
    events.push('tools:close');
    if (admitted !== null) await admitted;
  });
  return { tools: tools({ archive }), close };
}

function definePlan(plan: PlaygroundProjectPlan): ProjectDefinition<unknown> {
  const common = {
    id: plan.id,
    files: plan.files,
    dependencies: plan.dependencies,
    devDependencies: plan.devDependencies,
  };
  switch (plan.kind) {
    case 'vite':
      return projects.vite({ ...common, viteVersion: plan.viteVersion });
    case 'node-server':
      return defineNodeServerProject({ ...common, entryPath: plan.entryPath, port: plan.port });
    case 'node-cli':
      return defineNodeCliProject({ ...common, entryPath: plan.entryPath, args: plan.args });
  }
}

const install = Object.freeze({ kind: 'install' as const });
const VALID_SNAPSHOT_ID = `sha256:${'a'.repeat(64)}`;

function vitePlan(overrides: Partial<VitePlaygroundPlan> = {}): VitePlaygroundPlan {
  return {
    kind: 'vite',
    id: 'vite-project',
    starterId: 'vite-starter',
    templateId: 'vite-template-v1',
    port: 5174,
    files: { '/index.html': '<main>Vite</main>' },
    firstMaterialization: install,
    ...overrides,
  };
}

describe('Playground companion sealed contract', () => {
  it('keeps the root unchanged and exposes only the companion opener at runtime', () => {
    expect(Object.keys(companionModule).sort()).toEqual(['openPlaygroundWorkbench']);
    expect(Object.keys(rootModule).sort()).toEqual([
      'ClosedHandleError',
      'DirtyProjectDocumentError',
      'FileConflictError',
      'ProjectBusyError',
      'ProjectDefinitionMismatchError',
      'ProjectDocumentSaveInProgressError',
      'ProjectFileOperationError',
      'ProjectRunExitedBeforeReadyError',
      'StaleProjectDocumentError',
      'StdinClosedError',
      'openWorkbench',
      'projects',
    ]);
    expect(rootModule).not.toHaveProperty('openPlaygroundWorkbench');
    expect(rootModule).not.toHaveProperty('PlaygroundWorkbench');
    expectTypeOf(openPlaygroundWorkbench).toEqualTypeOf<
      (options: WorkbenchOptions) => Promise<PlaygroundWorkbench>
    >();
    expectTypeOf<PlaygroundScmChange>().toEqualTypeOf<ExpectedPlaygroundScmChange>();
    expectTypeOf<PlaygroundScmSnapshot>().toEqualTypeOf<ExpectedPlaygroundScmSnapshot>();
    expectTypeOf<PlaygroundScmBlob>().toEqualTypeOf<ExpectedPlaygroundScmBlob>();
    expectTypeOf<PlaygroundScmDiff>().toEqualTypeOf<ExpectedPlaygroundScmDiff>();
    expectTypeOf<PlaygroundScm>().toEqualTypeOf<ExpectedPlaygroundScm>();
    expectTypeOf<PlaygroundArchive>().toEqualTypeOf<ExpectedPlaygroundArchive>();
    expectTypeOf<PlaygroundPreview>().toEqualTypeOf<ExpectedPlaygroundPreview>();
    expectTypeOf<PlaygroundPreviewRegistry>().toEqualTypeOf<ExpectedPlaygroundPreviewRegistry>();
    expectTypeOf<ProjectTerminalSnapshot>().toEqualTypeOf<ExpectedProjectTerminalSnapshot>();
    expectTypeOf<PlaygroundProjectOpenOptions>().toEqualTypeOf<ExpectedPlaygroundProjectOpenOptions>();
    expectTypeOf<ProjectTerminal['snapshot']>().returns.toEqualTypeOf<ProjectTerminalSnapshot>();
    expectTypeOf<PlaygroundSessionTools>().toEqualTypeOf<ExpectedPlaygroundSessionTools>();
  });

  it('preserves the three finite define overloads and rejects widened plan shapes in types', async () => {
    const root = await createRootHarness();
    const facade = createPlaygroundWorkbenchFacade({
      workbench: root.workbench,
      urlContext: CAPTURED_URL_CONTEXT,
      definePlan,
      catalog: catalog(),
      createSessionTools: () => ({ tools: tools(), close: async () => {} }),
      registerBeforeClose: () => {},
    });
    const viteDefinition = facade.playground.define(vitePlan());
    const serverPlan: NodeServerPlaygroundPlan = {
      kind: 'node-server',
      id: 'server-project',
      starterId: 'server-starter',
      templateId: 'server-template-v1',
      files: { '/server.js': 'console.log("server")' },
      entryPath: '/server.js',
      port: 3000,
      firstMaterialization: install,
    };
    const serverDefinition = facade.playground.define(serverPlan);
    const cliDefinition = facade.playground.define({
      kind: 'node-cli',
      id: 'cli-project',
      starterId: 'cli-starter',
      templateId: 'cli-template-v1',
      files: { '/cli.js': 'console.log("cli")' },
      entryPath: '/cli.js',
      args: ['--version'],
      firstMaterialization: install,
    });

    expectTypeOf(viteDefinition).toEqualTypeOf<ProjectDefinition<PreviewHandle>>();
    expectTypeOf(serverDefinition).toEqualTypeOf<ProjectDefinition<PreviewHandle>>();
    expectTypeOf(cliDefinition).toEqualTypeOf<ProjectDefinition<void>>();
    // @ts-expect-error node-server plans require a port
    const serverWithoutPort: NodeServerPlaygroundPlan = {
      kind: 'node-server',
      id: 'server-project',
      starterId: 'server-starter',
      templateId: 'server-template-v1',
      files: { '/server.js': '' },
      entryPath: '/server.js',
      firstMaterialization: install,
    };
    // @ts-expect-error UI policy is not part of a finite plan
    const planWithUiPolicy: VitePlaygroundPlan = { ...vitePlan(), displayName: 'UI label' };
    // @ts-expect-error Vite plans require the exact runtime port
    const viteWithoutPort: VitePlaygroundPlan = {
      kind: 'vite',
      id: 'vite-project',
      starterId: 'vite-starter',
      templateId: 'vite-template-v1',
      files: { '/index.html': '' },
      firstMaterialization: install,
    };
    expect(serverWithoutPort).toBeDefined();
    expect(planWithUiPolicy).toBeDefined();
    expect(viteWithoutPort).toBeDefined();
    await root.workbench.close();
  });
});

describe('Playground opener URL-context authority', () => {
  it('captures one immutable URL context before the root page claim and never rereads globals', async () => {
    const events: string[] = [];
    let currentApiBase: string = CAPTURED_URL_CONTEXT.apiBaseUrl;
    let currentClientUrl: string = CAPTURED_URL_CONTEXT.clientUrl;
    let documentReads = 0;
    let locationReads = 0;
    vi.stubGlobal('document', {
      get baseURI() {
        documentReads += 1;
        return currentApiBase;
      },
    });
    vi.stubGlobal('location', {
      get href() {
        locationReads += 1;
        return currentClientUrl;
      },
    });
    const captureUrlContext = vi.fn(() => {
      events.push('capture:url');
      return {
        apiBaseUrl: globalThis.document.baseURI,
        clientUrl: globalThis.location.href,
      };
    });
    let root: RootHarness | undefined;
    const capturedPlans: PlaygroundProjectPlan[] = [];
    const open = createOpenPlaygroundWorkbench({
      captureUrlContext,
      async openWorkbench(workbenchOptions: WorkbenchOptions, urlContext: CapturedUrlContext) {
        events.push('root:page-claim');
        expect(workbenchOptions).toBe(openOptions);
        expect(urlContext).toEqual(CAPTURED_URL_CONTEXT);
        expect(Object.isFrozen(urlContext)).toBe(true);
        currentApiBase = 'https://relocated.invalid/other/index.html';
        currentClientUrl = 'https://relocated.invalid/other/index.html';
        root = await createRootHarness();
        return root.workbench;
      },
      createFacade({
        workbench,
        urlContext,
      }: {
        readonly workbench: Workbench;
        readonly urlContext: CapturedUrlContext;
      }) {
        events.push('facade:create');
        return createPlaygroundWorkbenchFacade({
          workbench,
          urlContext,
          definePlan: (plan: PlaygroundProjectPlan) => {
            events.push('define');
            capturedPlans.push(plan);
            return definePlan(plan);
          },
          catalog: catalog(),
          createSessionTools: () => ({ tools: tools(), close: async () => {} }),
          registerBeforeClose: () => {},
        });
      },
    });
    const openOptions = options();

    const workbench = await open(openOptions);
    workbench.playground.define(
      vitePlan({
        firstMaterialization: {
          kind: 'snapshot',
          snapshot: {
            snapshotId: VALID_SNAPSHOT_ID,
            assetUrl: './snapshots/vite.json',
            templateId: 'vite-template-v1',
          },
        },
      }),
    );

    expect(events).toEqual(['capture:url', 'root:page-claim', 'facade:create', 'define']);
    expect(captureUrlContext).toHaveBeenCalledTimes(1);
    expect(documentReads).toBe(1);
    expect(locationReads).toBe(1);
    const captured = capturedPlans[0];
    if (captured?.firstMaterialization.kind !== 'snapshot') {
      throw new Error('Snapshot plan was not captured');
    }
    expect(captured.firstMaterialization.snapshot.assetUrl).toBe(
      'https://playground.invalid/app/snapshots/vite.json',
    );
    await workbench.close();
    expect(root?.ownerClose).toHaveBeenCalledTimes(1);
  });
});

describe('Playground plan validation', () => {
  it('copies plan-owned data, freezes enclosing records and resolves a trusted asset once', async () => {
    const documentContext = { baseURI: 'https://playground.invalid/app/index.html' };
    vi.stubGlobal('document', documentContext);
    vi.stubGlobal('location', { href: 'https://playground.invalid/app/index.html' });
    const root = await createRootHarness();
    const captured: PlaygroundProjectPlan[] = [];
    const facade = createPlaygroundWorkbenchFacade({
      workbench: root.workbench,
      urlContext: CAPTURED_URL_CONTEXT,
      definePlan: (plan: PlaygroundProjectPlan) => {
        captured.push(plan);
        return definePlan(plan);
      },
      catalog: catalog(),
      createSessionTools: () => ({ tools: tools(), close: async () => {} }),
      registerBeforeClose: () => {},
    });
    documentContext.baseURI = 'https://playground.invalid/relocated/index.html';
    const bytes = new Uint8Array([1, 2, 3]);
    const files: Record<string, string | Uint8Array> = { '/asset.bin': bytes };
    const dependencies: Record<string, string> = { kleur: '4.1.5' };
    const devDependencies: Record<string, string> = { typescript: '5.9.3' };
    const args = ['--color'];
    const snapshot = {
      snapshotId: VALID_SNAPSHOT_ID,
      assetUrl: './snapshots/cli.json',
      templateId: 'cli-copy-template',
    };
    const firstMaterialization = { kind: 'snapshot' as const, snapshot };
    const plan: NodeCliPlaygroundPlan = {
      kind: 'node-cli',
      id: 'cli-copy',
      starterId: 'cli-starter',
      templateId: 'cli-copy-template',
      files,
      dependencies,
      devDependencies,
      entryPath: '/asset.bin',
      args,
      firstMaterialization,
    };

    facade.playground.define(plan);
    const owned = captured[0];
    if (owned?.kind !== 'node-cli') throw new Error('Plan was not captured');
    if (owned.firstMaterialization.kind !== 'snapshot') {
      throw new Error('Snapshot materialization was not captured');
    }
    expect(owned.firstMaterialization).not.toBe(firstMaterialization);
    expect(owned.firstMaterialization.snapshot).not.toBe(snapshot);
    expect(Object.isFrozen(firstMaterialization)).toBe(false);
    expect(Object.isFrozen(snapshot)).toBe(false);
    bytes[0] = 99;
    files['/late.js'] = 'late';
    dependencies.kleur = '0.0.0';
    devDependencies.typescript = '0.0.0';
    args.push('--late');
    snapshot.assetUrl = './snapshots/caller-mutated.json';
    firstMaterialization.snapshot = {
      snapshotId: `sha256:${'b'.repeat(64)}`,
      assetUrl: './snapshots/caller-replaced.json',
      templateId: 'caller-replaced-template',
    };

    expect(owned).not.toBe(plan);
    expect(Object.isFrozen(owned)).toBe(true);
    expect(Object.isFrozen(owned.files)).toBe(true);
    expect(Object.isFrozen(owned.dependencies)).toBe(true);
    expect(Object.isFrozen(owned.devDependencies)).toBe(true);
    expect(Object.isFrozen(owned.args)).toBe(true);
    expect(Object.isFrozen(owned.firstMaterialization)).toBe(true);
    expect(Object.isFrozen(owned.firstMaterialization.snapshot)).toBe(true);
    expect([...((owned.files['/asset.bin'] as Uint8Array) ?? [])]).toEqual([1, 2, 3]);
    expect(owned.files).not.toHaveProperty('/late.js');
    expect(owned.dependencies).toEqual({ kleur: '4.1.5' });
    expect(owned.devDependencies).toEqual({ typescript: '5.9.3' });
    expect(owned.args).toEqual(['--color']);
    expect(owned.firstMaterialization.snapshot.snapshotId).toBe(VALID_SNAPSHOT_ID);
    expect(owned.firstMaterialization.snapshot.assetUrl).toBe(
      'https://playground.invalid/app/snapshots/cli.json',
    );
    expect(owned.firstMaterialization.snapshot.templateId).toBe('cli-copy-template');
    await root.workbench.close();
  });

  it('rejects accessors, prototypes, symbols, callbacks, unknown keys and invalid snapshot URLs before definition effects', async () => {
    vi.stubGlobal('document', { baseURI: 'https://playground.invalid/app/index.html' });
    vi.stubGlobal('location', { href: 'https://playground.invalid/app/index.html' });
    const root = await createRootHarness();
    const effect = vi.fn(definePlan);
    const facade = createPlaygroundWorkbenchFacade({
      workbench: root.workbench,
      urlContext: CAPTURED_URL_CONTEXT,
      definePlan: effect,
      catalog: catalog(),
      createSessionTools: () => ({ tools: tools(), close: async () => {} }),
      registerBeforeClose: () => {},
    });
    let getterCalls = 0;
    const accessor = { ...vitePlan() } as Record<PropertyKey, unknown>;
    Object.defineProperty(accessor, 'id', {
      enumerable: true,
      get() {
        getterCalls++;
        return 'accessor';
      },
    });
    const customPrototype = Object.assign(Object.create({ inherited: true }), vitePlan());
    const symbolKey = { ...vitePlan(), [Symbol('owner')]: 'leak' };
    const accessorShape = (value: object, key: PropertyKey): object => {
      const copy = Array.isArray(value) ? [...value] : { ...value };
      const original = Reflect.get(value, key);
      Object.defineProperty(copy, key, {
        enumerable: true,
        configurable: true,
        get() {
          getterCalls++;
          return original;
        },
      });
      return copy;
    };
    const nonEnumerableAccessorShape = (value: object, key: PropertyKey): object => {
      const copy = Array.isArray(value) ? [...value] : { ...value };
      const original = Reflect.get(value, key);
      Object.defineProperty(copy, key, {
        enumerable: false,
        configurable: true,
        get() {
          getterCalls++;
          return original;
        },
      });
      return copy;
    };
    const nonEnumerableUnknownShape = (value: object): object => {
      const copy = Array.isArray(value) ? [...value] : { ...value };
      Object.defineProperty(copy, 'hiddenOwnerKey', {
        enumerable: false,
        configurable: true,
        value: 'leak',
      });
      return copy;
    };
    const symbolShape = (value: object): object => {
      const copy = Array.isArray(value) ? [...value] : { ...value };
      Object.defineProperty(copy, Symbol('private-owner'), {
        enumerable: true,
        value: 'leak',
      });
      return copy;
    };
    const customPrototypeShape = (value: object): object => {
      if (!Array.isArray(value)) return Object.assign(Object.create({ inherited: true }), value);
      const copy = [...value];
      Object.setPrototypeOf(copy, Object.create(Array.prototype));
      return copy;
    };
    const dependencyRecord = { kleur: '4.1.5' };
    const devDependencyRecord = { typescript: '5.9.3' };
    const fileRecord = { '/index.html': '<main>Vite</main>' };
    const cliArgs = ['--color'];
    const installMaterialization = { kind: 'install' as const };
    const snapshot = {
      snapshotId: VALID_SNAPSHOT_ID,
      assetUrl: '/snapshot.json',
      templateId: 'vite-template-v1',
    };
    const snapshotMaterialization = { kind: 'snapshot' as const, snapshot };
    const bytesWithCustomPrototype = new Uint8Array([1, 2]);
    Object.setPrototypeOf(bytesWithCustomPrototype, Object.create(Uint8Array.prototype));
    const bytesWithAccessor = new Uint8Array([1, 2]);
    Object.defineProperty(bytesWithAccessor, 'owner', {
      enumerable: false,
      configurable: true,
      get() {
        getterCalls++;
        return 'leak';
      },
    });
    const bytesWithHiddenUnknown = new Uint8Array([1, 2]);
    Object.defineProperty(bytesWithHiddenUnknown, 'hiddenOwnerKey', {
      enumerable: false,
      configurable: true,
      value: 'leak',
    });
    const bytesWithSymbol = new Uint8Array([1, 2]);
    Object.defineProperty(bytesWithSymbol, Symbol('private-owner'), {
      enumerable: true,
      configurable: true,
      value: 'leak',
    });
    const invalid: unknown[] = [
      { ...vitePlan(), displayName: 'UI label' },
      { ...vitePlan(), runtime: () => 'callback' },
      accessor,
      nonEnumerableAccessorShape(vitePlan(), 'id'),
      nonEnumerableUnknownShape(vitePlan()),
      customPrototype,
      symbolKey,
      { ...vitePlan(), files: Object.assign(Object.create({}), { '/index.html': 'x' }) },
      { ...vitePlan(), files: accessorShape(fileRecord, '/index.html') },
      { ...vitePlan(), files: nonEnumerableAccessorShape(fileRecord, '/index.html') },
      { ...vitePlan(), files: nonEnumerableUnknownShape(fileRecord) },
      { ...vitePlan(), files: symbolShape(fileRecord) },
      { ...vitePlan(), files: { '/asset.bin': new Uint16Array([1, 2]) } },
      { ...vitePlan(), files: { '/asset.bin': { bytes: [1, 2] } } },
      { ...vitePlan(), files: { '/asset.bin': () => new Uint8Array() } },
      { ...vitePlan(), files: { '/asset.bin': bytesWithCustomPrototype } },
      { ...vitePlan(), files: { '/asset.bin': bytesWithAccessor } },
      { ...vitePlan(), files: { '/asset.bin': bytesWithHiddenUnknown } },
      { ...vitePlan(), files: { '/asset.bin': bytesWithSymbol } },
      { ...vitePlan(), dependencies: accessorShape(dependencyRecord, 'kleur') },
      {
        ...vitePlan(),
        dependencies: nonEnumerableAccessorShape(dependencyRecord, 'kleur'),
      },
      { ...vitePlan(), dependencies: nonEnumerableUnknownShape(dependencyRecord) },
      { ...vitePlan(), dependencies: symbolShape(dependencyRecord) },
      { ...vitePlan(), dependencies: customPrototypeShape(dependencyRecord) },
      { ...vitePlan(), dependencies: { kleur: 4 } },
      { ...vitePlan(), devDependencies: accessorShape(devDependencyRecord, 'typescript') },
      {
        ...vitePlan(),
        devDependencies: nonEnumerableAccessorShape(devDependencyRecord, 'typescript'),
      },
      { ...vitePlan(), devDependencies: nonEnumerableUnknownShape(devDependencyRecord) },
      { ...vitePlan(), devDependencies: symbolShape(devDependencyRecord) },
      { ...vitePlan(), devDependencies: customPrototypeShape(devDependencyRecord) },
      { ...vitePlan(), devDependencies: { typescript: null } },
      {
        kind: 'node-cli',
        id: 'cli-invalid-args',
        starterId: 'cli-starter',
        templateId: 'cli-template',
        files: { '/cli.js': '' },
        entryPath: '/cli.js',
        args: accessorShape(cliArgs, 0),
        firstMaterialization: installMaterialization,
      },
      {
        kind: 'node-cli',
        id: 'cli-invalid-args',
        starterId: 'cli-starter',
        templateId: 'cli-template',
        files: { '/cli.js': '' },
        entryPath: '/cli.js',
        args: nonEnumerableAccessorShape(cliArgs, 0),
        firstMaterialization: installMaterialization,
      },
      {
        kind: 'node-cli',
        id: 'cli-invalid-args',
        starterId: 'cli-starter',
        templateId: 'cli-template',
        files: { '/cli.js': '' },
        entryPath: '/cli.js',
        args: nonEnumerableUnknownShape(cliArgs),
        firstMaterialization: installMaterialization,
      },
      {
        kind: 'node-cli',
        id: 'cli-invalid-args',
        starterId: 'cli-starter',
        templateId: 'cli-template',
        files: { '/cli.js': '' },
        entryPath: '/cli.js',
        args: symbolShape(cliArgs),
        firstMaterialization: installMaterialization,
      },
      {
        kind: 'node-cli',
        id: 'cli-invalid-args',
        starterId: 'cli-starter',
        templateId: 'cli-template',
        files: { '/cli.js': '' },
        entryPath: '/cli.js',
        args: customPrototypeShape(cliArgs),
        firstMaterialization: installMaterialization,
      },
      {
        kind: 'node-cli',
        id: 'cli-invalid-args',
        starterId: 'cli-starter',
        templateId: 'cli-template',
        files: { '/cli.js': '' },
        entryPath: '/cli.js',
        args: ['--ok', () => '--not-clone-safe'],
        firstMaterialization: installMaterialization,
      },
      { ...vitePlan(), firstMaterialization: accessorShape(installMaterialization, 'kind') },
      {
        ...vitePlan(),
        firstMaterialization: nonEnumerableAccessorShape(installMaterialization, 'kind'),
      },
      {
        ...vitePlan(),
        firstMaterialization: nonEnumerableUnknownShape(installMaterialization),
      },
      { ...vitePlan(), firstMaterialization: symbolShape(installMaterialization) },
      { ...vitePlan(), firstMaterialization: customPrototypeShape(installMaterialization) },
      { ...vitePlan(), firstMaterialization: accessorShape(snapshotMaterialization, 'kind') },
      {
        ...vitePlan(),
        firstMaterialization: nonEnumerableAccessorShape(snapshotMaterialization, 'kind'),
      },
      {
        ...vitePlan(),
        firstMaterialization: nonEnumerableUnknownShape(snapshotMaterialization),
      },
      { ...vitePlan(), firstMaterialization: symbolShape(snapshotMaterialization) },
      { ...vitePlan(), firstMaterialization: customPrototypeShape(snapshotMaterialization) },
      {
        ...vitePlan(),
        firstMaterialization: {
          ...snapshotMaterialization,
          snapshot: accessorShape(snapshot, 'assetUrl'),
        },
      },
      {
        ...vitePlan(),
        firstMaterialization: {
          ...snapshotMaterialization,
          snapshot: symbolShape(snapshot),
        },
      },
      {
        ...vitePlan(),
        firstMaterialization: {
          ...snapshotMaterialization,
          snapshot: customPrototypeShape(snapshot),
        },
      },
      {
        ...vitePlan(),
        firstMaterialization: {
          ...snapshotMaterialization,
          snapshot: nonEnumerableAccessorShape(snapshot, 'assetUrl'),
        },
      },
      {
        ...vitePlan(),
        firstMaterialization: {
          ...snapshotMaterialization,
          snapshot: nonEnumerableUnknownShape(snapshot),
        },
      },
      { ...vitePlan(), firstMaterialization: { ...snapshotMaterialization, ownerKey: 'leak' } },
      {
        ...vitePlan(),
        firstMaterialization: {
          ...snapshotMaterialization,
          snapshot: { ...snapshot, ownerKey: 'leak' },
        },
      },
      { ...vitePlan(), firstMaterialization: { kind: 'install', snapshot: {} } },
      { ...vitePlan(), port: 0 },
      { ...vitePlan(), port: 65_536 },
      {
        ...vitePlan(),
        firstMaterialization: {
          kind: 'snapshot',
          snapshot: {
            snapshotId: 'snapshot-v2',
            assetUrl: '/snapshot.json',
            templateId: 'vite-template-v1',
          },
        },
      },
      {
        ...vitePlan(),
        firstMaterialization: {
          kind: 'snapshot',
          snapshot: {
            snapshotId: `sha256:${'a'.repeat(63)}`,
            assetUrl: '/snapshot.json',
            templateId: 'vite-template-v1',
          },
        },
      },
      {
        ...vitePlan(),
        firstMaterialization: {
          kind: 'snapshot',
          snapshot: {
            snapshotId: `sha256:${'a'.repeat(65)}`,
            assetUrl: '/snapshot.json',
            templateId: 'vite-template-v1',
          },
        },
      },
      {
        ...vitePlan(),
        firstMaterialization: {
          kind: 'snapshot',
          snapshot: {
            snapshotId: `sha256:${'A'.repeat(64)}`,
            assetUrl: '/snapshot.json',
            templateId: 'vite-template-v1',
          },
        },
      },
      {
        ...vitePlan(),
        firstMaterialization: {
          kind: 'snapshot',
          snapshot: {
            snapshotId: VALID_SNAPSHOT_ID,
            assetUrl: 'https://other.invalid/snapshot.json',
            templateId: 'vite-template-v1',
          },
        },
      },
      {
        ...vitePlan(),
        firstMaterialization: {
          kind: 'snapshot',
          snapshot: {
            snapshotId: VALID_SNAPSHOT_ID,
            assetUrl: 'https://playground.invalid/snapshot.json#fragment',
            templateId: 'vite-template-v1',
          },
        },
      },
      {
        ...vitePlan(),
        firstMaterialization: {
          kind: 'snapshot',
          snapshot: {
            snapshotId: VALID_SNAPSHOT_ID,
            assetUrl: 'https://user:secret@playground.invalid/snapshot.json',
            templateId: 'vite-template-v1',
          },
        },
      },
      {
        ...vitePlan(),
        firstMaterialization: {
          kind: 'snapshot',
          snapshot: {
            snapshotId: VALID_SNAPSHOT_ID,
            assetUrl: 'blob:https://playground.invalid/owner-private-snapshot',
            templateId: 'vite-template-v1',
          },
        },
      },
    ];

    for (const candidate of invalid) {
      expect(() => facade.playground.define(candidate as PlaygroundProjectPlan)).toThrow(TypeError);
    }
    expect(getterCalls).toBe(0);
    expect(effect).not.toHaveBeenCalled();
    await root.workbench.close();
  });

  it('rejects the retired root snapshot URL before capability or owner effects', async () => {
    const effect = vi.fn(() => {
      throw new Error('root validation crossed into capability effects');
    });
    const ownerStart = vi.fn(async () => {
      throw new Error('root validation crossed into owner effects');
    });
    const open = createOpenWorkbench({
      urlContext: () => CAPTURED_URL_CONTEXT,
      capabilities: () => {
        effect();
        return { dom: true, worker: true, crossOriginIsolated: true, webLocks: true };
      },
      locks: {
        request: async () => {
          throw new Error('root validation crossed into lock effects');
        },
      },
      serviceWorker: {
        register: async () => {},
        controller: null,
        addEventListener: () => {},
        removeEventListener: () => {},
      },
      owner: { start: ownerStart },
      timers: { setTimeout: () => 1, clearTimeout: () => {} },
    });
    const legacy = {
      ...options(),
      packageAcquisition: {
        ...options().packageAcquisition,
        snapshotUrl: '/retired-snapshot.json.gz',
      },
    } as WorkbenchOptions;

    await expect(open(legacy)).rejects.toThrow(/snapshotUrl/);
    expect(effect).not.toHaveBeenCalled();
    expect(ownerStart).not.toHaveBeenCalled();
  });
});

describe('Playground session authority and teardown', () => {
  it('rejects malformed initial terminal state before invoking the project-open effect', async () => {
    const root = await createRootHarness();
    let openProjectCalls = 0;
    const openProject = <TReady>(definition: ProjectDefinition<TReady>) => {
      openProjectCalls += 1;
      return root.workbench.openProject(definition);
    };
    const facade = createPlaygroundWorkbenchFacade({
      workbench: root.workbench,
      urlContext: CAPTURED_URL_CONTEXT,
      definePlan,
      catalog: catalog(),
      openProject,
      createSessionTools: () => ({ tools: tools(), close: async () => {} }),
      registerBeforeClose: () => {},
    });
    const definition = facade.playground.define(vitePlan());
    const cwdRead = vi.fn(() => '/');
    const malformed = Object.defineProperty({ env: {} }, 'cwd', {
      enumerable: true,
      get: cwdRead,
    });

    const outcome = await facade
      .openProject(definition, { initialTerminalState: malformed } as never)
      .then(
        (session) => session,
        (error: unknown) => error,
      );
    if (!(outcome instanceof Error)) await (outcome as ProjectSession<unknown>).close();

    expect(outcome).toBeInstanceOf(TypeError);
    expect(cwdRead).not.toHaveBeenCalled();
    expect(openProjectCalls).toBe(0);
    expect(root.ownerOpen).not.toHaveBeenCalled();
    await facade.close();
  });

  it('defensively owns and freezes initial terminal state before invoking project open', async () => {
    const root = await createRootHarness();
    const admitted: PlaygroundProjectOpenOptions[] = [];
    const facade = createPlaygroundWorkbenchFacade({
      workbench: root.workbench,
      urlContext: CAPTURED_URL_CONTEXT,
      definePlan,
      catalog: catalog(),
      openProject: <TReady>(
        definition: ProjectDefinition<TReady>,
        projectOptions: PlaygroundProjectOpenOptions,
      ) => {
        admitted.push(projectOptions);
        return root.workbench.openProject(definition);
      },
      createSessionTools: () => ({ tools: tools(), close: async () => {} }),
      registerBeforeClose: () => {},
    });
    const definition = facade.playground.define(vitePlan());
    const env = { PATH: '/bin', RIFTY_OWNER_TOKEN: 'opaque-guest-data' };
    const initialTerminalState = { cwd: '/src', env };

    const opening = facade.openProject(definition, { initialTerminalState });
    initialTerminalState.cwd = '/mutated';
    env.PATH = '/mutated';
    const session = await opening;

    expect(admitted).toEqual([
      {
        initialTerminalState: {
          cwd: '/src',
          env: { PATH: '/bin', RIFTY_OWNER_TOKEN: 'opaque-guest-data' },
        },
      },
    ]);
    expect(Object.isFrozen(admitted[0])).toBe(true);
    expect(Object.isFrozen(admitted[0]?.initialTerminalState)).toBe(true);
    expect(Object.isFrozen(admitted[0]?.initialTerminalState?.env)).toBe(true);
    await session.close();
    await facade.close();
  });

  it('gates inherited open by companion identity and active catalog ref, then serializes delete through the catalog', async () => {
    const root = await createRootHarness();
    const projectCatalog = catalog();
    const facade = createPlaygroundWorkbenchFacade({
      workbench: root.workbench,
      urlContext: CAPTURED_URL_CONTEXT,
      definePlan,
      catalog: projectCatalog,
      createSessionTools: () => ({ tools: tools(), close: async () => {} }),
      registerBeforeClose: (_session: ProjectSession<unknown>, hook: () => Promise<void>) =>
        root.setBeforeCoreClose(hook),
    });
    const active = facade.playground.define(vitePlan());
    const inactive = facade.playground.define(vitePlan({ id: 'inactive-project' }));
    const forgedAtRoot = projects.vite({
      id: 'vite-project',
      files: { '/index.html': '<main>forged at root</main>' },
    });

    expect(facade.playground.catalog).toBe(projectCatalog);
    await expect(facade.openProject(forgedAtRoot)).rejects.toThrow(TypeError);
    await expect(facade.openProject(inactive)).rejects.toThrow();
    expect(root.ownerOpen).not.toHaveBeenCalled();

    const session = await facade.openProject(active);
    await session.close();
    await facade.deleteProject('vite-project');
    expect(projectCatalog.delete).toHaveBeenCalledTimes(1);
    expect(projectCatalog.delete).toHaveBeenCalledWith('vite-project');
    expect(root.ownerDelete).not.toHaveBeenCalled();
    await facade.close();
  });

  it('accepts only an exact live session, memoizes frozen tools and keeps one owner', async () => {
    const firstRoot = await createRootHarness();
    const secondRoot = await createRootHarness();
    const firstCreateTools = vi.fn((_session: ProjectSession<unknown>) => ({
      tools: tools(),
      close: async () => {},
    }));
    const secondCreateTools = vi.fn(() => ({ tools: tools(), close: async () => {} }));
    const first = createPlaygroundWorkbenchFacade({
      workbench: firstRoot.workbench,
      urlContext: CAPTURED_URL_CONTEXT,
      definePlan,
      catalog: catalog(),
      createSessionTools: firstCreateTools,
      registerBeforeClose: (_session: ProjectSession<unknown>, hook: () => Promise<void>) =>
        firstRoot.setBeforeCoreClose(hook),
    });
    const second = createPlaygroundWorkbenchFacade({
      workbench: secondRoot.workbench,
      urlContext: CAPTURED_URL_CONTEXT,
      definePlan,
      catalog: catalog('second-project'),
      createSessionTools: secondCreateTools,
      registerBeforeClose: (_session: ProjectSession<unknown>, hook: () => Promise<void>) =>
        secondRoot.setBeforeCoreClose(hook),
    });
    const firstSession = await first.openProject(first.playground.define(vitePlan()));
    const secondSession = await second.openProject(
      second.playground.define(vitePlan({ id: 'second-project' })),
    );
    const firstTools = first.playground.forSession(firstSession);

    expect(first.playground.forSession(firstSession)).toBe(firstTools);
    expect(Object.isFrozen(firstTools)).toBe(true);
    expect(Object.keys(firstTools).sort()).toEqual(['archive', 'previews', 'scm', 'typescript']);
    expect(Object.keys(firstTools.scm).sort()).toEqual([
      'commit',
      'diff',
      'discard',
      'refresh',
      'snapshot',
      'stage',
      'subscribe',
      'unstage',
    ]);
    expect(Object.keys(firstTools.archive).sort()).toEqual(['export', 'import']);
    for (const handle of [
      firstTools,
      firstTools.typescript,
      firstTools.scm,
      firstTools.archive,
      firstTools.previews,
    ]) {
      expect(handle).not.toHaveProperty('dispose');
    }
    for (const handle of [firstTools, firstTools.scm, firstTools.archive, firstTools.previews]) {
      expect(handle).not.toHaveProperty('close');
    }
    expect(firstTools.typescript.close).toEqual(expect.any(Function));
    expect(firstCreateTools).toHaveBeenCalledTimes(1);
    expect(firstCreateTools).toHaveBeenCalledWith(firstRoot.ownerSessions[0]);
    expect(firstCreateTools).not.toHaveBeenCalledWith(firstSession);
    expect(firstRoot.ownerStart).toHaveBeenCalledTimes(1);
    expect(firstRoot.ownerOpen).toHaveBeenCalledTimes(1);
    expect(() => first.playground.forSession(secondSession)).toThrow(TypeError);
    expect(() =>
      first.playground.forSession({ ...firstSession } as ProjectSession<unknown>),
    ).toThrow(TypeError);

    await firstSession.close();
    expect(() => first.playground.forSession(firstSession)).toThrowError(/ClosedHandleError/);
    await secondSession.close();
    await first.close();
    await second.close();
    expect(firstRoot.ownerClose).toHaveBeenCalledTimes(1);
    expect(secondRoot.ownerClose).toHaveBeenCalledTimes(1);
  });

  it('runs dirty preflight, stops new tool calls, and drains admitted work before core teardown', async () => {
    const root = await createRootHarness();
    const admittedGate = deferred<void>();
    const lifecycle = admittedArchiveTools(root.events, admittedGate);
    const facade = createPlaygroundWorkbenchFacade({
      workbench: root.workbench,
      urlContext: CAPTURED_URL_CONTEXT,
      definePlan,
      catalog: catalog(),
      createSessionTools: () => lifecycle,
      registerBeforeClose: (_session: ProjectSession<unknown>, hook: () => Promise<void>) =>
        root.setBeforeCoreClose(hook),
    });
    const session = await facade.openProject(facade.playground.define(vitePlan()));
    const sessionTools = facade.playground.forSession(session);
    const document = await session.documents.open('/src/main.ts');
    document.replace('dirty');

    await expect(session.close()).rejects.toBeInstanceOf(DirtyProjectDocumentError);
    expect(lifecycle.close).not.toHaveBeenCalled();
    expect(facade.playground.forSession(session)).toBe(sessionTools);

    await document.close({ dirty: 'discard' });
    const admittedExport = sessionTools.archive.export();
    expect(root.events).toEqual(['tools:archive:start']);
    const closing = session.close();
    expect(() => facade.playground.forSession(session)).toThrowError(/ClosedHandleError/);
    await expect(sessionTools.archive.export()).rejects.toBeInstanceOf(ClosedHandleError);
    await Promise.resolve();
    expect(lifecycle.close).toHaveBeenCalledTimes(1);
    expect(root.events).toEqual(['tools:archive:start', 'tools:close']);
    expect(root.events.some((event) => event.startsWith('core:'))).toBe(false);
    let settled = false;
    void closing.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    admittedGate.resolve(undefined);
    await expect(admittedExport).resolves.toBe(
      JSON.stringify({ version: 1, root: '/', files: [] }),
    );
    await closing;
    const toolEnd = root.events.indexOf('tools:archive:end');
    const firstCore = root.events.findIndex((event) => event.startsWith('core:'));
    expect(toolEnd).toBeGreaterThan(root.events.indexOf('tools:close'));
    expect(firstCore).toBeGreaterThan(toolEnd);
    expect(root.events).toEqual(
      expect.arrayContaining(['core:terminal', 'core:runtime', 'core:project-transport']),
    );
    await facade.close();
  });

  it('aggregates tool and core close failures while still attempting every teardown layer', async () => {
    const root = await createRootHarness();
    const toolFailure = new Error('archive drain failed');
    const coreFailure = new Error('runtime close failed');
    root.failCoreRuntimeWith(coreFailure);
    const closeTools = vi.fn(async () => {
      root.events.push('tools:close');
      throw toolFailure;
    });
    const facade = createPlaygroundWorkbenchFacade({
      workbench: root.workbench,
      urlContext: CAPTURED_URL_CONTEXT,
      definePlan,
      catalog: catalog(),
      createSessionTools: () => ({ tools: tools(), close: closeTools }),
      registerBeforeClose: (_session: ProjectSession<unknown>, hook: () => Promise<void>) =>
        root.setBeforeCoreClose(hook),
    });
    const session = await facade.openProject(facade.playground.define(vitePlan()));
    facade.playground.forSession(session);

    const failure = await session.close().then(
      () => null,
      (error: unknown) => error,
    );

    if (!(failure instanceof AggregateError)) {
      throw new Error('Session close did not aggregate tool and core failures');
    }
    expect(failure.errors).toEqual(expect.arrayContaining([toolFailure, coreFailure]));
    expect(closeTools).toHaveBeenCalledTimes(1);
    expect(root.events[0]).toBe('tools:close');
    expect(root.events).toEqual(
      expect.arrayContaining(['core:terminal', 'core:runtime', 'core:project-transport']),
    );
    expect(root.ownerClose).not.toHaveBeenCalled();

    await facade.close().catch(() => {});
    expect(root.ownerClose).toHaveBeenCalledTimes(1);
  });
});
