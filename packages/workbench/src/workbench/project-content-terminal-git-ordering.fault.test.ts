import { RegistryClient } from '@riftydev/npm-client';
import { Shell } from '@riftydev/shell';
import { MemoryFsSync, resetSyncMirror, setSyncMirror } from '@riftydev/vfs/internal';
import { afterEach, describe, expect, it } from 'vitest';
import { SyncMirrorVfs } from '../glue/sync-mirror-vfs.ts';
import {
  type OwnerPackageConfig,
  createOwnerPackageState,
} from '../workers/owner-package-state.ts';
import { createOwnerVfsAuthorityComposition } from '../workers/owner-vfs-authority.ts';
import { createWorkbenchProjectRuntime } from '../workers/workbench-project-runtime.ts';
import { createWorkbenchProjectVfs } from '../workers/workbench-project-vfs.ts';
import { StaleProjectDocumentError } from './errors.ts';
import {
  type ProjectContentTransport,
  createProjectContentTransport,
} from './project-content-transport.ts';
import type { OwnerProjectVfsFrame, PageProjectVfsFrame } from './project-vfs-protocol.ts';

const ROOT = '/.rifty/workbench/v1/projects/project-a/tree';
const SOURCE_A = `${ROOT}/src/a.ts`;
const SOURCE_B = `${ROOT}/src/b.ts`;
const COMMITTED_A = 'export const value = "committed";\n';
const WORKING_A = 'export const value = "working";\n';
const LOCAL_A = 'export const value = "local editor";\n';
const SOURCE_B_BYTES = 'export const sibling = true;\n';
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const NODE_WORKER_RUNTIME_ENV = Object.freeze({
  RIFTY_KERNEL_WORKER_URL: 'https://example.test/kernel.js',
  RIFTY_NODE_ENTRY_WORKER_URL: 'https://example.test/node-entry.js',
  RIFTY_SQLITE_WASM_URL: 'https://example.test/sqlite.wasm',
});

const GIT_ENV = Object.freeze({
  GIT_AUTHOR_NAME: 'rifty',
  GIT_AUTHOR_EMAIL: 'rifty@localhost',
  GIT_AUTHOR_DATE: '1600000000',
  GIT_COMMITTER_NAME: 'rifty',
  GIT_COMMITTER_EMAIL: 'rifty@localhost',
  GIT_COMMITTER_DATE: '1600000000',
});

const packageJson = '{"name":"terminal-git-ordering","version":"1.0.0"}\n';
const bootstrapConfig: OwnerPackageConfig['cfg'] = {
  runtime: 'node-cli',
  root: ROOT,
  entryPath: SOURCE_A,
  packageName: 'terminal-git-ordering',
  packageVersion: '1.0.0',
  installDeps: {},
  packageJson,
  seedFiles: {},
};
const packageConfig: OwnerPackageConfig = {
  cfg: bootstrapConfig,
  templateId: 'terminal-git-ordering',
  slug: 'project-a',
  fromScratch: true,
};

afterEach(() => resetSyncMirror());

async function checkedRun(shell: Shell, line: string): Promise<void> {
  const result = await shell.run(line);
  if (result.exitCode !== 0) {
    throw new Error(`${line} failed (${String(result.exitCode)}): ${result.stderr}`);
  }
}

describe('terminal Git owner-applied ordering', () => {
  // Fault class: provenance-lie + observable-order. A path restore must fence
  // the old editor identity before Files reflection and PTY success.
  it('stales only the restored Document before Files and PTY exit', async () => {
    const composition = createOwnerVfsAuthorityComposition(new MemoryFsSync(), {
      ownerEpoch: 'terminal-git-ordering',
      initialRoots: ['/'],
    });
    const { authority, appliedMutations, installStampClaims } = composition;
    setSyncMirror(authority, { async: new SyncMirrorVfs() });
    authority.mkdirSync(`${ROOT}/src`, { recursive: true });
    authority.writeFileSync(`${ROOT}/package.json`, encoder.encode(packageJson));
    authority.writeFileSync(SOURCE_A, encoder.encode(COMMITTED_A));
    authority.writeFileSync(SOURCE_B, encoder.encode(SOURCE_B_BYTES));

    const setup = new Shell({
      cwd: ROOT,
      env: GIT_ENV,
      assertPortablePaths: (paths) => authority.assertPortablePaths(paths),
    });
    await checkedRun(setup, 'git init');
    await checkedRun(setup, 'git add package.json src/a.ts src/b.ts');
    await checkedRun(setup, 'git commit -m baseline');
    authority.writeFileSync(SOURCE_A, encoder.encode(WORKING_A));

    const packageState = createOwnerPackageState({
      initial: packageConfig,
      vfs: new SyncMirrorVfs(),
      fsSync: authority,
      installStampClaims,
      flush: () => authority.flush(),
      nodeWorkerRuntimeEnv: NODE_WORKER_RUNTIME_ENV,
      log: () => {},
      registry: new RegistryClient({
        baseUrl: 'https://example.test/registry',
        fetch: async () => new Response('', { status: 599 }),
      }),
      resolverUrl: () => undefined,
      resolverBundleBaseUrl: () => undefined,
      resolverPin: () => undefined,
    });

    const frames: OwnerProjectVfsFrame[] = [];
    const timeline: string[] = [];
    const backgroundFailures: unknown[] = [];
    const buffered: OwnerProjectVfsFrame[] = [];
    let transport: ProjectContentTransport | null = null;
    const projectVfs = createWorkbenchProjectVfs({
      projectRoot: ROOT,
      authority,
      appliedMutations,
      packageMutations: packageState.mutations,
      durability: 'ephemeral',
      emit(frame) {
        frames.push(frame);
        if (frame.type === 'workbench:project-vfs-state') timeline.push('owner-state');
        if (transport === null) buffered.push(frame);
        else transport.accept(frame);
      },
      fatal: (error) => backgroundFailures.push(error),
    });
    let requestSequence = 0;
    const createdTransport = createProjectContentTransport({
      projectRoot: ROOT,
      send(frame: PageProjectVfsFrame) {
        const handled = projectVfs.handleFrame(frame);
        if (handled !== undefined) {
          void handled.catch((error: unknown) => backgroundFailures.push(error));
        }
        return true;
      },
      isAlive: () => true,
      generateRequestId: () => `terminal-git-${String(++requestSequence)}`,
      commitTimeoutMs: 1_000,
    });
    transport = createdTransport;
    for (const frame of buffered) createdTransport.accept(frame);
    buffered.length = 0;

    const content = await createdTransport.ready;
    const documentA = await content.documents.open('/src/a.ts');
    const documentB = await content.documents.open('/src/b.ts');
    documentA.replace(LOCAL_A);
    const unsubscribe = content.files.subscribe(() => {
      timeline.push(`files:${documentA.snapshot().staleReason ?? 'live'}`);
    });
    expect(timeline).toEqual(['files:live']);
    timeline.length = 0;

    const runtime = createWorkbenchProjectRuntime({
      projectRoot: ROOT,
      packageConfig,
      authority,
      packageState,
      nodeEntryWorkerUrl: 'https://example.test/node-entry.js',
      devServerWorkerUrl: 'https://example.test/dev-server.js',
      nodeWorkerRuntimeEnv: NODE_WORKER_RUNTIME_ENV,
      mutationGuard: projectVfs.mutationGuard,
      publicationBarrier: projectVfs.publicationBarrier,
      send(frame) {
        if (frame.type === 'pty:exit' && frame.rid === 'restore-a') timeline.push('pty-exit');
      },
    });
    runtime.handlePtyFrame({ type: 'pty:open', sid: 'terminal-git', env: GIT_ENV });
    await runtime.handlePtyFrame({
      type: 'pty:exec',
      sid: 'terminal-git',
      rid: 'restore-a',
      line: 'git restore src/a.ts',
      cols: 80,
      rows: 24,
      isTTY: true,
    });

    const state = frames.findLast((frame) => frame.type === 'workbench:project-vfs-state');
    expect(backgroundFailures).toEqual([]);
    expect(state).toMatchObject({
      type: 'workbench:project-vfs-state',
      mutations: [{ kind: 'reset', rootPath: SOURCE_A, treeRevision: expect.any(Number) }],
    });
    expect(timeline).toEqual(['owner-state', 'files:reset', 'pty-exit']);
    expect(decoder.decode(authority.readFileBytesSync(SOURCE_A))).toBe(COMMITTED_A);
    expect(decoder.decode((await content.files.readFile('/src/a.ts')).bytes)).toBe(COMMITTED_A);
    expect(documentA.snapshot()).toMatchObject({
      bytes: encoder.encode(LOCAL_A),
      dirty: true,
      staleReason: 'reset',
      closed: false,
    });
    expect(documentB.snapshot()).toMatchObject({ staleReason: null, closed: false });
    await expect(documentA.save()).rejects.toBeInstanceOf(StaleProjectDocumentError);

    unsubscribe();
    await documentA.close({ dirty: 'discard' });
    await documentB.close();
    await content.close();
    await runtime.close();
    await projectVfs.close();
  });
});
