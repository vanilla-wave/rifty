import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { MemoryFsSync, resetSyncMirror, setSyncMirror } from '@riftydev/vfs/internal';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { readInstallStampSync, stampTrusted } from '../glue/install-stamp.ts';
import { SyncMirrorVfs } from '../glue/sync-mirror-vfs.ts';
import { createPlaygroundProjectCatalog } from '../workbench/internal/playground-project-catalog.ts';
import type { PlaygroundProjectCatalog } from '../workbench/playground.ts';
import { createOwnerPackageState } from './owner-package-state.ts';
import { createOwnerVfsAuthorityComposition } from './owner-vfs-authority.ts';
import {
  type OpenedPlaygroundProject,
  createPlaygroundProjectAuthority,
} from './playground-project-authority.ts';
import {
  type DurableOwnerFault,
  DurableOwnerFs,
  type DurablePersistTraceEntry,
  type ExactFsTree,
  createDurableOwnerFsFromTree,
} from './test-fixtures/durable-owner-fs.ts';
import { openSnapshotOnlyOwner, snapshotOnlyNetwork } from './test-fixtures/snapshot-only-owner.ts';
import {
  type SavedSnapshotFixture,
  bakeSavedSnapshotFixture,
  savedSnapshotDefinition,
  savedSnapshotSource,
} from './test-fixtures/snapshot-saved-state.ts';
import { workbenchFirstMaterializationPackageConfig } from './workbench-package-config.ts';

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const container = '/.rifty/workbench/v1/projects/scratch';
const scratchRoot = `${container}/tree`;
const catalogFile = '/.rifty/workbench/playground/catalog.json';
const transactionFile = '/.rifty/workbench/playground/transaction.json';
const retainedPrefix = '/.rifty/workbench/playground/retained-scratch';
const unknownRetainedRoot = `${retainedPrefix}/unindexed-retained/tree`;
const claimName = '.rifty-install-stamp.json';
const binary = new Uint8Array([0, 1, 2, 127, 128, 254, 255, 13, 10]);
let snapshot: SavedSnapshotFixture;
let ordinaryFiles: Readonly<Record<string, Uint8Array>>;
let ordinaryDirectories: readonly string[];

interface RetainedScratch {
  readonly id: string;
}
interface RecoveryCatalog {
  listRetainedScratch(): Promise<readonly RetainedScratch[]>;
  exportRetainedScratch(id: string): Promise<string>;
}
interface RecoveryEnvelope {
  readonly format: 'rifty-scratch-recovery';
  readonly version: 1;
  readonly root: '/';
  readonly directories: readonly string[];
  readonly files: readonly {
    readonly path: string;
    readonly encoding: 'base64';
    readonly content: string;
  }[];
}
type Owner = Awaited<ReturnType<typeof openSnapshotOnlyOwner>>;

/** Erased future-shape bridge only; invokes methods on the actual frozen catalog facade. */
function recovery(catalog: PlaygroundProjectCatalog): RecoveryCatalog {
  const actual = catalog as unknown as RecoveryCatalog;
  expect(actual.listRetainedScratch, 'public catalog.listRetainedScratch must exist').toBeTypeOf(
    'function',
  );
  expect(
    actual.exportRetainedScratch,
    'public catalog.exportRetainedScratch must exist',
  ).toBeTypeOf('function');
  return actual;
}

function ancestors(path: string): string[] {
  const segments = path.split('/');
  return segments.slice(0, -1).map((_segment, index) => segments.slice(0, index + 1).join('/'));
}

beforeAll(async () => {
  snapshot = await bakeSavedSnapshotFixture();
  ordinaryFiles = Object.freeze({
    'package.json': encoder.encode('{ malformed orphan manifest must remain literal'),
    'main.cjs': encoder.encode("console.log('orphan must never run');\n"),
    'user.bin': binary,
    'src/%2F.txt': encoder.encode('literal percent name'),
    'literal\\name.bin': binary.slice(),
    'dist/bundle.js': encoder.encode('retained build output'),
    '.git/objects/original.bin': binary.slice(),
    '.vite/cache.bin': binary.slice(),
    'nested/.rifty/ordinary.json': encoder.encode('{"keep":true}'),
    [claimName]: encoder.encode('ordinary root basename, not a claim'),
    [`node_modules/${claimName}.backup`]: encoder.encode('ordinary claim lookalike'),
    'node_modules/ms/local.bin': binary.slice(),
    ...Object.fromEntries(
      snapshot.payload.nodeModules.files.map((file) => [
        `node_modules/${file.path}`,
        Uint8Array.from(atob(file.content), (character) => character.charCodeAt(0)),
      ]),
    ),
  });
  ordinaryDirectories = Object.freeze(
    [
      ...new Set([
        ...Object.keys(ordinaryFiles).flatMap(ancestors),
        'empty',
        'empty/child',
        'node_modules/ms/empty',
        'node_modules/ms/node_modules',
      ]),
    ].sort(),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  resetSyncMirror();
});

function networkForSnapshot() {
  const network = snapshotOnlyNetwork();
  network.routes.set(snapshot.descriptor.assetUrl, () => new Response(snapshot.archive.slice()));
  return network;
}

function writeRaw(fs: DurableOwnerFs, path: string, bytes: Uint8Array) {
  fs.mkdirSync(path.slice(0, path.lastIndexOf('/')), { recursive: true });
  fs.writeFileSync(path, bytes);
}

/** Raw backing-store input: no catalog, journal, definition or trusted claim is invented. */
async function seedOrphan(fs: DurableOwnerFs = new DurableOwnerFs()) {
  for (const directory of ordinaryDirectories)
    fs.mkdirSync(`${scratchRoot}/${directory}`, { recursive: true });
  for (const [path, bytes] of Object.entries(ordinaryFiles))
    writeRaw(fs, `${scratchRoot}/${path}`, bytes);
  writeRaw(fs, `${scratchRoot}/.rifty/private.json`, encoder.encode('private root metadata'));
  writeRaw(
    fs,
    `${scratchRoot}/node_modules/${claimName}`,
    encoder.encode('untrusted old root claim bytes'),
  );
  writeRaw(fs, `${scratchRoot}/node_modules/ms/node_modules/${claimName}/private.bin`, binary);
  writeRaw(fs, `${unknownRetainedRoot}/sentinel.bin`, binary);
  await fs.flush();
  return fs;
}

function treeAt(tree: ExactFsTree, root: string): ExactFsTree {
  const prefix = `${root}/`;
  return {
    directories: tree.directories
      .filter((path) => path.startsWith(prefix))
      .map((path) => path.slice(prefix.length))
      .sort(),
    files: Object.fromEntries(
      Object.entries(tree.files)
        .filter(([path]) => path.startsWith(prefix))
        .map(([path, bytes]) => [path.slice(prefix.length), bytes]),
    ),
  };
}

function expectOrdinaryTree(tree: ExactFsTree) {
  expect(tree.directories).toEqual(ordinaryDirectories);
  expect(Object.keys(tree.files).sort()).toEqual(Object.keys(ordinaryFiles).sort());
  for (const [path, expected] of Object.entries(ordinaryFiles)) {
    const actual = tree.files[path];
    expect(actual, path).toBeDefined();
    if (actual === undefined) throw new Error(`missing retained file ${path}`);
    expect(Buffer.compare(actual, expected), path).toBe(0);
  }
}

function expectRecovery(json: string) {
  const archive = JSON.parse(json) as RecoveryEnvelope;
  expect(Object.keys(archive).sort()).toEqual([
    'directories',
    'files',
    'format',
    'root',
    'version',
  ]);
  expect(archive).toMatchObject({ format: 'rifty-scratch-recovery', version: 1, root: '/' });
  expect([...archive.directories].sort()).toEqual(ordinaryDirectories);
  expect(archive.files.map((file) => file.path).sort()).toEqual(Object.keys(ordinaryFiles).sort());
  for (const file of archive.files) {
    expect(Object.keys(file).sort()).toEqual(['content', 'encoding', 'path']);
    expect(file.encoding).toBe('base64');
    expect(file.path.startsWith('/')).toBe(false);
    const expected = ordinaryFiles[file.path];
    expect(expected, file.path).toBeDefined();
    if (expected === undefined) throw new Error(`unexpected recovery path ${file.path}`);
    expect(file.content, file.path).toBe(Buffer.from(expected).toString('base64'));
  }
}

async function retained(catalog: PlaygroundProjectCatalog) {
  const api = recovery(catalog);
  const records = await api.listRetainedScratch();
  expect(records).toHaveLength(1);
  const record = records[0];
  if (record === undefined) throw new Error('one retained record required');
  expect(Object.keys(record)).toEqual(['id']);
  expect(record.id).toBeTypeOf('string');
  expect(record.id.length).toBeGreaterThan(0);
  return { api, record, root: `${retainedPrefix}/${record.id}/tree` };
}

async function fresh(h: Owner) {
  const definition = savedSnapshotDefinition('scratch', snapshot.descriptor);
  await h.catalog.createScratch({ definition });
  return definition;
}

async function preservationReference(base: ExactFsTree) {
  const h = await openSnapshotOnlyOwner(networkForSnapshot(), createDurableOwnerFsFromTree(base));
  try {
    h.fs.armPersistFailure(Number.MAX_SAFE_INTEGER, 'quota-report');
    await fresh(h);
    const selected = await retained(h.catalog);
    expectRecovery(await selected.api.exportRetainedScratch(selected.record.id));
    expectOrdinaryTree(treeAt(h.fs.durableSnapshot(), selected.root));
    return { trace: h.fs.trace, retainedRoot: selected.root };
  } finally {
    await h.close();
  }
}

function ordinalOf(
  trace: readonly DurablePersistTraceEntry[],
  predicate: (entry: DurablePersistTraceEntry) => boolean,
): number {
  const entry = trace.find(predicate);
  expect(
    entry,
    'real successful transaction must expose the requested durability boundary',
  ).toBeDefined();
  if (entry === undefined) throw new Error('required persistence boundary absent');
  return entry.ordinal;
}

describe('I6 catalog-owned orphan Scratch retention', () => {
  it('healthy Scratch still seeds and acquires the real snapshot normally', async () => {
    const network = networkForSnapshot();
    const h = await openSnapshotOnlyOwner(network);
    let opened: OpenedPlaygroundProject | undefined;
    try {
      const definition = await fresh(h);
      opened = await h.owner.openProject(definition);
      expect(opened.acquisition).toMatchObject({
        kind: 'ready',
        provenance: { outcome: 'snapshot', packages: 1 },
      });
      expect(decoder.decode(h.authority.readFileBytesSync(`${scratchRoot}/main.cjs`))).toBe(
        savedSnapshotSource,
      );
      expect(network.requests).toEqual([snapshot.descriptor.assetUrl]);
      const stamp = readInstallStampSync(h.authority, scratchRoot);
      expect(stamp !== null && stampTrusted(stamp)).toBe(true);
    } finally {
      await opened?.close();
      await h.close();
    }
  });

  it('retains an actual unjournaled orphan, opens fresh Scratch and preserves named projects across reopen', async () => {
    const network = networkForSnapshot();
    const original = await openSnapshotOnlyOwner(network);
    const initial = await original.owner.openProject(await fresh(original));
    await initial.close();
    const named = savedSnapshotDefinition('saved-project', snapshot.descriptor);
    await original.catalog.saveScratch({
      id: 'saved-project',
      name: 'Saved project',
      definition: named,
    });
    await original.close();
    const fs = await seedOrphan(original.fs.restartFromDurableState());
    const namedRoot = '/.rifty/workbench/v1/projects/saved-project';
    const namedBefore = treeAt(fs.durableSnapshot(), namedRoot);
    network.requests.length = 0;
    const h = await openSnapshotOnlyOwner(network, fs);
    let opened: OpenedPlaygroundProject | undefined;
    let stableId = '';
    try {
      expect(h.catalog.snapshot().scratch).toBeNull();
      const definition = await fresh(h);
      const selected = await retained(h.catalog);
      stableId = selected.record.id;
      expectOrdinaryTree(treeAt(h.fs.durableSnapshot(), selected.root));
      expect(h.installStampClaims.read(selected.root)).toBeNull();
      expect(
        h.authority.statSyncOrNull(`${retainedPrefix}/${stableId}/definition.json`),
      ).toBeNull();
      expect(h.catalog.snapshot().projects.map((project) => project.id)).toEqual(['saved-project']);
      opened = await h.owner.openProject(definition);
      expect(opened.acquisition).toMatchObject({
        kind: 'ready',
        provenance: { outcome: 'snapshot' },
      });
      expect(decoder.decode(h.authority.readFileBytesSync(`${scratchRoot}/main.cjs`))).toBe(
        savedSnapshotSource,
      );
      expect(h.authority.statSyncOrNull(`${scratchRoot}/user.bin`)).toBeNull();
      expectRecovery(await selected.api.exportRetainedScratch(stableId));
      expect(await selected.api.listRetainedScratch()).toEqual([{ id: stableId }]);
      expect(treeAt(h.fs.durableSnapshot(), namedRoot)).toEqual(namedBefore);
      expect(h.authority.readFileBytesSync(`${unknownRetainedRoot}/sentinel.bin`)).toEqual(binary);
      await opened.close();
      opened = undefined;
      await h.catalog.createScratch({ definition });
      expect(
        await selected.api.listRetainedScratch(),
        'repeated create cannot duplicate retention',
      ).toEqual([{ id: stableId }]);
    } finally {
      await opened?.close();
      await h.close();
    }
    const restarted = await openSnapshotOnlyOwner(network, h.fs.restartFromDurableState());
    let namedOpened: OpenedPlaygroundProject | undefined;
    try {
      const selected = await retained(restarted.catalog);
      expect(selected.record.id).toBe(stableId);
      expectRecovery(await selected.api.exportRetainedScratch(stableId));
      expectOrdinaryTree(treeAt(restarted.fs.durableSnapshot(), selected.root));
      await restarted.catalog.activate({ kind: 'project', id: 'saved-project' });
      namedOpened = await restarted.owner.openProject(named);
      expect(namedOpened.acquisition).toEqual({ kind: 'saved' });
      expect(treeAt(restarted.fs.durableSnapshot(), namedRoot)).toEqual(namedBefore);
      expect(network.requests).toEqual([snapshot.descriptor.assetUrl]);
      expect(restarted.authority.readFileBytesSync(`${unknownRetainedRoot}/sentinel.bin`)).toEqual(
        binary,
      );
    } finally {
      await namedOpened?.close();
      await restarted.close();
    }
  });

  it('does not scan or steal an unindexed named project or unknown retained root', async () => {
    const fs = new DurableOwnerFs();
    const namedRoot = '/.rifty/workbench/v1/projects/unjournaled-named/tree';
    writeRaw(fs, `${namedRoot}/user.bin`, binary);
    writeRaw(fs, `${unknownRetainedRoot}/sentinel.bin`, binary);
    await fs.flush();
    const before = fs.durableSnapshot();
    const h = await openSnapshotOnlyOwner(networkForSnapshot(), fs);
    try {
      await fresh(h);
      expect(treeAt(h.fs.durableSnapshot(), namedRoot)).toEqual(treeAt(before, namedRoot));
      expect(treeAt(h.fs.durableSnapshot(), unknownRetainedRoot)).toEqual(
        treeAt(before, unknownRetainedRoot),
      );
      expect(await recovery(h.catalog).listRetainedScratch()).toEqual([]);
    } finally {
      await h.close();
    }
  });

  it('finishes actual journal-owned create recovery before considering orphan retention', async () => {
    const reference = await openSnapshotOnlyOwner(networkForSnapshot());
    let interrupted: ExactFsTree | undefined;
    try {
      reference.fs.armPersistFailure(Number.MAX_SAFE_INTEGER, 'quota-report');
      await fresh(reference);
      interrupted = reference.fs.durabilityBoundaries.find(
        ({ durableState }) =>
          durableState.files[transactionFile] !== undefined &&
          durableState.files[`${scratchRoot}/main.cjs`] !== undefined &&
          durableState.files[catalogFile] === undefined,
      )?.durableState;
      expect(interrupted, 'actual prepared journal must precede catalog commit').toBeDefined();
    } finally {
      await reference.close();
    }
    if (interrupted === undefined) throw new Error('actual journal-owned boundary absent');
    const h = await openSnapshotOnlyOwner(
      networkForSnapshot(),
      createDurableOwnerFsFromTree(interrupted),
    );
    try {
      expect(h.catalog.snapshot().scratch).toBeNull();
      expect(h.authority.statSyncOrNull(container)).toBeNull();
      expect(h.authority.statSyncOrNull(transactionFile)).toBeNull();
      await fresh(h);
      expect(await recovery(h.catalog).listRetainedScratch()).toEqual([]);
    } finally {
      await h.close();
    }
  });

  it.each(['container-file', 'tree-file', 'missing-tree'] as const)(
    'preserves malformed %s layout loudly',
    async (kind) => {
      const fs = new DurableOwnerFs();
      writeRaw(
        fs,
        kind === 'container-file'
          ? container
          : kind === 'tree-file'
            ? scratchRoot
            : `${container}/unexpected.bin`,
        binary,
      );
      await fs.flush();
      const h = await openSnapshotOnlyOwner(networkForSnapshot(), fs);
      const before = h.fs.durableSnapshot();
      try {
        await expect(fresh(h)).rejects.toThrow();
        expect(h.catalog.snapshot().scratch).toBeNull();
        expect(h.fs.liveSnapshot()).toEqual(before);
        expect(h.fs.durableSnapshot()).toEqual(before);
      } finally {
        await h.close();
      }
    },
  );

  it.each(
    ['catalog.json', 'migration-journal.json', 'transaction.json'].flatMap((name) =>
      [false, true].map((populated) => ({ name, populated })),
    ),
  )(
    'refuses metadata directory $name (populated=$populated) before recovery',
    async ({ name, populated }) => {
      const fs = await seedOrphan();
      const path = `/.rifty/workbench/playground/${name}`;
      fs.mkdirSync(path, { recursive: true });
      if (populated) writeRaw(fs, `${path}/sentinel.bin`, binary);
      writeRaw(
        fs,
        '/.rifty/workbench/playground/catalog-transactions/unknown/sentinel.bin',
        binary,
      );
      await fs.flush();
      const before = fs.durableSnapshot();
      let admitted: Owner | undefined;
      let failure: unknown;
      try {
        try {
          admitted = await openSnapshotOnlyOwner(networkForSnapshot(), fs);
        } catch (error) {
          failure = error;
        }
        expect
          .soft(failure, 'malformed metadata must reject owner admission')
          .toBeInstanceOf(Error);
        expect.soft(admitted).toBeUndefined();
        expect.soft(fs.liveSnapshot()).toEqual(before);
        expect.soft(fs.durableSnapshot()).toEqual(before);
      } finally {
        await admitted?.close();
      }
    },
  );

  it('malformed journal never authorizes stealing an otherwise orphan-shaped source', async () => {
    const fs = await seedOrphan();
    writeRaw(fs, transactionFile, encoder.encode('{ invalid catalog transaction'));
    await fs.flush();
    const before = fs.durableSnapshot();
    let admitted: Owner | undefined;
    let failure: unknown;
    try {
      try {
        admitted = await openSnapshotOnlyOwner(networkForSnapshot(), fs);
      } catch (error) {
        failure = error;
      }
      expect.soft(failure, 'malformed journal must reject owner admission').toBeInstanceOf(Error);
      expect
        .soft(admitted, 'journal failure must not authorize a new empty catalog')
        .toBeUndefined();
      expect.soft(fs.existsSync(transactionFile), 'retain malformed journal evidence').toBe(true);
      expect
        .soft(
          fs.existsSync(`${unknownRetainedRoot}/sentinel.bin`),
          'unknown retained roots must never be garbage-collected',
        )
        .toBe(true);
      expect.soft(treeAt(fs.durableSnapshot(), scratchRoot)).toEqual(treeAt(before, scratchRoot));
      expect.soft(fs.liveSnapshot()).toEqual(before);
      expect.soft(fs.durableSnapshot()).toEqual(before);
    } finally {
      await admitted?.close();
    }
  });

  it.each<DurableOwnerFault>(['quota-report', 'permission-rejection'])(
    '%s while copying retained bytes never deletes the source or publishes false success',
    async (fault) => {
      const base = (await seedOrphan()).durableSnapshot();
      const reference = await preservationReference(base);
      const ordinal = ordinalOf(
        reference.trace,
        (entry) =>
          entry.primitive.kind === 'write' &&
          entry.primitive.path === `${reference.retainedRoot}/user.bin`,
      );
      const h = await openSnapshotOnlyOwner(
        networkForSnapshot(),
        createDurableOwnerFsFromTree(base),
      );
      const sourceBefore = treeAt(h.fs.durableSnapshot(), scratchRoot);
      try {
        h.fs.armPersistFailure(ordinal, fault);
        await expect(fresh(h)).rejects.toThrow();
        expect(h.fs.didInjectFailure).toBe(true);
        h.fs.disarmPersistFailure();
        expect(treeAt(h.fs.liveSnapshot(), scratchRoot)).toEqual(sourceBefore);
        expect(treeAt(h.fs.durableSnapshot(), scratchRoot)).toEqual(sourceBefore);
        expect(h.catalog.snapshot().scratch).toBeNull();
        expect(await recovery(h.catalog).listRetainedScratch()).toEqual([]);
      } finally {
        h.fs.disarmPersistFailure();
        await h.close();
      }
      const restarted = await openSnapshotOnlyOwner(
        networkForSnapshot(),
        h.fs.restartFromDurableState(),
      );
      try {
        expect(treeAt(restarted.fs.durableSnapshot(), scratchRoot)).toEqual(sourceBefore);
        await fresh(restarted);
        const selected = await retained(restarted.catalog);
        expectRecovery(await selected.api.exportRetainedScratch(selected.record.id));
      } finally {
        await restarted.close();
      }
    },
  );

  it('fresh creation failure after retention commit leaves its record and download available', async () => {
    const base = (await seedOrphan()).durableSnapshot();
    const reference = await preservationReference(base);
    const ordinal = ordinalOf(reference.trace, (entry) => {
      if (
        entry.primitive.kind !== 'write' ||
        entry.primitive.path !== catalogFile ||
        entry.primitive.bytes === undefined
      )
        return false;
      const catalog = JSON.parse(decoder.decode(entry.primitive.bytes)) as {
        readonly scratch?: unknown;
      };
      return catalog.scratch !== undefined && catalog.scratch !== null;
    });
    const h = await openSnapshotOnlyOwner(networkForSnapshot(), createDurableOwnerFsFromTree(base));
    let stableId = '';
    try {
      h.fs.armPersistFailure(ordinal, 'quota-report');
      await expect(fresh(h)).rejects.toThrow();
      expect(h.fs.didInjectFailure).toBe(true);
      h.fs.disarmPersistFailure();
      expect(h.catalog.snapshot().scratch).toBeNull();
      const selected = await retained(h.catalog);
      stableId = selected.record.id;
      expectRecovery(await selected.api.exportRetainedScratch(stableId));
      expectOrdinaryTree(treeAt(h.fs.durableSnapshot(), selected.root));
    } finally {
      h.fs.disarmPersistFailure();
      await h.close();
    }
    const restarted = await openSnapshotOnlyOwner(
      networkForSnapshot(),
      h.fs.restartFromDurableState(),
    );
    try {
      expect(await recovery(restarted.catalog).listRetainedScratch()).toEqual([{ id: stableId }]);
      await fresh(restarted);
      expect(await recovery(restarted.catalog).listRetainedScratch()).toEqual([{ id: stableId }]);
      expectRecovery(await recovery(restarted.catalog).exportRetainedScratch(stableId));
    } finally {
      await restarted.close();
    }
  });

  it('unknown ids and owner close reject without consuming retained records', async () => {
    const h = await openSnapshotOnlyOwner(networkForSnapshot(), await seedOrphan());
    let stableId = '';
    try {
      await fresh(h);
      const selected = await retained(h.catalog);
      stableId = selected.record.id;
      const before = h.fs.durableSnapshot();
      await expect(selected.api.exportRetainedScratch('unknown-retained-id')).rejects.toThrow(
        /unknown|absent|not found|retained/i,
      );
      await expect(selected.api.exportRetainedScratch('../scratch')).rejects.toThrow();
      expect(await selected.api.listRetainedScratch()).toEqual([{ id: stableId }]);
      expect(h.fs.liveSnapshot()).toEqual(before);
      expect(h.fs.durableSnapshot()).toEqual(before);
      await h.close();
      await expect(selected.api.listRetainedScratch()).rejects.toThrow(/closed/i);
      await expect(selected.api.exportRetainedScratch(stableId)).rejects.toThrow(/closed/i);
      expect(h.fs.durableSnapshot()).toEqual(before);
    } finally {
      await h.close();
    }
    const restarted = await openSnapshotOnlyOwner(
      networkForSnapshot(),
      h.fs.restartFromDurableState(),
    );
    try {
      expectRecovery(await recovery(restarted.catalog).exportRetainedScratch(stableId));
    } finally {
      await restarted.close();
    }
  });

  it('retains a real over-file-cap orphan independently of export allocation limits', async () => {
    const network = networkForSnapshot();
    const fs = new MemoryFsSync();
    const oversized = new Uint8Array(16 * 1024 * 1024 + 1);
    for (let index = 0; index < oversized.length; index++)
      oversized[index] = (index * 37 + 17) % 256;
    fs.mkdirSync(scratchRoot, { recursive: true });
    fs.writeFileSync(`${scratchRoot}/oversize.bin`, oversized);
    fs.writeFileSync(`${scratchRoot}/main.cjs`, encoder.encode("console.log('orphan');\n"));
    const sourceDigest = createHash('sha256')
      .update(fs.readFileBytesSync(`${scratchRoot}/oversize.bin`))
      .digest('hex');
    expect(sourceDigest).toBe(createHash('sha256').update(oversized).digest('hex'));

    // Standard MemoryFsSync avoids the durable fault fixture's repeated full-tree snapshots.
    const composition = createOwnerVfsAuthorityComposition(fs, { initialRoots: ['/', '/.rifty'] });
    const vfs = new SyncMirrorVfs();
    setSyncMirror(composition.authority, { async: vfs });
    const packages = createOwnerPackageState({
      vfs,
      fsSync: composition.authority,
      installStampClaims: composition.installStampClaims,
      flush: () => composition.authority.flush(),
      nodeWorkerRuntimeEnv: {},
      log: () => {},
    });
    const owner = await createPlaygroundProjectAuthority({
      ...composition,
      persistence: 'ephemeral',
      now: () => '2026-09-09T00:00:00.000Z',
      createStageId: () => crypto.randomUUID(),
      acquisition: {
        ensure: (request) =>
          packages.activateAndEnsure(
            workbenchFirstMaterializationPackageConfig(request, composition.authority),
            request.snapshotAdmission,
          ),
      },
      projectSave: packages,
    });
    const catalog = createPlaygroundProjectCatalog(owner);
    const definition = savedSnapshotDefinition('scratch', snapshot.descriptor);
    let opened: OpenedPlaygroundProject | undefined;
    try {
      await catalog.createScratch({ definition });
      const selected = await retained(catalog);
      const retainedPath = `${selected.root}/oversize.bin`;
      expect(fs.statSync(retainedPath).size).toBe(oversized.byteLength);
      expect(createHash('sha256').update(fs.readFileBytesSync(retainedPath)).digest('hex')).toBe(
        sourceDigest,
      );
      await expect(selected.api.exportRetainedScratch(selected.record.id)).rejects.toThrow(
        /file.*byte limit/i,
      );
      expect(await selected.api.listRetainedScratch()).toEqual([{ id: selected.record.id }]);
      expect(fs.statSync(retainedPath).size).toBe(oversized.byteLength);
      expect(createHash('sha256').update(fs.readFileBytesSync(retainedPath)).digest('hex')).toBe(
        sourceDigest,
      );
      opened = await owner.openProject(definition);
      expect(opened.acquisition).toMatchObject({
        kind: 'ready',
        provenance: { outcome: 'snapshot', packages: 1 },
      });
      expect(decoder.decode(fs.readFileBytesSync(`${scratchRoot}/main.cjs`))).toBe(
        savedSnapshotSource,
      );
      expect(fs.statSyncOrNull(`${scratchRoot}/oversize.bin`)).toBeNull();
      const stamp = readInstallStampSync(composition.authority, scratchRoot);
      expect(stamp !== null && stampTrusted(stamp)).toBe(true);
      expect(network.requests).toEqual([snapshot.descriptor.assetUrl]);
    } finally {
      await opened?.close();
      await owner.close();
      await packages.quiesce();
    }
  });
});
