import { RegistryClient } from '@riftydev/npm-client';
import { createMemoryFs } from '@riftydev/vfs/internal';
import { describe, expect, it } from 'vitest';
import {
  type PlaygroundDocumentWriter,
  createPlaygroundDocumentWriter,
} from '../adapters/playground-project-view.ts';
import type { HostCommitRequest } from '../glue/owner-vfs-protocol.ts';
import { collectSnapshot } from '../glue/vfs-snapshot-port.ts';
import type { BootstrapConfig } from '../templates/project-spec.ts';
import {
  type OwnerPackageConfig,
  createOwnerPackageState,
} from '../workers/owner-package-state.ts';
import {
  type OwnerVfsAuthority,
  createOwnerVfsAuthorityComposition,
} from '../workers/owner-vfs-authority.ts';
import { createWorkbenchProjectVfs } from '../workers/workbench-project-vfs.ts';
import { FileConflictError, type ProjectDocumentInvalidation } from './errors.ts';
import {
  type ProjectContentTransport,
  createProjectContentTransport,
} from './project-content-transport.ts';
import type { OwnerProjectVfsFrame, PageProjectVfsFrame } from './project-vfs-protocol.ts';

const ROOT = '/.rifty/workbench/v1/projects/project-a/tree';
const SOURCE = `${ROOT}/src/main.ts`;
const TARGET = `${ROOT}/src/renamed.ts`;
const OWNER_EPOCH = 'owner-mutation-ordering';
const encoder = new TextEncoder();
const packageJson = '{"name":"owner-mutation-ordering","version":"1.0.0"}\n';
const bootstrapConfig: BootstrapConfig = {
  runtime: 'node-cli',
  root: ROOT,
  entryPath: SOURCE,
  packageName: 'owner-mutation-ordering',
  packageVersion: '1.0.0',
  installDeps: {},
  packageJson,
  seedFiles: {},
};
const packageConfig: OwnerPackageConfig = {
  cfg: bootstrapConfig,
  templateId: 'owner-mutation-ordering',
  slug: 'project-a',
  fromScratch: true,
};

type TimelineEvent =
  | {
      readonly kind: 'owner';
      readonly type: OwnerProjectVfsFrame['type'];
    }
  | {
      readonly kind: 'files';
      readonly staleReason: ProjectDocumentInvalidation | null;
      readonly paths: readonly string[];
    };

interface StructuralCase {
  readonly name: 'rename' | 'remove';
  readonly staleReason: ProjectDocumentInvalidation;
  readonly paths: readonly string[];
  request(operationId: string, expectedVersion: string): HostCommitRequest;
  mutation(treeRevision: number): object;
}

const STRUCTURAL_CASES: readonly StructuralCase[] = [
  {
    name: 'rename',
    staleReason: 'rename',
    paths: ['/src', '/src/renamed.ts'],
    request: (operationId, expectedVersion) => ({
      kind: 'rename',
      operationId,
      sourcePath: SOURCE,
      targetPath: TARGET,
      expectedSourceVersion: expectedVersion,
      expectedTargetVersion: null,
    }),
    mutation: (treeRevision) => ({
      kind: 'rename',
      treeRevision,
      sourcePath: SOURCE,
      targetPath: TARGET,
    }),
  },
  {
    name: 'remove',
    staleReason: 'delete',
    paths: ['/src'],
    request: (operationId, expectedVersion) => ({
      kind: 'remove',
      operationId,
      path: SOURCE,
      expectedVersion,
      recursive: false,
    }),
    mutation: (treeRevision) => ({
      kind: 'remove',
      treeRevision,
      path: SOURCE,
      recursive: false,
    }),
  },
];

function harness() {
  const memory = createMemoryFs();
  const composition = createOwnerVfsAuthorityComposition(memory.fsSync, {
    ownerEpoch: OWNER_EPOCH,
    initialRoots: ['/'],
  });
  const { authority, appliedMutations, installStampClaims } = composition;
  authority.mkdirSync(`${ROOT}/src`, { recursive: true });
  authority.writeFileSync(SOURCE, encoder.encode('old'));

  const packageState = createOwnerPackageState({
    initial: packageConfig,
    vfs: memory.vfs,
    fsSync: authority,
    installStampClaims,
    flush: () => authority.flush(),
    nodeWorkerRuntimeEnv: {},
    log: () => {},
    registry: new RegistryClient({
      baseUrl: 'https://example.test/registry',
      fetch: async () => new Response('', { status: 599 }),
    }),
    resolverUrl: () => undefined,
    resolverBundleBaseUrl: () => undefined,
    resolverPin: () => undefined,
  });

  const emitted: OwnerProjectVfsFrame[] = [];
  const timeline: TimelineEvent[] = [];
  const buffered: OwnerProjectVfsFrame[] = [];
  const backgroundFailures: unknown[] = [];
  let transport: ProjectContentTransport | null = null;
  let requestSequence = 0;

  const vfs = createWorkbenchProjectVfs({
    projectRoot: ROOT,
    authority,
    appliedMutations,
    packageMutations: packageState.mutations,
    durability: 'ephemeral',
    fatal: (error) => backgroundFailures.push(error),
    emit(frame) {
      emitted.push(frame);
      timeline.push({ kind: 'owner', type: frame.type });
      if (transport === null) buffered.push(frame);
      else transport.accept(frame);
    },
  });

  const createdTransport = createProjectContentTransport({
    projectRoot: ROOT,
    send(frame: PageProjectVfsFrame) {
      const handled = vfs.handleFrame(frame);
      if (handled !== undefined) {
        void handled.catch((error: unknown) => backgroundFailures.push(error));
      }
      return true;
    },
    isAlive: () => true,
    generateRequestId: () => `owner-ordering-${String(++requestSequence)}`,
    commitTimeoutMs: 1_000,
  });
  transport = createdTransport;
  for (const frame of buffered) createdTransport.accept(frame);
  buffered.length = 0;

  return {
    authority,
    emitted,
    timeline,
    backgroundFailures,
    transport: createdTransport,
    vfs,
  };
}

async function observeFiles(h: ReturnType<typeof harness>) {
  const content = await h.transport.ready;
  expect(h.emitted[0]).toEqual({
    type: 'workbench:project-vfs-snapshot',
    frame: collectSnapshot(h.authority, ROOT),
  });
  const document = await content.documents.open('/src/main.ts');
  const unsubscribe = content.files.subscribe((snapshot) => {
    h.timeline.push({
      kind: 'files',
      staleReason: document.snapshot().staleReason,
      paths: snapshot.entries.map((entry) => entry.path),
    });
  });
  h.timeline.length = 0;
  return { content, document, unsubscribe };
}

function requiredVersion(authority: OwnerVfsAuthority, path: string): string {
  const version = authority.versionOf(path);
  if (version === null) throw new Error(`test version missing for ${path}`);
  return version;
}

async function handleHostCommit(
  h: ReturnType<typeof harness>,
  request: HostCommitRequest,
): Promise<void> {
  await h.vfs.handleFrame({ type: 'rifty:owner-vfs-commit', request });
  expect(h.backgroundFailures).toEqual([]);
}

describe.each(STRUCTURAL_CASES)('owner-applied $name ordering', (scenario) => {
  it('invalidates Documents before Files reflection and emits the host ACK last', async () => {
    const h = harness();
    const observed = await observeFiles(h);
    const beforeRevision = h.authority.treeRevision;
    const request = scenario.request(
      `owner-${scenario.name}`,
      requiredVersion(h.authority, SOURCE),
    );
    const emittedBefore = h.emitted.length;

    await handleHostCommit(h, request);

    const treeRevision = beforeRevision + 1;
    const terminal = h.authority.retainedHostCommitTerminal(request.operationId);
    if (terminal === null) throw new Error('host commit terminal was not retained');
    expect.soft(h.authority.treeRevision).toBe(treeRevision);
    expect.soft(terminal).toMatchObject({
      type: 'rifty:owner-vfs-commit-ack',
      operationId: request.operationId,
      ok: true,
      ack: { ownerEpoch: OWNER_EPOCH, treeRevision },
    });
    expect.soft(h.emitted.slice(emittedBefore)).toEqual([
      {
        type: 'workbench:project-vfs-state',
        fromTreeRevision: beforeRevision,
        mutations: [scenario.mutation(treeRevision)],
        frame: collectSnapshot(h.authority, ROOT),
      },
      terminal,
    ]);
    expect.soft(h.timeline).toEqual([
      { kind: 'owner', type: 'workbench:project-vfs-state' },
      {
        kind: 'files',
        staleReason: scenario.staleReason,
        paths: scenario.paths,
      },
      { kind: 'owner', type: 'rifty:owner-vfs-commit-ack' },
    ]);
    expect.soft(observed.document.snapshot()).toMatchObject({
      staleReason: scenario.staleReason,
      dirty: false,
      closed: false,
    });

    h.timeline.length = 0;
    const replayBefore = h.emitted.length;
    await handleHostCommit(h, request);

    expect.soft(h.authority.treeRevision).toBe(treeRevision);
    expect.soft(h.emitted.slice(replayBefore)).toEqual([terminal]);
    expect.soft(h.timeline).toEqual([{ kind: 'owner', type: 'rifty:owner-vfs-commit-ack' }]);
    observed.unsubscribe();
  });
});

describe('owner-applied no-op ordering', () => {
  it('reflects the same revision without invalidating Documents or notifying Files', async () => {
    const h = harness();
    const observed = await observeFiles(h);
    const treeRevision = h.authority.treeRevision;
    const version = requiredVersion(h.authority, SOURCE);
    const request: HostCommitRequest = {
      kind: 'rename',
      operationId: 'owner-same-path-rename',
      sourcePath: SOURCE,
      targetPath: SOURCE,
      expectedSourceVersion: version,
      expectedTargetVersion: version,
    };
    const emittedBefore = h.emitted.length;

    await handleHostCommit(h, request);

    const terminal = h.authority.retainedHostCommitTerminal(request.operationId);
    if (terminal === null) throw new Error('no-op terminal was not retained');
    expect.soft(h.authority.treeRevision).toBe(treeRevision);
    expect.soft(h.emitted.slice(emittedBefore)).toEqual([
      {
        type: 'workbench:project-vfs-state',
        fromTreeRevision: treeRevision,
        mutations: [],
        frame: collectSnapshot(h.authority, ROOT),
      },
      terminal,
    ]);
    expect.soft(h.timeline).toEqual([
      { kind: 'owner', type: 'workbench:project-vfs-state' },
      { kind: 'owner', type: 'rifty:owner-vfs-commit-ack' },
    ]);
    expect.soft(observed.document.snapshot()).toMatchObject({
      staleReason: null,
      dirty: false,
      closed: false,
    });
    expect
      .soft(observed.content.files.snapshot().entries.map((entry) => entry.path))
      .toEqual(['/src', '/src/main.ts']);

    h.timeline.length = 0;
    const replayBefore = h.emitted.length;
    await handleHostCommit(h, request);

    expect.soft(h.authority.treeRevision).toBe(treeRevision);
    expect.soft(h.emitted.slice(replayBefore)).toEqual([terminal]);
    expect.soft(h.timeline).toEqual([{ kind: 'owner', type: 'rifty:owner-vfs-commit-ack' }]);
    expect.soft(observed.document.snapshot().staleReason).toBeNull();
    observed.unsubscribe();
  });
});

describe('editor document CAS ordering', () => {
  // Fault class: observable-order + provenance-lie. The editor-open read and
  // Document CAS base are one identity; sampling the handle at first write
  // silently makes stale editor bytes look current.
  it('keeps the editor-open V1 as the first-write CAS base after an external V2', async () => {
    const h = harness();
    const content = await h.transport.ready;
    const writer: PlaygroundDocumentWriter = createPlaygroundDocumentWriter(content.documents);
    const opened = await content.files.readFile('/src/main.ts');
    await writer.open('/src/main.ts');

    const externalBytes = encoder.encode('external');
    await h.vfs.mutationGuard([{ kind: 'write', path: SOURCE }], () => {
      h.authority.writeFileSync(SOURCE, externalBytes);
    });
    const external = await content.files.readFile('/src/main.ts');
    expect(external.version).not.toBe(opened.version);
    expect(external.bytes).toEqual(externalBytes);

    const failure = await writer
      .write('/src/main.ts', new TextDecoder().decode(opened.bytes))
      .catch((error: unknown) => error);
    const preserved = await content.files.readFile('/src/main.ts');

    expect.soft(failure).toBeInstanceOf(FileConflictError);
    expect.soft(failure).toMatchObject({
      path: '/src/main.ts',
      expectedVersion: opened.version,
      actualVersion: external.version,
    });
    expect.soft((failure as FileConflictError | undefined)?.actualBytes).toEqual(externalBytes);
    expect.soft(preserved).toEqual(external);
    expect.soft(h.backgroundFailures).toEqual([]);
  });
});
