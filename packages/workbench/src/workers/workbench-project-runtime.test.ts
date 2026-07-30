import {
  type WorkerSpawnSpec,
  getKernelWorkerUrl,
  globalProcessManager,
  setKernelWorkerUrl,
} from '@riftydev/kernel';
import { finalizeWorkerEntry } from '@riftydev/kernel/worker-entry';
import {
  type InstallOptions,
  type InstallResult,
  RegistryClient,
  install as installPackages,
} from '@riftydev/npm-client';
import { NODE_PROCESS_IDENTITY } from '@riftydev/runtime-js';
import {
  NODE_ENTRY_BOOTSTRAP_PROTOCOL,
  type NodeEntryBootstrapPayload,
} from '@riftydev/runtime-js/builtins/node-entry-url';
import type { VfsMutationGuard } from '@riftydev/vfs';
import { createMemoryFs, resetSyncMirror, setSyncMirror } from '@riftydev/vfs/internal';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { InstallFn } from '../glue/npm-shell-command.ts';
import type { OwnerToPageFrame } from '../glue/pty-protocol.ts';
import { SyncMirrorVfs } from '../glue/sync-mirror-vfs.ts';
import { createNoShadowInstallResultFixture } from './install-result.test-fixture.ts';
import {
  type OwnerPackageConfig,
  type OwnerPackageMutationKind,
  type OwnerPackageState,
  createOwnerPackageState,
} from './owner-package-state.ts';
import {
  type OwnerVfsAuthority,
  createOwnerVfsAuthorityComposition,
} from './owner-vfs-authority.ts';
import {
  type WorkbenchProjectRuntime,
  createWorkbenchProjectRuntime,
} from './workbench-project-runtime.ts';

// Existing kernel test-only reset is not a package API. Keep this test access
// runtime-only so Workbench's production TypeScript graph stays package-bound.
const KERNEL_SPAWN_WORKER_TEST_MODULE = '../../../kernel/src/spawn-worker.ts';
const kernelSpawnWorkerTestModule: unknown = await import(KERNEL_SPAWN_WORKER_TEST_MODULE);
if (typeof kernelSpawnWorkerTestModule !== 'object' || kernelSpawnWorkerTestModule === null) {
  throw new TypeError('kernel spawn-worker test module is unavailable');
}
const clearKernelWorkerUrlCandidate: unknown = Reflect.get(
  kernelSpawnWorkerTestModule,
  'clearKernelWorkerUrl',
);
if (typeof clearKernelWorkerUrlCandidate !== 'function') {
  throw new TypeError('kernel clearKernelWorkerUrl test seam is unavailable');
}
const clearKernelWorkerUrl = (): void => {
  Reflect.apply(clearKernelWorkerUrlCandidate, undefined, []);
};

const ROOT = '/.rifty/workbench/v1/projects/project-a/tree';
const NODE_ENTRY_WORKER_URL = 'https://example.test/node-entry.js';
const DEV_SERVER_WORKER_URL = 'https://example.test/dev-server.js';
const NODE_WORKER_RUNTIME_ENV = Object.freeze({
  RIFTY_KERNEL_WORKER_URL: 'https://example.test/kernel.js',
  RIFTY_NODE_ENTRY_WORKER_URL: NODE_ENTRY_WORKER_URL,
  RIFTY_SQLITE_WASM_URL: 'https://example.test/sqlite.wasm',
});
const NODE_WORKER_RUNTIME_CONFIG = Object.freeze({
  kernelWorkerUrl: NODE_WORKER_RUNTIME_ENV.RIFTY_KERNEL_WORKER_URL,
  nodeEntryWorkerUrl: NODE_WORKER_RUNTIME_ENV.RIFTY_NODE_ENTRY_WORKER_URL,
  sqliteWasmUrl: NODE_WORKER_RUNTIME_ENV.RIFTY_SQLITE_WASM_URL,
});
const TERMINATOR_ADMISSION_SOURCE = 'JSON.stringify({marker:"terminator"})';
const TERMINATED_SEPARATED_EVAL_SPELLINGS = [
  {
    option: '-e',
    print: false,
    sourceRequired: true,
    missing: 'node: -e requires an argument\n',
  },
  {
    option: '--eval',
    print: false,
    sourceRequired: true,
    missing: 'node: --eval requires an argument\n',
  },
  {
    option: '-pe',
    print: true,
    sourceRequired: true,
    missing: 'node: --eval requires an argument\n',
  },
  { option: '-p', print: true, sourceRequired: false, missing: '' },
  { option: '--print', print: true, sourceRequired: false, missing: '' },
  { option: '--print=ignored', print: true, sourceRequired: false, missing: '' },
  { option: '--print=not-the-source', print: true, sourceRequired: false, missing: '' },
  { option: '--print=', print: true, sourceRequired: false, missing: '' },
] as const;
const TERMINATED_EVAL_SOURCE_STATES = ['missing', 'empty', 'nonempty'] as const;

type TerminatedEvalAdmissionCase =
  | {
      readonly outcome: 'usageError';
      readonly label: string;
      readonly line: string;
      readonly stderr: string;
    }
  | {
      readonly outcome: 'eval';
      readonly label: string;
      readonly line: string;
      readonly source: string;
      readonly print: boolean;
      readonly execArgv: readonly string[];
      readonly scriptArgs: readonly string[];
    };

function buildTerminatedEvalAdmissionCases(): readonly TerminatedEvalAdmissionCase[] {
  return TERMINATED_SEPARATED_EVAL_SPELLINGS.flatMap((spelling) =>
    TERMINATED_EVAL_SOURCE_STATES.map((sourceState): TerminatedEvalAdmissionCase => {
      const source =
        sourceState === 'missing'
          ? undefined
          : sourceState === 'empty'
            ? ''
            : TERMINATOR_ADMISSION_SOURCE;
      const line =
        source === undefined
          ? `node ${spelling.option} --`
          : `node ${spelling.option} '${source}' -- x`;
      const label = `${spelling.option} / ${sourceState}`;

      if (source === undefined && spelling.sourceRequired) {
        return {
          outcome: 'usageError',
          label,
          line,
          stderr: spelling.missing,
        };
      }
      if (source === undefined) {
        return {
          outcome: 'eval',
          label,
          line,
          source: '',
          print: spelling.print,
          execArgv: [spelling.option],
          scriptArgs: [],
        };
      }
      if (source === '' && !spelling.sourceRequired) {
        return {
          outcome: 'eval',
          label,
          line,
          source,
          print: spelling.print,
          execArgv: [spelling.option],
          scriptArgs: ['', '--', 'x'],
        };
      }
      return {
        outcome: 'eval',
        label,
        line,
        source,
        print: spelling.print,
        execArgv: [spelling.option, source],
        scriptArgs: ['x'],
      };
    }),
  );
}

type TerminatedEvalUsageErrorCase = Extract<
  TerminatedEvalAdmissionCase,
  { readonly outcome: 'usageError' }
>;
type TerminatedEvalChildCase = Extract<TerminatedEvalAdmissionCase, { readonly outcome: 'eval' }>;

const TERMINATED_EVAL_ADMISSION_CASES = buildTerminatedEvalAdmissionCases();
const TERMINATED_EVAL_USAGE_ERROR_CASES = TERMINATED_EVAL_ADMISSION_CASES.filter(
  (testCase): testCase is TerminatedEvalUsageErrorCase => testCase.outcome === 'usageError',
);
const TERMINATED_EVAL_CHILD_CASES: readonly TerminatedEvalChildCase[] = [
  ...TERMINATED_EVAL_ADMISSION_CASES.filter(
    (testCase): testCase is TerminatedEvalChildCase => testCase.outcome === 'eval',
  ),
  {
    outcome: 'eval',
    label: '--eval= / nonempty',
    line: `node --eval='${TERMINATOR_ADMISSION_SOURCE}' -- x`,
    source: TERMINATOR_ADMISSION_SOURCE,
    print: false,
    execArgv: [`--eval=${TERMINATOR_ADMISSION_SOURCE}`],
    scriptArgs: ['x'],
  },
];
const PACKAGE_JSON = `${JSON.stringify({
  name: 'workbench-project-a',
  version: '1.0.0',
  scripts: { where: 'pwd', dev: 'vite' },
  devDependencies: { vite: '8.0.16' },
})}\n`;

const bootstrapConfig: OwnerPackageConfig['cfg'] = {
  runtime: 'vite',
  root: ROOT,
  port: 5173,
  entryPath: `${ROOT}/src/main.js`,
  packageName: 'workbench-project-a',
  packageVersion: '1.0.0',
  installDeps: { vite: '8.0.16' },
  packageJson: PACKAGE_JSON,
  seedFiles: {},
};

const packageConfig: OwnerPackageConfig = {
  cfg: bootstrapConfig,
  templateId: 'workbench-vite',
  slug: 'project-a',
  fromScratch: true,
};

const NODE_SERVER_PACKAGE_JSON = `${JSON.stringify({
  name: 'workbench-node-server',
  version: '1.0.0',
  type: 'module',
  scripts: { dev: 'node src/server.mjs' },
})}\n`;
const nodeServerPackageConfig: OwnerPackageConfig = {
  cfg: {
    runtime: 'node-server',
    root: ROOT,
    port: 4317,
    entryPath: `${ROOT}/src/server.mjs`,
    packageName: 'workbench-node-server',
    packageVersion: '1.0.0',
    installDeps: {},
    packageJson: NODE_SERVER_PACKAGE_JSON,
    seedFiles: {},
  },
  templateId: 'workbench-node-server',
  slug: 'project-a',
  fromScratch: true,
};
const matchingLifecycleNodeServerPackageConfig: OwnerPackageConfig = {
  ...nodeServerPackageConfig,
  cfg: {
    ...nodeServerPackageConfig.cfg,
    packageJson: `${JSON.stringify({
      name: 'workbench-node-server',
      version: '1.0.0',
      type: 'module',
      scripts: {
        predev: 'node src/server.mjs',
        dev: 'node src/server.mjs',
        postdev: 'node src/server.mjs',
      },
    })}\n`,
  },
};
const NODEMON_DEV = 'nodemon --legacy-watch --no-stdin --no-update-notifier src/server.mjs';
const nodemonNodeServerPackageConfig: OwnerPackageConfig = {
  cfg: {
    ...nodeServerPackageConfig.cfg,
    installDeps: { nodemon: '3.1.14' },
    packageJson: `${JSON.stringify({
      name: 'workbench-node-server',
      version: '1.0.0',
      type: 'module',
      scripts: { dev: NODEMON_DEV, start: 'node src/server.mjs' },
      dependencies: { nodemon: '3.1.14' },
    })}\n`,
  },
  templateId: 'workbench-node-server',
  slug: 'project-a',
  fromScratch: true,
};
const missingNodemonNodeServerPackageConfig: OwnerPackageConfig = {
  ...nodemonNodeServerPackageConfig,
  cfg: {
    ...nodemonNodeServerPackageConfig.cfg,
    installDeps: {},
  },
};

const NODE_CLI_PACKAGE_JSON = `${JSON.stringify({
  name: 'workbench-node-cli',
  version: '1.0.0',
  type: 'module',
})}\n`;
const nodeCliPackageConfig: OwnerPackageConfig = {
  cfg: {
    runtime: 'node-cli',
    root: ROOT,
    entryPath: `${ROOT}/src/cli.mjs`,
    packageName: 'workbench-node-cli',
    packageVersion: '1.0.0',
    installDeps: {},
    packageJson: NODE_CLI_PACKAGE_JSON,
    seedFiles: {},
  },
  templateId: 'workbench-node-cli',
  slug: 'project-a',
  fromScratch: true,
};

function preparedTreeInstall(config: OwnerPackageConfig): InstallFn {
  return async (
    arg1: string | InstallOptions,
    _rootVersion?: string,
    dependenciesOrOpts?: Record<string, string> | InstallOptions,
    explicitOpts?: InstallOptions,
  ): Promise<InstallResult> => {
    const options: InstallOptions | undefined =
      typeof arg1 === 'object'
        ? arg1
        : (explicitOpts ??
          (dependenciesOrOpts !== undefined &&
          'vfs' in dependenciesOrOpts &&
          typeof dependenciesOrOpts.vfs !== 'string'
            ? (dependenciesOrOpts as InstallOptions)
            : undefined));
    if (options === undefined) throw new Error('test install options missing');

    await options.vfs.mkdir(`${options.cwd}/node_modules`, { recursive: true });
    const nodemonVersion = config.cfg.installDeps.nodemon;
    if (config.cfg.runtime === 'vite') {
      await options.vfs.mkdir(`${options.cwd}/node_modules/.bin`, { recursive: true });
      await options.vfs.writeFile(`${options.cwd}/node_modules/.bin/vite`, '#!/usr/bin/env node\n');
    }
    if (nodemonVersion !== undefined) {
      await options.vfs.mkdir(`${options.cwd}/node_modules/.bin`, { recursive: true });
      await options.vfs.writeFile(
        `${options.cwd}/node_modules/.bin/nodemon`,
        '#!/usr/bin/env node\n',
      );
    }
    const viteVersion = config.cfg.installDeps.vite;
    const lockfilePackages: InstallResult['lockfile']['packages'] = {
      ...(viteVersion === undefined ? {} : { 'node_modules/vite': { version: viteVersion } }),
      ...(nodemonVersion === undefined
        ? {}
        : { 'node_modules/nodemon': { version: nodemonVersion } }),
    };
    const lockfile = {
      name: config.cfg.packageName,
      version: config.cfg.packageVersion,
      lockfileVersion: 3 as const,
      requires: true as const,
      packages: lockfilePackages,
    };
    await options.vfs.writeFile(
      `${options.cwd}/package-lock.json`,
      `${JSON.stringify(lockfile)}\n`,
    );
    const result: InstallResult = {
      packages: [
        ...(viteVersion === undefined
          ? []
          : [{ name: 'vite', version: viteVersion, dependencies: {}, files: {} }]),
        ...(nodemonVersion === undefined
          ? []
          : [{ name: 'nodemon', version: nodemonVersion, dependencies: {}, files: {} }]),
      ],
      lockfile,
      conflicts: [],
      provenance: {
        resolution: 'metadata',
        packages: [
          ...(viteVersion === undefined
            ? []
            : [{ name: 'vite', version: viteVersion, transport: 'registry' as const }]),
          ...(nodemonVersion === undefined
            ? []
            : [{ name: 'nodemon', version: nodemonVersion, transport: 'registry' as const }]),
        ],
      },
    };
    return await createNoShadowInstallResultFixture(result);
  };
}

interface BoundaryWorker {
  readonly handle: ReturnType<typeof globalProcessManager.spawnWorker>;
  readonly command: () => Parameters<typeof globalProcessManager.spawnWorker>[0] | null;
  readonly spec: () => Parameters<typeof globalProcessManager.spawnWorker>[1] | null;
  readonly killedWith: () => string | null;
  emitMessage(message: unknown): void;
  emitListening(control: { pid: number; ports: number[]; previewScope?: string }): void;
  emitPeerError(error: Error): void;
  emitExit(code: number | null, signal?: string | null): void;
}

type KernelWorkerListener = (event: MessageEvent) => void;

class KernelWorkerBoundary {
  readonly posted: unknown[] = [];
  readonly terminate = vi.fn();
  readonly #listeners = new Map<string, Set<KernelWorkerListener>>();

  postMessage(message: unknown): void {
    this.posted.push(message);
  }

  addEventListener(type: string, listener: KernelWorkerListener): void {
    const listeners = this.#listeners.get(type) ?? new Set<KernelWorkerListener>();
    listeners.add(listener);
    this.#listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: KernelWorkerListener): void {
    this.#listeners.get(type)?.delete(listener);
  }

  spec(): WorkerSpawnSpec {
    const init = this.posted[0] as { readonly type?: unknown; readonly spec?: unknown } | undefined;
    if (init?.type !== 'init' || init.spec === undefined) {
      throw new Error('kernel Worker boundary did not receive one init spec');
    }
    return init.spec as WorkerSpawnSpec;
  }

  finish(code: number): void {
    const spec = this.spec();
    finalizeWorkerEntry(
      {
        postMessage: (message) => {
          const event = new MessageEvent('message', { data: message });
          for (const listener of [...(this.#listeners.get('message') ?? [])]) listener(event);
        },
        close() {},
      },
      spec,
      // A node-entry foreground child exits through process.exit after its
      // lifecycle owner drains; that trusted throw reaches this exact kernel
      // finalizer path even for code 0.
      { threw: true, code },
    );
  }
}

const restoreRealKernelBoundaries: Array<() => void> = [];

function restoreKernelWorkerUrl(url: string | URL | null): void {
  if (url === null) clearKernelWorkerUrl();
  else setKernelWorkerUrl(url);
}

function restoreInstalledRealKernelBoundaries(): void {
  for (;;) {
    const restore = restoreRealKernelBoundaries.pop();
    if (restore === undefined) return;
    restore();
  }
}

function installRealKernelWorkerBoundary(): readonly KernelWorkerBoundary[] {
  const originalWorkerDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'Worker');
  const originalKernelWorkerUrl = getKernelWorkerUrl();
  const workers: KernelWorkerBoundary[] = [];
  class RecordingKernelWorker extends KernelWorkerBoundary {
    constructor() {
      super();
      workers.push(this);
    }
  }
  Object.defineProperty(globalThis, 'Worker', {
    value: RecordingKernelWorker,
    configurable: true,
    writable: true,
  });
  setKernelWorkerUrl(NODE_WORKER_RUNTIME_ENV.RIFTY_KERNEL_WORKER_URL);
  let restored = false;
  restoreRealKernelBoundaries.push(() => {
    if (restored) return;
    restored = true;
    for (const worker of workers.splice(0)) {
      const pid = worker.spec().pid;
      if (globalProcessManager.get(pid) !== null) globalProcessManager.kill(pid);
    }
    if (originalWorkerDescriptor === undefined) Reflect.deleteProperty(globalThis, 'Worker');
    else Object.defineProperty(globalThis, 'Worker', originalWorkerDescriptor);
    restoreKernelWorkerUrl(originalKernelWorkerUrl);
  });
  return workers;
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function settledOr<T, TPending>(promise: Promise<T>, pending: TPending): Promise<T | TPending> {
  return Promise.race([
    promise,
    new Promise<TPending>((resolve) => setTimeout(resolve, 30, pending)),
  ]);
}

function boundaryWorker(): BoundaryWorker {
  let capturedCommand: Parameters<typeof globalProcessManager.spawnWorker>[0] | null = null;
  let capturedSpec: Parameters<typeof globalProcessManager.spawnWorker>[1] | null = null;
  let killedWith: string | null = null;
  const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
  const stdinListeners = new Map<string, Array<(...args: unknown[]) => void>>();
  const writer = {
    write(_chunk: unknown, callback?: (error?: Error | null) => void) {
      callback?.();
      return true;
    },
    end() {
      queueMicrotask(() => {
        for (const listener of stdinListeners.get('finish') ?? []) listener();
      });
      return writer;
    },
    once(event: string, listener: (...args: unknown[]) => void) {
      const wrapped = (...args: unknown[]): void => {
        writer.removeListener(event, wrapped);
        listener(...args);
      };
      const current = stdinListeners.get(event) ?? [];
      current.push(wrapped);
      stdinListeners.set(event, current);
      return writer;
    },
    removeListener(event: string, listener: (...args: unknown[]) => void) {
      const current = stdinListeners.get(event) ?? [];
      stdinListeners.set(
        event,
        current.filter((candidate) => candidate !== listener),
      );
      return writer;
    },
  };
  const control = new MessageChannel();
  const rawHandle = {
    kind: 'worker' as const,
    pid: 101,
    ppid: 1,
    command: 'vite',
    cwd: ROOT,
    exitCode: null,
    signalCode: null,
    ports: { ipc: control.port1 },
    stdout: () => ({ on: () => undefined }),
    stderr: () => ({ on: () => undefined }),
    stdin: () => writer,
    on(event: string, listener: (...args: unknown[]) => void) {
      const current = listeners.get(event) ?? [];
      current.push(listener);
      listeners.set(event, current);
      return rawHandle;
    },
    off(event: string, listener: (...args: unknown[]) => void) {
      listeners.set(
        event,
        (listeners.get(event) ?? []).filter((candidate) => candidate !== listener),
      );
      return rawHandle;
    },
    onListeningControl(listener: (...args: unknown[]) => void) {
      const current = listeners.get('control:listening') ?? [];
      current.push(listener);
      listeners.set('control:listening', current);
      return () => {};
    },
    send: () => true,
    resize: () => true,
    kill(signal = 'SIGTERM') {
      killedWith = signal;
      control.port1.close();
      control.port2.close();
      return true;
    },
    disconnect: () => undefined,
    setCwd: () => undefined,
  };
  const handle = rawHandle as unknown as ReturnType<typeof globalProcessManager.spawnWorker>;
  vi.spyOn(globalProcessManager, 'spawnWorker').mockImplementation((command, spec) => {
    capturedCommand = command;
    capturedSpec = spec;
    return handle;
  });
  return {
    handle,
    command: () => capturedCommand,
    spec: () => capturedSpec,
    killedWith: () => killedWith,
    emitMessage(message) {
      for (const listener of listeners.get('message') ?? []) listener(message);
    },
    emitListening(control) {
      for (const listener of listeners.get('control:listening') ?? []) listener(control);
    },
    emitPeerError(error) {
      control.port1.close();
      control.port2.close();
      for (const listener of listeners.get('peererror') ?? []) listener(error);
    },
    emitExit(code, signal = null) {
      control.port1.close();
      control.port2.close();
      for (const listener of listeners.get('exit') ?? []) listener(code, signal);
    },
  };
}

function snapshotProjectTree(
  authority: OwnerVfsAuthority,
): Readonly<Record<string, readonly number[]>> {
  const files: Record<string, readonly number[]> = {};
  const walk = (directory: string): void => {
    for (const entry of authority.readdirSync(directory)) {
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory) walk(path);
      else files[path.slice(ROOT.length)] = [...authority.readFileBytesSync(path)];
    }
  };
  walk(ROOT);
  return Object.fromEntries(
    Object.entries(files).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)),
  );
}

async function harness(
  onSend?: (frame: OwnerToPageFrame, runtime: () => WorkbenchProjectRuntime) => void,
  activePackageConfig: OwnerPackageConfig = packageConfig,
  publicationBarrier: () => Promise<void> = async () => {},
  recordMutation?: (kind: OwnerPackageMutationKind, treeRevision: number) => Promise<void>,
  reservationEvidence?: {
    readonly events: string[];
    readonly paths?: string[];
    ready?: unknown;
  },
  packageAcquisition?: {
    readonly registry?: RegistryClient;
    readonly install?: InstallFn;
  },
) {
  const pair = createMemoryFs();
  const { authority, installStampClaims } = createOwnerVfsAuthorityComposition(pair.fsSync, {
    ownerEpoch: 'workbench-project-runtime-test',
    initialRoots: ['/'],
  });
  setSyncMirror(authority, { async: pair.vfs });
  authority.mkdirSync(`${ROOT}/src`, { recursive: true });
  authority.mkdirSync(`${ROOT}/node_modules/.bin`, { recursive: true });
  authority.writeFileSync(
    `${ROOT}/package.json`,
    new TextEncoder().encode(activePackageConfig.cfg.packageJson),
  );
  authority.writeFileSync(
    activePackageConfig.cfg.entryPath,
    new TextEncoder().encode('export {};\n'),
  );
  authority.writeFileSync(
    `${ROOT}/node_modules/.bin/vite`,
    new TextEncoder().encode('#!/usr/bin/env node\n'),
  );
  const nodeWorkerRuntimeEnv =
    activePackageConfig.cfg.runtime === 'vite'
      ? { RIFTY_KERNEL_WORKER_URL: NODE_WORKER_RUNTIME_ENV.RIFTY_KERNEL_WORKER_URL }
      : NODE_WORKER_RUNTIME_ENV;
  const packageState = createOwnerPackageState({
    initial: activePackageConfig,
    vfs: new SyncMirrorVfs(),
    fsSync: authority,
    installStampClaims,
    flush: () => authority.flush(),
    nodeWorkerRuntimeEnv,
    log: () => {},
    registry:
      packageAcquisition?.registry ??
      new RegistryClient({
        baseUrl: 'https://example.test/registry',
        fetch: async () => new Response('', { status: 599 }),
      }),
    install: packageAcquisition?.install ?? preparedTreeInstall(activePackageConfig),
    resolverUrl: () => undefined,
    resolverBundleBaseUrl: () => undefined,
    resolverPin: () => undefined,
  });
  await packageState.activateAndEnsure(activePackageConfig);
  const runtimePackageState: OwnerPackageState =
    reservationEvidence === undefined
      ? packageState
      : {
          ...packageState,
          reserveChildAdmission: async (root) => {
            reservationEvidence.paths?.push(root);
            const reservation = await packageState.reserveChildAdmission(root);
            reservationEvidence.ready = reservation.snapshot.ready;
            const snapshot = reservation.snapshot;
            return Object.freeze({
              ...reservation,
              snapshot: Object.freeze({
                ...snapshot,
                dispose() {
                  reservationEvidence.events.push('dispose');
                  snapshot.dispose();
                },
              }),
              commit() {
                reservationEvidence.events.push('commit');
                reservation.commit();
              },
            });
          },
        };
  const frames: OwnerToPageFrame[] = [];
  const runtimeRef: { current?: WorkbenchProjectRuntime } = {};
  const mutationGuard: VfsMutationGuard = (intents, apply) =>
    packageState.mutations.guardedMutation(intents, async () => {
      try {
        return await apply();
      } finally {
        await publicationBarrier();
      }
    });
  const runtimeOptions = {
    projectRoot: ROOT,
    packageConfig: activePackageConfig,
    authority,
    packageState: runtimePackageState,
    nodeEntryWorkerUrl: NODE_ENTRY_WORKER_URL,
    devServerWorkerUrl: DEV_SERVER_WORKER_URL,
    nodeWorkerRuntimeEnv,
    mutationGuard,
    publicationBarrier,
    ...(recordMutation === undefined ? {} : { recordMutation }),
    send: (frame: OwnerToPageFrame) => {
      frames.push(frame);
      onSend?.(frame, () => {
        const current = runtimeRef.current;
        if (current === undefined) throw new Error('runtime callback fired during construction');
        return current;
      });
    },
  };
  const runtime = createWorkbenchProjectRuntime(runtimeOptions);
  runtimeRef.current = runtime;
  return { authority, frames, packageState: runtimePackageState, runtime };
}

afterEach(() => {
  restoreInstalledRealKernelBoundaries();
  vi.restoreAllMocks();
  resetSyncMirror();
});

describe('Workbench finite Node owner lifecycle Contract+RED', () => {
  it.each([null, 'https://host.test/original-kernel-worker.js'] as const)(
    'restores exact Worker and kernel URL globals after a real boundary with prior URL %s',
    (priorKernelWorkerUrl) => {
      const ambientWorkerDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'Worker');
      const ambientKernelWorkerUrl = getKernelWorkerUrl();
      class PriorWorker {}
      Object.defineProperty(globalThis, 'Worker', {
        value: PriorWorker,
        configurable: true,
        writable: false,
        enumerable: true,
      });
      restoreKernelWorkerUrl(priorKernelWorkerUrl);
      const priorWorkerDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'Worker');

      try {
        const workers = installRealKernelWorkerBoundary();
        expect(workers).toEqual([]);
        expect(getKernelWorkerUrl()).toBe(NODE_WORKER_RUNTIME_ENV.RIFTY_KERNEL_WORKER_URL);
        expect(Object.getOwnPropertyDescriptor(globalThis, 'Worker')).not.toEqual(
          priorWorkerDescriptor,
        );

        restoreInstalledRealKernelBoundaries();

        expect(workers).toEqual([]);
        expect(getKernelWorkerUrl()).toBe(priorKernelWorkerUrl);
        expect(Object.getOwnPropertyDescriptor(globalThis, 'Worker')).toEqual(
          priorWorkerDescriptor,
        );
      } finally {
        restoreInstalledRealKernelBoundaries();
        if (ambientWorkerDescriptor === undefined) Reflect.deleteProperty(globalThis, 'Worker');
        else Object.defineProperty(globalThis, 'Worker', ambientWorkerDescriptor);
        restoreKernelWorkerUrl(ambientKernelWorkerUrl);
      }
    },
  );

  it('reports nodemon Worker peer death as a PTY lifecycle error, not a fabricated command exit', async () => {
    const worker = boundaryWorker();
    const h = await harness(undefined, nodemonNodeServerPackageConfig);
    h.runtime.handlePtyFrame({ type: 'pty:open', sid: 'terminal-nodemon-peer-death' });

    const running = Promise.resolve(
      h.runtime.handlePtyFrame({
        type: 'pty:exec',
        sid: 'terminal-nodemon-peer-death',
        rid: 'run-nodemon-peer-death',
        line: 'npm run dev',
        cols: 80,
        rows: 24,
        isTTY: true,
      }),
    );
    await vi.waitFor(() => expect(worker.spec()).not.toBeNull());

    worker.emitPeerError(new Error(`Worker peer closed unexpectedly for ${ROOT}/src/server.mjs`));
    await running;

    expect(h.frames).toContainEqual(
      expect.objectContaining({
        type: 'pty:exit',
        rid: 'run-nodemon-peer-death',
        code: 1,
        error: 'Worker peer closed unexpectedly for /src/server.mjs',
      }),
    );
    const output = h.frames
      .filter(
        (frame): frame is Extract<OwnerToPageFrame, { type: 'pty:chunk' }> =>
          frame.type === 'pty:chunk' && frame.rid === 'run-nodemon-peer-death',
      )
      .map((frame) => new TextDecoder().decode(frame.data))
      .join('');
    expect(output).not.toContain('npm: Worker peer closed unexpectedly');
    await h.runtime.close();
  });

  it('selects the installed-bin path only for the exact nodemon dev script bytes', async () => {
    const worker = boundaryWorker();
    const h = await harness(undefined, nodemonNodeServerPackageConfig);
    h.runtime.handlePtyFrame({ type: 'pty:open', sid: 'terminal-nodemon' });

    const running = Promise.resolve(
      h.runtime.handlePtyFrame({
        type: 'pty:exec',
        sid: 'terminal-nodemon',
        rid: 'run-nodemon',
        line: 'npm run dev',
        cols: 80,
        rows: 24,
        isTTY: true,
      }),
    );
    await vi.waitFor(() => expect(worker.spec()).not.toBeNull());
    const command = worker.command();
    const spec = worker.spec();

    const close = Promise.resolve(
      h.runtime.handlePtyFrame({
        type: 'pty:close',
        sid: 'terminal-nodemon',
        opId: 'close-nodemon-session',
      }),
    );
    await vi.waitFor(() => expect(worker.killedWith()).toBe('SIGTERM'));
    expect(
      h.frames.some(
        (frame) => frame.type === 'pty:close-ack' && frame.opId === 'close-nodemon-session',
      ),
    ).toBe(false);
    worker.emitExit(null, 'SIGTERM');
    await Promise.all([running, close]);

    expect(command).toBe('/node_modules/.bin/nodemon');
    expect(spec).toMatchObject({
      env: {
        PORT: '4317',
      },
      argv: [
        'rifty',
        '/node_modules/.bin/nodemon',
        '--legacy-watch',
        '--no-stdin',
        '--no-update-notifier',
        'src/server.mjs',
      ],
      entry: {
        kind: 'url',
        url: NODE_ENTRY_WORKER_URL,
        bootstrap: {
          protocol: NODE_ENTRY_BOOTSTRAP_PROTOCOL,
          payload: {
            launch: {
              previewScope: expect.any(String),
            },
          },
        },
      },
    });
    expect(spec?.entry).not.toMatchObject({
      url: DEV_SERVER_WORKER_URL,
    });
    expect(h.frames).toContainEqual({
      type: 'pty:close-ack',
      sid: 'terminal-nodemon',
      opId: 'close-nodemon-session',
      ok: true,
    });
    expect(h.frames.filter((frame) => frame.type === 'pty:preview').at(-1)).toEqual({
      type: 'pty:preview',
      ports: [],
    });
    await h.runtime.close();
  });

  it('surfaces an unresolved nodemon launcher without a direct-node or dev-server fallback', async () => {
    const worker = boundaryWorker();
    const h = await harness(undefined, missingNodemonNodeServerPackageConfig);
    h.runtime.handlePtyFrame({ type: 'pty:open', sid: 'terminal-missing-nodemon' });

    const running = Promise.resolve(
      h.runtime.handlePtyFrame({
        type: 'pty:exec',
        sid: 'terminal-missing-nodemon',
        rid: 'run-missing-nodemon',
        line: 'npm run dev',
        cols: 80,
        rows: 24,
        isTTY: true,
      }),
    );
    if (
      (await settledOr(
        running.then(() => 'settled'),
        'pending',
      )) === 'pending'
    ) {
      await vi.waitFor(() => expect(worker.spec()).not.toBeNull());
      worker.emitExit(127);
      await running;
    }

    const output = h.frames
      .filter(
        (frame): frame is Extract<OwnerToPageFrame, { type: 'pty:chunk' }> =>
          frame.type === 'pty:chunk' && frame.rid === 'run-missing-nodemon',
      )
      .map((frame) => new TextDecoder().decode(frame.data))
      .join('');
    expect(worker.spec()).toBeNull();
    expect(output).toMatch(/nodemon.*(not found|missing|resolve)/iu);
    expect(output).not.toContain('[nodemon] starting');
    expect(h.frames).toContainEqual(
      expect.objectContaining({
        type: 'pty:exit',
        rid: 'run-missing-nodemon',
        code: 127,
      }),
    );
    await h.runtime.close();
  });

  it('runs node-server npm dev in its dedicated entry-scoped child with PTY provenance', async () => {
    const worker = boundaryWorker();
    const h = await harness(undefined, nodeServerPackageConfig);
    h.runtime.handlePtyFrame({
      type: 'pty:open',
      sid: 'terminal-node-server',
      env: {
        USER_FLAG: 'preserved',
        RIFTY_PREVIEW_SCOPE: 'guest-forged-scope',
        NAPI_RS_FORCE_WASI: 'guest-forged-wasi',
        PORT: '9999',
      },
    });

    const running = Promise.resolve(
      h.runtime.handlePtyFrame({
        type: 'pty:exec',
        sid: 'terminal-node-server',
        rid: 'run-node-server',
        line: 'npm run dev',
        cols: 101,
        rows: 41,
        isTTY: true,
      }),
    );
    await vi.waitFor(() => expect(worker.spec()).not.toBeNull());

    expect(worker.command()).toBe('dev-server');
    expect(worker.spec()).toMatchObject({
      cwd: '/',
      argv: ['rifty', '/src/server.mjs'],
      env: {
        USER_FLAG: 'preserved',
        RIFTY_PREVIEW_SCOPE: 'guest-forged-scope',
        NAPI_RS_FORCE_WASI: '1',
        PORT: '4317',
      },
      serve: true,
      entry: {
        kind: 'url',
        url: DEV_SERVER_WORKER_URL,
        bootstrap: {
          protocol: 'rifty.dev-server/v1',
          payload: {
            nodeWorkerRuntime: NODE_WORKER_RUNTIME_CONFIG,
            cfg: {
              ...nodeServerPackageConfig.cfg,
              root: '/',
              entryPath: '/src/server.mjs',
            },
            remoteFsRoot: ROOT,
            previewScope: expect.any(String),
            terminal: {
              stdinIsTTY: false,
              stdoutIsTTY: true,
              stderrIsTTY: true,
              cols: 101,
              rows: 41,
            },
          },
        },
      },
    });
    const entry = worker.spec()?.entry;
    if (entry?.kind !== 'url' || entry.bootstrap === undefined) {
      throw new Error('expected entry-scoped dev-server child bootstrap');
    }
    const payload = entry.bootstrap.payload as { readonly previewScope?: unknown };
    if (typeof payload.previewScope !== 'string') {
      throw new Error('expected owner-minted dev-server preview scope');
    }
    expect(payload.previewScope).not.toBe('guest-forged-scope');

    worker.emitMessage({
      type: 'rifty:dev-ready',
      port: 4317,
      previewScope: payload.previewScope,
    });
    await vi.waitFor(() =>
      expect(h.frames.filter((frame) => frame.type === 'pty:preview').at(-1)).toEqual({
        type: 'pty:preview',
        ports: [
          {
            port: 4317,
            url: '/preview/4317/',
            label: 'npm run dev',
            source: 'dev-server',
            sid: 'dev-server',
            ptySid: 'terminal-node-server',
            ptyRid: 'run-node-server',
            previewScope: payload.previewScope,
          },
        ],
      }),
    );
    expect(h.frames.filter((frame) => frame.type === 'pty:dev-server').at(-1)).toEqual({
      type: 'pty:dev-server',
      status: 'running',
      sid: 'terminal-node-server',
      cwd: ROOT,
      port: 4317,
      url: '/preview/4317/',
      previewScope: payload.previewScope,
    });

    h.runtime.handlePtyFrame({
      type: 'pty:signal',
      sid: 'terminal-node-server',
      rid: 'run-node-server',
      signal: 'SIGINT',
    });
    await vi.waitFor(() => expect(worker.killedWith()).toBe('SIGTERM'));
    worker.emitExit(null, 'SIGTERM');
    await running;
    expect(h.frames).toContainEqual({
      type: 'pty:exit',
      sid: 'terminal-node-server',
      rid: 'run-node-server',
      code: 130,
      exit: { code: null, signal: 'SIGTERM' },
      cwd: ROOT,
      env: {
        USER_FLAG: 'preserved',
        RIFTY_PREVIEW_SCOPE: 'guest-forged-scope',
        NAPI_RS_FORCE_WASI: 'guest-forged-wasi',
        PORT: '9999',
      },
    });
    await h.runtime.close();
  });

  it('intercepts only the dev lifecycle step when predev and postdev have identical bytes', async () => {
    const worker = boundaryWorker();
    const h = await harness(undefined, matchingLifecycleNodeServerPackageConfig);
    h.runtime.handlePtyFrame({ type: 'pty:open', sid: 'terminal-lifecycle-steps' });

    const running = Promise.resolve(
      h.runtime.handlePtyFrame({
        type: 'pty:exec',
        sid: 'terminal-lifecycle-steps',
        rid: 'run-lifecycle-steps',
        line: 'npm run dev',
        cols: 80,
        rows: 24,
        isTTY: true,
      }),
    );
    await vi.waitFor(() => expect(worker.command()).not.toBeNull());

    expect(worker.command()).toBe('node');
    worker.emitExit(0);
    await vi.waitFor(() => expect(worker.command()).toBe('dev-server'));
    const entry = worker.spec()?.entry;
    if (entry?.kind !== 'url' || entry.bootstrap === undefined) {
      throw new Error('expected entry-scoped dev-server child bootstrap');
    }
    const payload = entry.bootstrap.payload as { readonly previewScope?: unknown };
    if (typeof payload.previewScope !== 'string') {
      throw new Error('expected owner-minted dev-server preview scope');
    }
    worker.emitMessage({
      type: 'rifty:dev-ready',
      port: 4317,
      previewScope: payload.previewScope,
    });
    worker.emitExit(0);
    await vi.waitFor(() => expect(worker.command()).toBe('node'));
    worker.emitExit(0);
    await running;

    expect(h.frames).toContainEqual(
      expect.objectContaining({
        type: 'pty:exit',
        rid: 'run-lifecycle-steps',
        code: 0,
      }),
    );
    await h.runtime.close();
  });

  it('runs node-cli through a supervised node child with exact empty argv and physical exit', async () => {
    const workers = installRealKernelWorkerBoundary();
    const h = await harness(undefined, nodeCliPackageConfig);
    h.runtime.handlePtyFrame({
      type: 'pty:open',
      sid: 'terminal-node-cli',
      env: { USER_FLAG: 'preserved' },
    });

    const running = Promise.resolve(
      h.runtime.handlePtyFrame({
        type: 'pty:exec',
        sid: 'terminal-node-cli',
        rid: 'run-node-cli',
        line: "node src/cli.mjs '' 'two words'",
        cols: 93,
        rows: 35,
        isTTY: true,
      }),
    );
    await vi.waitFor(() => expect(workers).toHaveLength(1));
    const worker = workers[0];
    if (worker === undefined) throw new Error('expected one real kernel Worker boundary');
    const spec = worker.spec();

    expect(globalProcessManager.get(spec.pid)).toMatchObject({
      kind: 'worker',
      command: 'node',
      pid: spec.pid,
    });
    expect(spec).toMatchObject({
      cwd: '/',
      argv: ['rifty', '/src/cli.mjs', '', 'two words'],
      env: { USER_FLAG: 'preserved' },
      serve: true,
      entry: {
        kind: 'url',
        url: NODE_ENTRY_WORKER_URL,
        bootstrap: {
          protocol: NODE_ENTRY_BOOTSTRAP_PROTOCOL,
          payload: {
            hostRuntime: NODE_WORKER_RUNTIME_ENV,
            launch: {
              kind: 'program',
              bin: false,
              remoteFs: true,
              remoteFsRoot: ROOT,
              nodeServe: true,
              previewScope: expect.any(String),
              terminal: {
                stdinIsTTY: false,
                stdoutIsTTY: true,
                stderrIsTTY: true,
                cols: 93,
                rows: 35,
              },
            },
          },
        },
      },
    });

    worker.finish(7);
    await running;
    expect(globalProcessManager.get(spec.pid)).toBeNull();
    expect(h.frames).toContainEqual({
      type: 'pty:exit',
      sid: 'terminal-node-cli',
      rid: 'run-node-cli',
      code: 7,
      exit: { code: 7, signal: null },
      cwd: ROOT,
      env: { USER_FLAG: 'preserved' },
    });
    await h.runtime.close();
  });

  it('builds one exact v3 admitted-child launch without an owner-VFS carrier', async () => {
    const source = 'JSON.stringify({marker:"node-eval"})';
    const workers = installRealKernelWorkerBoundary();
    const reservationEvidence: {
      events: string[];
      paths: string[];
      ready?: unknown;
    } = { events: [], paths: [] };
    const h = await harness(
      undefined,
      nodeCliPackageConfig,
      async () => {},
      undefined,
      reservationEvidence,
    );
    const before = snapshotProjectTree(h.authority);
    const writeHistory = vi.spyOn(h.authority, 'writeFileSync');
    const unlinkHistory = vi.spyOn(h.authority, 'rmSync');
    h.runtime.handlePtyFrame({
      type: 'pty:open',
      sid: 'terminal-node-eval',
      env: { USER_FLAG: 'preserved' },
    });

    const running = Promise.resolve(
      h.runtime.handlePtyFrame({
        type: 'pty:exec',
        sid: 'terminal-node-eval',
        rid: 'run-node-eval',
        line: `node -pe '${source}' alpha 'two words'`,
        cols: 97,
        rows: 37,
        isTTY: true,
      }),
    );
    await vi.waitFor(() => expect(workers).toHaveLength(1));
    const worker = workers[0];
    if (worker === undefined) throw new Error('expected one real kernel Worker boundary');
    const spec = worker.spec();

    expect(globalProcessManager.get(spec.pid)).toMatchObject({
      kind: 'worker',
      command: 'node',
      pid: spec.pid,
    });
    expect(spec).toMatchObject({
      cwd: '/',
      argv: [NODE_PROCESS_IDENTITY.execPath, 'alpha', 'two words'],
      env: { USER_FLAG: 'preserved' },
      serve: true,
      entry: {
        kind: 'url',
        url: NODE_ENTRY_WORKER_URL,
        bootstrap: {
          protocol: 'rifty.node-entry/v3',
          payload: {
            hostRuntime: NODE_WORKER_RUNTIME_ENV,
            launch: {
              kind: 'eval',
              source,
              print: true,
              execArgv: ['-pe', source],
              remoteFs: true,
              remoteFsRoot: ROOT,
              previewScope: expect.any(String),
              terminal: {
                stdinIsTTY: false,
                stdoutIsTTY: true,
                stderrIsTTY: true,
                cols: 97,
                rows: 37,
              },
            },
          },
        },
      },
    });
    const entry = spec.entry;
    if (entry?.kind !== 'url' || entry.bootstrap === undefined) {
      throw new Error('expected eval node-entry URL bootstrap');
    }
    const payload = entry.bootstrap.payload as {
      readonly launch?: Readonly<Record<string, unknown>>;
    };
    expect(Object.keys(payload.launch ?? {}).sort()).toEqual(
      [
        'execArgv',
        'kind',
        'previewScope',
        'print',
        'remoteFs',
        'remoteFsRoot',
        'source',
        'terminal',
      ].sort(),
    );
    expect(JSON.stringify({ argv: spec.argv, env: spec.env })).not.toContain(source);
    expect(reservationEvidence.paths).toEqual([ROOT]);
    expect(reservationEvidence.events).toEqual(['commit']);

    worker.finish(0);
    await running;
    await vi.waitFor(() => expect(reservationEvidence.events).toEqual(['commit', 'dispose']));
    expect(globalProcessManager.get(spec.pid)).toBeNull();
    expect(writeHistory).not.toHaveBeenCalled();
    expect(unlinkHistory).not.toHaveBeenCalled();
    expect(snapshotProjectTree(h.authority)).toEqual(before);
    expect(h.frames).toContainEqual(
      expect.objectContaining({
        type: 'pty:exit',
        rid: 'run-node-eval',
        code: 0,
        exit: { code: 0, signal: null },
      }),
    );
    await h.runtime.close();
  });

  it.each(TERMINATED_EVAL_USAGE_ERROR_CASES)(
    'returns exact immediate-terminator usage failure without a child: $label',
    async ({ line, stderr: expectedStderr }) => {
      const processesBefore = globalProcessManager.snapshot();
      const h = await harness(undefined, nodeCliPackageConfig);
      h.runtime.handlePtyFrame({ type: 'pty:open', sid: 'terminal-node-eval-terminator' });

      try {
        await h.runtime.handlePtyFrame({
          type: 'pty:exec',
          sid: 'terminal-node-eval-terminator',
          rid: 'run-node-eval-terminator',
          line,
          cols: 80,
          rows: 24,
          isTTY: true,
        });

        const stderr = h.frames
          .filter(
            (frame): frame is Extract<OwnerToPageFrame, { type: 'pty:chunk' }> =>
              frame.type === 'pty:chunk' &&
              frame.rid === 'run-node-eval-terminator' &&
              frame.stream === 'stderr',
          )
          .map((frame) => new TextDecoder().decode(frame.data))
          .join('');
        expect(stderr).toBe(expectedStderr);
        expect(globalProcessManager.snapshot()).toEqual(processesBefore);
        expect(h.frames).toContainEqual(
          expect.objectContaining({
            type: 'pty:exit',
            rid: 'run-node-eval-terminator',
            code: 9,
            exit: { code: 9, signal: null },
          }),
        );
      } finally {
        await h.runtime.close();
      }
    },
  );

  it.each(TERMINATED_EVAL_CHILD_CASES)(
    'crosses source state and immediate terminator through one real admitted child: $label',
    async ({ line, source, print, execArgv, scriptArgs }) => {
      const workers = installRealKernelWorkerBoundary();
      const h = await harness(undefined, nodeCliPackageConfig);
      h.runtime.handlePtyFrame({ type: 'pty:open', sid: 'terminal-node-eval-terminator' });
      const running = Promise.resolve(
        h.runtime.handlePtyFrame({
          type: 'pty:exec',
          sid: 'terminal-node-eval-terminator',
          rid: 'run-node-eval-terminator',
          line,
          cols: 80,
          rows: 24,
          isTTY: true,
        }),
      );
      let worker: KernelWorkerBoundary | undefined;

      try {
        await vi.waitFor(() => expect(workers).toHaveLength(1));
        worker = workers[0];
        if (worker === undefined) throw new Error('expected one real kernel Worker boundary');
        const spec = worker.spec();

        expect(spec.argv).toEqual([NODE_PROCESS_IDENTITY.execPath, ...scriptArgs]);
        expect(spec).toMatchObject({
          entry: {
            bootstrap: {
              protocol: 'rifty.node-entry/v3',
              payload: {
                launch: {
                  kind: 'eval',
                  source,
                  print,
                  execArgv,
                },
              },
            },
          },
        });
        expect(globalProcessManager.get(spec.pid)).toMatchObject({
          kind: 'worker',
          command: 'node',
        });
      } finally {
        worker?.finish(0);
        await Promise.allSettled([running]);
        await h.runtime.close();
      }
    },
  );

  it.each([
    {
      line: "node -e ''",
      print: false,
      execArgv: ['-e', ''],
      scriptArgs: [],
    },
    {
      line: "node --eval ''",
      print: false,
      execArgv: ['--eval', ''],
      scriptArgs: [],
    },
    {
      line: "node -pe ''",
      print: true,
      execArgv: ['-pe', ''],
      scriptArgs: [],
    },
    {
      line: "node -p ''",
      print: true,
      execArgv: ['-p'],
      scriptArgs: [''],
    },
    {
      line: "node --print ''",
      print: true,
      execArgv: ['--print'],
      scriptArgs: [''],
    },
    {
      line: "node --print=ignored ''",
      print: true,
      execArgv: ['--print=ignored'],
      scriptArgs: [''],
    },
  ])(
    'preserves explicit empty source vs absent source through the real kernel boundary: $line',
    async ({ line, print, execArgv, scriptArgs }) => {
      const workers = installRealKernelWorkerBoundary();
      const h = await harness(undefined, nodeCliPackageConfig);
      h.runtime.handlePtyFrame({ type: 'pty:open', sid: 'terminal-node-eval-empty' });

      const running = Promise.resolve(
        h.runtime.handlePtyFrame({
          type: 'pty:exec',
          sid: 'terminal-node-eval-empty',
          rid: 'run-node-eval-empty',
          line,
          cols: 80,
          rows: 24,
          isTTY: true,
        }),
      );
      await vi.waitFor(() => expect(workers).toHaveLength(1));
      const worker = workers[0];
      if (worker === undefined) throw new Error('expected one real kernel Worker boundary');
      const spec = worker.spec();

      expect(spec).toMatchObject({
        argv: [NODE_PROCESS_IDENTITY.execPath, ...scriptArgs],
        entry: {
          bootstrap: {
            protocol: 'rifty.node-entry/v3',
            payload: {
              launch: {
                kind: 'eval',
                source: '',
                print,
                execArgv,
              },
            },
          },
        },
      });
      expect(globalProcessManager.get(spec.pid)).toMatchObject({ kind: 'worker', command: 'node' });

      worker.finish(0);
      await running;
      expect(globalProcessManager.get(spec.pid)).toBeNull();
      await h.runtime.close();
    },
  );

  it('keeps two simultaneous eval children isolated by cwd, argv, source, and preview scope', async () => {
    const workers = installRealKernelWorkerBoundary();
    const reservationEvidence: {
      events: string[];
      paths: string[];
      ready?: unknown;
    } = { events: [], paths: [] };
    const h = await harness(
      undefined,
      nodeCliPackageConfig,
      async () => {},
      undefined,
      reservationEvidence,
    );
    h.authority.mkdirSync(`${ROOT}/a`, { recursive: true });
    h.authority.mkdirSync(`${ROOT}/b`, { recursive: true });
    h.runtime.handlePtyFrame({ type: 'pty:open', sid: 'eval-a', cwd: `${ROOT}/a` });
    h.runtime.handlePtyFrame({ type: 'pty:open', sid: 'eval-b', cwd: `${ROOT}/b` });

    const runningA = Promise.resolve(
      h.runtime.handlePtyFrame({
        type: 'pty:exec',
        sid: 'eval-a',
        rid: 'run-eval-a',
        line: 'node -e \'console.log("a")\' argv-a',
        cols: 80,
        rows: 24,
        isTTY: true,
      }),
    );
    const runningB = Promise.resolve(
      h.runtime.handlePtyFrame({
        type: 'pty:exec',
        sid: 'eval-b',
        rid: 'run-eval-b',
        line: 'node -p \'"b"\' argv-b',
        cols: 81,
        rows: 25,
        isTTY: true,
      }),
    );
    await vi.waitFor(() => expect(workers).toHaveLength(2));
    const firstWorker = workers[0];
    const secondWorker = workers[1];
    if (firstWorker === undefined || secondWorker === undefined) {
      throw new Error('expected two real kernel Worker boundaries');
    }
    const firstSpec = firstWorker.spec();
    const secondSpec = secondWorker.spec();

    expect(firstSpec).toMatchObject({
      cwd: '/a',
      argv: [NODE_PROCESS_IDENTITY.execPath, 'argv-a'],
      entry: {
        bootstrap: {
          protocol: 'rifty.node-entry/v3',
          payload: {
            launch: {
              kind: 'eval',
              source: 'console.log("a")',
              print: false,
              execArgv: ['-e', 'console.log("a")'],
              remoteFsRoot: ROOT,
              previewScope: expect.any(String),
            },
          },
        },
      },
    });
    expect(secondSpec).toMatchObject({
      cwd: '/b',
      argv: [NODE_PROCESS_IDENTITY.execPath, 'argv-b'],
      entry: {
        bootstrap: {
          protocol: 'rifty.node-entry/v3',
          payload: {
            launch: {
              kind: 'eval',
              source: '"b"',
              print: true,
              execArgv: ['-p', '"b"'],
              remoteFsRoot: ROOT,
              previewScope: expect.any(String),
            },
          },
        },
      },
    });
    const launchOf = (worker: KernelWorkerBoundary): Readonly<Record<string, unknown>> => {
      const entry = worker.spec().entry;
      if (entry?.kind !== 'url' || entry.bootstrap === undefined) {
        throw new Error('expected eval node-entry URL bootstrap');
      }
      const payload = entry.bootstrap.payload as {
        readonly launch?: Readonly<Record<string, unknown>>;
      };
      if (payload.launch === undefined) throw new Error('expected eval launch');
      return payload.launch;
    };
    expect(launchOf(firstWorker).previewScope).not.toBe(launchOf(secondWorker).previewScope);
    expect(globalProcessManager.get(firstSpec.pid)).toMatchObject({
      kind: 'worker',
      command: 'node',
    });
    expect(globalProcessManager.get(secondSpec.pid)).toMatchObject({
      kind: 'worker',
      command: 'node',
    });
    expect(reservationEvidence.paths).toEqual([`${ROOT}/a`, `${ROOT}/b`]);
    expect(reservationEvidence.events).toEqual(['commit', 'commit']);

    secondWorker.finish(7);
    firstWorker.finish(0);
    await Promise.all([runningA, runningB]);
    await vi.waitFor(() =>
      expect(reservationEvidence.events.filter((event) => event === 'dispose')).toHaveLength(2),
    );
    expect(globalProcessManager.get(firstSpec.pid)).toBeNull();
    expect(globalProcessManager.get(secondSpec.pid)).toBeNull();
    expect(
      h.frames.filter((frame) => frame.type === 'pty:exit' && frame.rid === 'run-eval-a'),
    ).toEqual([expect.objectContaining({ code: 0, exit: { code: 0, signal: null } })]);
    expect(
      h.frames.filter((frame) => frame.type === 'pty:exit' && frame.rid === 'run-eval-b'),
    ).toEqual([expect.objectContaining({ code: 7, exit: { code: 7, signal: null } })]);
    await h.runtime.close();
  });

  it.each([
    ['node -e', 'node: -e requires an argument\n'],
    ['node --eval', 'node: --eval requires an argument\n'],
    ['node --eval=', 'node: --eval= requires an argument\n'],
    ['node -pe', 'node: --eval requires an argument\n'],
    ['node -ep 1', 'node: bad option: -ep\n'],
    ['node -eSRC', 'node: bad option: -eSRC\n'],
    ['node -e=SRC', 'node: bad option: -e=SRC\n'],
    ['node -pSRC', 'node: bad option: -pSRC\n'],
    ['node -p=SRC', 'node: bad option: -p=SRC\n'],
    ['node -peSRC', 'node: bad option: -peSRC\n'],
    ['node -epSRC', 'node: bad option: -epSRC\n'],
    ['node -pe=SRC', 'node: bad option: -pe=SRC\n'],
    ['node -ep=SRC', 'node: bad option: -ep=SRC\n'],
  ])('returns Node-shaped exit 9 without allocating a child: %s', async (line, expectedStderr) => {
    const processesBefore = globalProcessManager.snapshot();
    const h = await harness(undefined, nodeCliPackageConfig);
    h.runtime.handlePtyFrame({ type: 'pty:open', sid: 'terminal-node-eval' });

    await h.runtime.handlePtyFrame({
      type: 'pty:exec',
      sid: 'terminal-node-eval',
      rid: 'run-node-eval',
      line,
      cols: 80,
      rows: 24,
      isTTY: true,
    });

    const stderr = h.frames
      .filter(
        (frame): frame is Extract<OwnerToPageFrame, { type: 'pty:chunk' }> =>
          frame.type === 'pty:chunk' && frame.rid === 'run-node-eval' && frame.stream === 'stderr',
      )
      .map((frame) => new TextDecoder().decode(frame.data))
      .join('');
    expect(stderr).toBe(expectedStderr);
    expect(globalProcessManager.snapshot()).toEqual(processesBefore);
    expect(h.frames).toContainEqual(
      expect.objectContaining({ type: 'pty:exit', rid: 'run-node-eval', code: 9 }),
    );
    await h.runtime.close();
  });

  it.each([
    "node --input-type=module -e '1'",
    "node --input-type=module --eval '1'",
    "node --input-type=module --eval='1'",
    "node --input-type=module -p '1'",
    "node --input-type=module --print '1'",
    "node --input-type=module --print=ignored '1'",
    "node --input-type=module -pe '1'",
    'node --input-type=module -p',
    'node --input-type=module --print',
    'node --input-type=module --print=ignored',
  ])('keeps ESM eval as its named no-child context gap: %s', async (line) => {
    const processesBefore = globalProcessManager.snapshot();
    const h = await harness(undefined, nodeCliPackageConfig);
    h.runtime.handlePtyFrame({ type: 'pty:open', sid: 'terminal-node-esm-eval' });

    await h.runtime.handlePtyFrame({
      type: 'pty:exec',
      sid: 'terminal-node-esm-eval',
      rid: 'run-node-esm-eval',
      line,
      cols: 80,
      rows: 24,
      isTTY: true,
    });

    const stderr = h.frames
      .filter(
        (frame): frame is Extract<OwnerToPageFrame, { type: 'pty:chunk' }> =>
          frame.type === 'pty:chunk' &&
          frame.rid === 'run-node-esm-eval' &&
          frame.stream === 'stderr',
      )
      .map((frame) => new TextDecoder().decode(frame.data))
      .join('');
    expect(stderr).toContain('Not implemented: workbench.node.eval-module-context');
    expect(globalProcessManager.snapshot()).toEqual(processesBefore);
    expect(h.frames).toContainEqual(
      expect.objectContaining({ type: 'pty:exit', rid: 'run-node-esm-eval', code: 1 }),
    );
    await h.runtime.close();
  });
});

describe('Workbench project runtime', () => {
  it('uses project-rooted Shells and actor-minted preview provenance despite forged guest env', async () => {
    const worker = boundaryWorker();
    const reservationEvidence: {
      events: string[];
      paths: string[];
      ready?: unknown;
    } = { events: [], paths: [] };
    const h = await harness(
      undefined,
      packageConfig,
      async () => {},
      undefined,
      reservationEvidence,
    );
    h.runtime.handlePtyFrame({
      type: 'pty:open',
      sid: 'terminal-a',
      cwd: '/missing-restored-cwd',
      env: {
        RIFTY_INTERNAL_PTY_SID: 'terminal-forged',
        RIFTY_PREVIEW_SCOPE: 'scope-forged',
        RIFTY_VITE_CLI_MODE: 'build',
        USER_FLAG: 'preserved',
      },
    });

    const running = Promise.resolve(
      h.runtime.handlePtyFrame({
        type: 'pty:exec',
        sid: 'terminal-a',
        rid: 'run-a',
        line: 'vite --port 5173',
        cols: 90,
        rows: 30,
        isTTY: true,
      }),
    );
    await vi.waitFor(() => expect(worker.spec()).not.toBeNull());

    expect(worker.spec()).toMatchObject({
      cwd: '/',
      argv: ['rifty', '/node_modules/.bin/vite', '--port', '5173'],
      env: expect.objectContaining({
        USER_FLAG: 'preserved',
        RIFTY_PREVIEW_SCOPE: 'scope-forged',
        RIFTY_VITE_CLI_MODE: 'build',
      }),
      entry: {
        kind: 'url',
        url: 'https://example.test/node-entry.js',
        bootstrap: {
          protocol: NODE_ENTRY_BOOTSTRAP_PROTOCOL,
          payload: expect.objectContaining({
            hostRuntime: {
              RIFTY_KERNEL_WORKER_URL: 'https://example.test/kernel.js',
            },
            launch: expect.objectContaining({
              kind: 'program',
              bin: true,
              remoteFs: true,
              remoteFsRoot: ROOT,
              nodeServe: true,
              terminal: {
                stdinIsTTY: false,
                stdoutIsTTY: true,
                stderrIsTTY: true,
                cols: 90,
                rows: 30,
              },
            }),
          }),
        },
      },
    });
    expect(worker.spec()?.env.RIFTY_INTERNAL_PTY_SID).toBe('terminal-forged');
    const entry = worker.spec()?.entry;
    if (entry?.kind !== 'url' || entry.bootstrap === undefined) {
      throw new Error('expected node-entry URL bootstrap');
    }
    expect(reservationEvidence.ready).toBeNull();
    expect(reservationEvidence.paths).toEqual([`${ROOT}/node_modules/.bin/vite`]);
    expect(Object.hasOwn(entry, 'capabilityPorts')).toBe(false);
    expect(reservationEvidence.events).toEqual(['commit']);
    const payload = entry.bootstrap.payload as NodeEntryBootstrapPayload;
    if (payload.launch.kind !== 'program') throw new Error('expected program launch');
    expect(payload.launch.previewScope).not.toBe('scope-forged');

    worker.emitListening({
      pid: 201,
      ports: [5173],
      previewScope: 'scope-a',
    });
    const preview = h.frames
      .filter(
        (frame): frame is Extract<OwnerToPageFrame, { type: 'pty:preview' }> =>
          frame.type === 'pty:preview',
      )
      .at(-1);
    expect(preview?.ports).toEqual([
      expect.objectContaining({
        port: 5173,
        source: 'node',
        ptySid: 'terminal-a',
        ptyRid: 'run-a',
        previewScope: 'scope-a',
      }),
    ]);

    const closing = h.runtime.close();
    expect(h.runtime.close()).toBe(closing);
    expect(worker.killedWith()).toBe('SIGTERM');
    expect(h.frames.slice(-2)).toEqual([
      { type: 'pty:preview', ports: [] },
      { type: 'pty:dev-server', status: 'stopped' },
    ]);

    worker.emitListening({
      pid: 201,
      ports: [5999],
      previewScope: 'late-scope',
    });
    expect(h.frames.at(-2)).toEqual({ type: 'pty:preview', ports: [] });
    h.runtime.handlePtyFrame({ type: 'pty:open', sid: 'terminal-too-late' });
    expect(h.frames.at(-1)).toEqual({
      type: 'pty:ready',
      sid: 'terminal-too-late',
      error: 'ClosedHandleError: pty server is closing',
    });
    await expect(settledOr(closing, 'pending')).resolves.toBe('pending');
    expect(reservationEvidence.events).toEqual(['commit']);
    worker.emitExit(null, 'SIGTERM');
    await expect(closing).resolves.toBeUndefined();
    await running;
    expect(reservationEvidence.events).toEqual(['commit', 'dispose']);
  });

  it('exposes one project-rooted terminal namespace without leaking the owner root', async () => {
    const h = await harness();
    h.runtime.handlePtyFrame({ type: 'pty:open', sid: 'terminal-namespace' });

    await h.runtime.handlePtyFrame({
      type: 'pty:exec',
      sid: 'terminal-namespace',
      rid: 'run-namespace',
      line: 'pwd; cd /; pwd; realpath /src/main.js; cat /src/main.js',
      cols: 80,
      rows: 24,
      isTTY: true,
    });

    const chunks = h.frames.filter(
      (frame): frame is Extract<OwnerToPageFrame, { type: 'pty:chunk' }> =>
        frame.type === 'pty:chunk' && frame.rid === 'run-namespace',
    );
    const stdout = chunks
      .filter((frame) => frame.stream === 'stdout')
      .map((frame) => new TextDecoder().decode(frame.data))
      .join('');
    const stderr = chunks
      .filter((frame) => frame.stream === 'stderr')
      .map((frame) => new TextDecoder().decode(frame.data))
      .join('');

    expect(stdout).toBe('/\n/\n/src/main.js\nexport {};\n');
    expect(stderr).toBe('');
    expect(`${stdout}${stderr}`).not.toContain(ROOT);
    expect(h.frames).toContainEqual(
      expect.objectContaining({ type: 'pty:exit', rid: 'run-namespace', code: 0 }),
    );
    await h.runtime.close();
  });

  it('runs npm lifecycle bodies through a nested real Shell rooted in the project', async () => {
    const h = await harness();
    h.runtime.handlePtyFrame({ type: 'pty:open', sid: 'terminal-npm' });

    await h.runtime.handlePtyFrame({
      type: 'pty:exec',
      sid: 'terminal-npm',
      rid: 'run-npm',
      line: 'npm run where',
      cols: 80,
      rows: 24,
      isTTY: true,
    });

    const output = h.frames
      .filter(
        (frame): frame is Extract<OwnerToPageFrame, { type: 'pty:chunk' }> =>
          frame.type === 'pty:chunk' && frame.rid === 'run-npm',
      )
      .map((frame) => new TextDecoder().decode(frame.data))
      .join('');
    expect(output).toBe('> pwd\n/\n');
    expect(output).not.toContain(ROOT);
    expect(h.frames).toContainEqual(
      expect.objectContaining({
        type: 'pty:exit',
        rid: 'run-npm',
        code: 0,
        cwd: ROOT,
      }),
    );
    await h.runtime.close();
  });

  it('selects a nested node_modules npm prefix through the production PTY owner composition', async () => {
    const installCwds: string[] = [];
    const baseInstall = preparedTreeInstall(nodeCliPackageConfig);
    const install: InstallFn = async (arg1, rootVersion, dependenciesOrOpts, explicitOpts) => {
      const options: InstallOptions | undefined =
        typeof arg1 === 'object'
          ? arg1
          : (explicitOpts ??
            (dependenciesOrOpts !== undefined &&
            'vfs' in dependenciesOrOpts &&
            typeof dependenciesOrOpts.vfs !== 'string'
              ? (dependenciesOrOpts as InstallOptions)
              : undefined));
      if (options === undefined) throw new Error('test install options missing');
      installCwds.push(options.cwd);
      const packageJson = JSON.parse(
        await options.vfs.readFileText(`${options.cwd}/package.json`),
      ) as {
        readonly dependencies?: Readonly<Record<string, string>>;
      };
      if (packageJson.dependencies?.['user-pkg'] === '1.0.0') {
        await options.vfs.mkdir(`${options.cwd}/node_modules/user-pkg`, { recursive: true });
        await options.vfs.writeFile(
          `${options.cwd}/node_modules/user-pkg/package.json`,
          '{"name":"user-pkg","version":"1.0.0"}\n',
        );
      }
      return await baseInstall(arg1, rootVersion, dependenciesOrOpts, explicitOpts);
    };
    const h = await harness(undefined, nodeCliPackageConfig, async () => {}, undefined, undefined, {
      install,
    });
    const nestedRoot = `${ROOT}/sub`;
    h.authority.mkdirSync(`${nestedRoot}/deep`, { recursive: true });
    h.authority.mkdirSync(`${nestedRoot}/node_modules`, { recursive: false });
    const outerPackageJson = h.authority.readFileBytesSync(`${ROOT}/package.json`);
    installCwds.length = 0;
    h.runtime.handlePtyFrame({ type: 'pty:open', sid: 'terminal-npm-prefix' });

    await h.runtime.handlePtyFrame({
      type: 'pty:exec',
      sid: 'terminal-npm-prefix',
      rid: 'run-npm-prefix',
      line: 'cd sub/deep && npm install user-pkg@1.0.0',
      cols: 80,
      rows: 24,
      isTTY: true,
    });

    expect(installCwds).toEqual([nestedRoot]);
    expect(h.authority.readFileBytesSync(`${ROOT}/package.json`)).toEqual(outerPackageJson);
    expect(
      JSON.parse(
        new TextDecoder().decode(h.authority.readFileBytesSync(`${nestedRoot}/package.json`)),
      ),
    ).toMatchObject({
      name: 'rifty-project',
      dependencies: { 'user-pkg': '1.0.0' },
    });
    expect(h.authority.existsSync(`${nestedRoot}/node_modules/user-pkg/package.json`)).toBe(true);
    expect(h.authority.existsSync(`${ROOT}/node_modules/user-pkg/package.json`)).toBe(false);
    expect(h.frames).toContainEqual(
      expect.objectContaining({ type: 'pty:exit', rid: 'run-npm-prefix', code: 0 }),
    );
    await h.runtime.close();
  });

  it('binds terminal npm commands to owner package-mutation reflection', async () => {
    const recordMutation = vi.fn(
      async (_kind: OwnerPackageMutationKind, _treeRevision: number) => {},
    );
    const h = await harness(undefined, packageConfig, async () => {}, recordMutation);
    const createNpmCommand = vi.spyOn(h.packageState, 'createNpmCommand');

    h.runtime.handlePtyFrame({ type: 'pty:open', sid: 'terminal-npm-mutations' });

    expect(createNpmCommand).toHaveBeenCalledWith(expect.any(Function), {
      recordMutation,
      mapInvocationContext: expect.any(Function),
    });
    await h.runtime.close();
  });

  it('routes Shell writes through the package guard and reserved-path policy', async () => {
    const h = await harness();
    const stampPath = `${ROOT}/node_modules/.rifty-install-stamp.json`;
    const trustedStamp = h.authority.readFileBytesSync(stampPath);
    h.runtime.handlePtyFrame({ type: 'pty:open', sid: 'terminal-write' });

    await h.runtime.handlePtyFrame({
      type: 'pty:exec',
      sid: 'terminal-write',
      rid: 'run-write',
      line: 'touch should-not-exist.txt node_modules/.rifty-install-stamp.json',
      cols: 80,
      rows: 24,
      isTTY: true,
    });

    const stderr = h.frames
      .filter(
        (frame): frame is Extract<OwnerToPageFrame, { type: 'pty:chunk' }> =>
          frame.type === 'pty:chunk' && frame.rid === 'run-write' && frame.stream === 'stderr',
      )
      .map((frame) => new TextDecoder().decode(frame.data))
      .join('');
    expect(stderr).toMatch(/EPERM.*reserved install-stamp authority claim/i);
    expect(h.frames).toContainEqual(
      expect.objectContaining({ type: 'pty:exit', rid: 'run-write', code: 1 }),
    );
    expect(h.authority.readFileBytesSync(stampPath)).toEqual(trustedStamp);
    expect(h.authority.existsSync(`${ROOT}/should-not-exist.txt`)).toBe(false);
    await h.runtime.close();
  });

  it('publishes a real Shell rename before its matching PTY exit', async () => {
    const timeline: string[] = [];
    const h = await harness(
      (frame) => {
        if (frame.type === 'pty:exit' && frame.rid === 'run-mv') timeline.push('exit');
      },
      packageConfig,
      async () => {
        timeline.push('barrier');
      },
    );
    const source = `${ROOT}/before.txt`;
    const target = `${ROOT}/after.txt`;
    const bytes = new TextEncoder().encode('moved by shell');
    h.authority.writeFileSync(source, bytes);
    h.runtime.handlePtyFrame({ type: 'pty:open', sid: 'terminal-mv' });

    await h.runtime.handlePtyFrame({
      type: 'pty:exec',
      sid: 'terminal-mv',
      rid: 'run-mv',
      line: 'mv before.txt after.txt',
      cols: 80,
      rows: 24,
      isTTY: true,
    });

    expect(h.authority.existsSync(source)).toBe(false);
    expect(h.authority.readFileBytesSync(target)).toEqual(bytes);
    expect(timeline).toEqual(['barrier', 'barrier', 'exit']);
    await h.runtime.close();
  });

  it('joins the beforeExit barrier for a Shell command with no mutation', async () => {
    const entered = deferred<void>();
    const release = deferred<void>();
    const timeline: string[] = [];
    const h = await harness(
      (frame) => {
        if (frame.type === 'pty:exit' && frame.rid === 'run-echo') timeline.push('exit');
      },
      packageConfig,
      async () => {
        timeline.push('barrier-entered');
        entered.resolve(undefined);
        await release.promise;
        timeline.push('barrier-settled');
      },
    );
    h.runtime.handlePtyFrame({ type: 'pty:open', sid: 'terminal-echo' });
    const run = Promise.resolve(
      h.runtime.handlePtyFrame({
        type: 'pty:exec',
        sid: 'terminal-echo',
        rid: 'run-echo',
        line: 'echo no mutation',
        cols: 80,
        rows: 24,
        isTTY: true,
      }),
    );
    await expect(
      settledOr(
        entered.promise.then(() => 'entered'),
        'not-entered',
      ),
    ).resolves.toBe('entered');

    try {
      expect(timeline).toEqual(['barrier-entered']);
      await expect(settledOr(run, 'pending')).resolves.toBe('pending');
    } finally {
      release.resolve(undefined);
    }
    await expect(run).resolves.toBeUndefined();
    expect(timeline).toEqual(['barrier-entered', 'barrier-settled', 'exit']);
    await h.runtime.close();
  });

  it('rejects legacy project reconfiguration instead of acknowledging a fake switch', async () => {
    const h = await harness();

    await h.runtime.handlePtyFrame({
      type: 'pty:dev-config',
      id: 'legacy-config',
      templateId: 'other-project',
      slug: 'other-project',
      setup: 'from-scratch',
    });

    expect(h.frames).toContainEqual({
      type: 'pty:dev-config-ready',
      id: 'legacy-config',
      error: 'Workbench project config is immutable for the active project',
    });
    await h.runtime.close();
  });

  it('fails close loudly when the final owner durability barrier is unclean', async () => {
    const h = await harness();
    h.authority.flush = async () => ({
      failures: [{ path: `${ROOT}/package.json`, op: 'write', message: 'quota exceeded' }],
      total: 1,
    });

    await expect(h.runtime.close()).rejects.toThrow(
      /Workbench project runtime close failed.*durability.*quota exceeded/is,
    );
    expect(h.frames.slice(-2)).toEqual([
      { type: 'pty:preview', ports: [] },
      { type: 'pty:dev-server', status: 'stopped' },
    ]);
  });

  it('waits for package mutations admitted before close to quiesce', async () => {
    const h = await harness();
    const entered = deferred<void>();
    const release = deferred<void>();
    const mutation = h.packageState.mutations.guardedMutation(
      [{ kind: 'write', path: `${ROOT}/pending.txt` }],
      async () => {
        entered.resolve(undefined);
        await release.promise;
        h.authority.writeFileSync(`${ROOT}/pending.txt`, new Uint8Array());
      },
    );
    await entered.promise;

    const closing = h.runtime.close();
    await expect(settledOr(closing, 'pending')).resolves.toBe('pending');
    release.resolve(undefined);
    await mutation;
    await expect(closing).resolves.toBeUndefined();
  });

  // Queued-waiter abort on close is owned by package-acquisition-authority.fault.test.ts
  // ('aborts a queued terminal waiter before the FIFO head releases'): at this level the pty
  // run settles via the shell's own SIGINT race regardless of the waiter fix, so no
  // runtime-observable discriminates — a spec here would be a decorative guard.
  it('project close aborts an npm install stalled at the real RegistryClient boundary', async () => {
    const registryStarted = deferred<void>();
    const observed: { signal?: AbortSignal } = {};
    const registry = new RegistryClient({
      baseUrl: 'https://registry.test',
      maxRetries: 0,
      stallTimeoutMs: 60_000,
      fetch: async (_url, init) => {
        if (init?.signal instanceof AbortSignal) observed.signal = init.signal;
        registryStarted.resolve(undefined);
        return await new Promise<Response>(() => {});
      },
    });
    const realObjectInstall: InstallFn = async (options) => {
      if (typeof options === 'string') throw new Error('expected object-form install');
      return await installPackages(options);
    };
    const h = await harness(undefined, nodeCliPackageConfig, async () => {}, undefined, undefined, {
      registry,
      install: realObjectInstall,
    });
    h.runtime.handlePtyFrame({ type: 'pty:open', sid: 'terminal-stalled-npm' });
    const running = Promise.resolve(
      h.runtime.handlePtyFrame({
        type: 'pty:exec',
        sid: 'terminal-stalled-npm',
        rid: 'run-stalled-npm',
        line: 'npm install kleur@4.1.5',
        cols: 80,
        rows: 24,
        isTTY: true,
      }),
    );
    await registryStarted.promise;

    const closing = h.runtime.close();

    await expect(settledOr(closing, 'pending')).resolves.toBeUndefined();
    await expect(running).resolves.toBeUndefined();
    expect(observed.signal?.aborted).toBe(true);
  });

  it('shares one close promise with a re-entrant definitive-preview callback', async () => {
    let reentrant: Promise<void> | undefined;
    const h = await harness((frame, runtime) => {
      if (frame.type === 'pty:preview' && frame.ports.length === 0 && reentrant === undefined) {
        reentrant = runtime().close();
      }
    });

    const closing = h.runtime.close();

    expect(reentrant).toBe(closing);
    await expect(closing).resolves.toBeUndefined();
  });

  it('rejects a package config whose root is not the owner-born project root', async () => {
    const h = await harness();

    expect(() =>
      createWorkbenchProjectRuntime({
        projectRoot: ROOT,
        packageConfig: {
          ...packageConfig,
          cfg: { ...packageConfig.cfg, root: '/page-claimed-root' },
        },
        authority: h.authority,
        packageState: h.packageState,
        nodeEntryWorkerUrl: 'https://example.test/node-entry.js',
        devServerWorkerUrl: 'https://example.test/dev-server.js',
        nodeWorkerRuntimeEnv: {},
        mutationGuard: async (_intents, apply) => await apply(),
        publicationBarrier: async () => {},
        send: () => {},
      }),
    ).toThrow(/project root/i);
  });
});
