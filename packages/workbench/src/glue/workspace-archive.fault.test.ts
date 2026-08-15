/**
 * Fault rows for the restore mkdir dedup (backlog
 * playground/restore-mkdir-persist-dedup, issue #256): `quota-perm-fail`,
 * `concurrent-same-key`, and `poisoned-cache` at the Storage boundary,
 * driven through the REAL `applyWorkspaceArchive` /
 * `prepareWorkspaceArchiveImport` over the REAL `OpfsFsSync` — faked only at
 * the OPFS handle boundary (Node has no OPFS). ONE shared disk authority
 * backs both fake surfaces: directories and file bytes live in a single
 * `FakeDisk`, so a recursive removal through EITHER the root handle or the
 * paired surface clears descendants coherently, like real OPFS
 * (sibling-drift guard vs the split-authority fake the attempt-6 review
 * caught).
 */
import { OpfsFsSync } from '@riftydev/vfs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type WorkspaceArchiveV1,
  applyWorkspaceArchive,
  prepareWorkspaceArchiveImport,
} from './workspace-archive.ts';

class DomError extends Error {
  constructor(name: string) {
    super(name);
    this.name = name;
  }
}

/** ONE disk: dirs + file bytes. Every fake below mutates only this. */
interface FakeDisk {
  readonly dirs: Set<string>;
  readonly files: Map<string, Uint8Array>;
}

function buildFakeDisk(): FakeDisk {
  return { dirs: new Set(['/']), files: new Map() };
}

/** Recursive removal of `path` from the ONE disk — dirs AND bytes, exactly
 * like real OPFS `removeEntry(..., {recursive:true})`. */
function removeSubtreeFromDisk(disk: FakeDisk, path: string): void {
  for (const dir of [...disk.dirs]) {
    if (dir === path || dir.startsWith(`${path}/`)) disk.dirs.delete(dir);
  }
  for (const file of [...disk.files.keys()]) {
    if (file === path || file.startsWith(`${path}/`)) disk.files.delete(file);
  }
}

/** Minimal injectable OPFS root over the shared disk + quota fault toggle.
 * Boundary decorator per fault-classes.md — one fault, one boundary. */
function buildInjectableRoot(
  disk: FakeDisk,
  state: { failCreates: boolean },
): FileSystemDirectoryHandle {
  function makeDir(prefix: string): FileSystemDirectoryHandle {
    const handle = {
      kind: 'directory' as const,
      name: prefix === '/' ? '' : (prefix.split('/').pop() ?? ''),
      isSameEntry: () => Promise.resolve(false),
      getFileHandle: () => Promise.reject(new DomError('NotFoundError')),
      getDirectoryHandle(name: string, options?: { create?: boolean }) {
        const fullPath = prefix === '/' ? `/${name}` : `${prefix}/${name}`;
        if (disk.dirs.has(fullPath)) return Promise.resolve(makeDir(fullPath));
        if (!options?.create) return Promise.reject(new DomError('NotFoundError'));
        if (state.failCreates) return Promise.reject(new DomError('QuotaExceededError'));
        disk.dirs.add(fullPath);
        return Promise.resolve(makeDir(fullPath));
      },
      removeEntry(name: string) {
        const fullPath = prefix === '/' ? `/${name}` : `${prefix}/${name}`;
        if (!disk.dirs.has(fullPath) && !disk.files.has(fullPath)) {
          return Promise.reject(new DomError('NotFoundError'));
        }
        removeSubtreeFromDisk(disk, fullPath);
        return Promise.resolve();
      },
      resolve: () => Promise.resolve([] as string[]),
      [Symbol.asyncIterator]() {
        return { next: () => Promise.resolve({ value: undefined, done: true as const }) };
      },
    };
    return handle as unknown as FileSystemDirectoryHandle;
  }

  return makeDir('/');
}

/** Paired surface over the SAME disk, honouring real OPFS semantics:
 * writeFile creates NO parents (opfs.ts) — a write into a dir missing on
 * disk fails. Typed structurally: OpfsFsSync's paired-surface parameter
 * accepts this shape (the named type is deliberately not on the vfs public
 * entry). `onWrite` fires after a successful write — the foreign-rm
 * injection point for row (f). */
function parentCheckingSurface(disk: FakeDisk, onWrite?: (path: string) => void) {
  const writes: string[] = [];
  return {
    writes,
    readFile: (path: string) => {
      const bytes = disk.files.get(path);
      return bytes ? Promise.resolve(bytes.slice()) : Promise.reject(new DomError('NotFoundError'));
    },
    writeFile: (path: string, data: Uint8Array) => {
      const parent = path.slice(0, path.lastIndexOf('/')) || '/';
      if (!disk.dirs.has(parent)) return Promise.reject(new DomError('NotFoundError'));
      disk.files.set(path, data.slice());
      writes.push(path);
      onWrite?.(path);
      return Promise.resolve();
    },
    rm: (path: string) => {
      removeSubtreeFromDisk(disk, path);
      return Promise.resolve();
    },
  };
}

/** Byte-complete oracle: every archive file's bytes are on the ONE disk,
 * except the explicitly `absent` ones which must NOT be. */
function expectArchiveOnDisk(
  disk: FakeDisk,
  archive: WorkspaceArchiveV1,
  absent: readonly string[] = [],
): void {
  for (const file of archive.files) {
    const target = `/ws/${file.path}`;
    const onDisk = disk.files.get(target);
    if (absent.includes(file.path)) {
      expect(onDisk, `${target} must be absent`).toBeUndefined();
    } else {
      expect(onDisk, `${target} must be present`).toBeDefined();
      expect(Buffer.from(onDisk as Uint8Array).toString('base64')).toBe(file.content);
    }
  }
}

function archiveFile(path: string, text: string): WorkspaceArchiveV1['files'][number] {
  return { path, encoding: 'base64', content: Buffer.from(text).toString('base64') };
}

const ARCHIVE: WorkspaceArchiveV1 = {
  version: 1,
  root: '/ws',
  files: [
    archiveFile('a/f1.js', 'f1'),
    archiveFile('a/f2.js', 'f2'),
    archiveFile('a/deep/h1.js', 'h1'),
    archiveFile('b/g1.js', 'g1'),
  ],
};

describe('workspace archive restore over OpfsFsSync — Storage-boundary fault rows (#256 mkdir-dedup)', () => {
  beforeEach(() => vi.spyOn(OpfsFsSync, 'isSupported').mockReturnValue(true));
  afterEach(() => vi.restoreAllMocks());

  function freshSetup(onWrite?: (path: string) => void) {
    const disk = buildFakeDisk();
    const state = { failCreates: false };
    const surface = parentCheckingSurface(disk, onWrite);
    const fs = new OpfsFsSync(buildInjectableRoot(disk, state), surface);
    return { disk, state, surface, fs };
  }

  it('row a: a quota-struck restore reports dirty — the stamp gate sees the divergence, the mirror stays live', async () => {
    const { disk, state, fs } = freshSetup();

    state.failCreates = true;
    applyWorkspaceArchive(fs, ARCHIVE);
    const dirty = await fs.flush();

    expect(dirty.total).toBeGreaterThan(0);
    expect(dirty.anyFailure?.((path) => path.startsWith('/ws'))).toBe(true);
    // Sync mirror serves the restore regardless — honesty lives in the report.
    expect(fs.existsSync('/ws/a/deep/h1.js')).toBe(true);
    expect(disk.dirs.has('/ws/a')).toBe(false); // disk really lags
    expect(disk.files.size).toBe(0); // and no byte pretends otherwise
  });

  it('row b: re-running the SAME restore after the fault clears heals — I2 heal-on-retry through the dedup', async () => {
    const { disk, state, fs } = freshSetup();

    state.failCreates = true;
    applyWorkspaceArchive(fs, ARCHIVE);
    expect((await fs.flush()).total).toBeGreaterThan(0);

    state.failCreates = false;
    applyWorkspaceArchive(fs, ARCHIVE); // the real retry path: replace + re-apply
    const healed = await fs.flush();

    expect(healed.total).toBe(0);
    expect(healed.failures).toEqual([]);
    expect(disk.dirs.has('/ws/a/deep')).toBe(true);
    expect(disk.dirs.has('/ws/b')).toBe(true);
    expectArchiveOnDisk(disk, ARCHIVE); // byte-complete recovery on the ONE disk
  });

  it('row g: ONE prepared import applied, quota-struck, then re-applied heals — dedup state is per-apply, never prepare-scoped', async () => {
    // poisoned-cache × apply lifecycle: a first-seen Set captured at PREPARE
    // scope would suppress every mkdir on the second apply() after the root
    // replacement — writes into never-recreated dirs would fail forever.
    const { disk, state, fs } = freshSetup();
    const prepared = prepareWorkspaceArchiveImport(fs, ARCHIVE);

    state.failCreates = true;
    prepared.apply();
    expect((await fs.flush()).total).toBeGreaterThan(0);

    state.failCreates = false;
    prepared.apply(); // SAME prepared import — full mkdir set must re-run
    const healed = await fs.flush();

    expect(healed.total).toBe(0);
    expect(disk.dirs.has('/ws/a/deep')).toBe(true);
    expectArchiveOnDisk(disk, ARCHIVE);
  });

  // Row (f), concurrent-same-key × foreign rm mid-drain. Ground truth first:
  // a clean flush CANNOT attest bytes a foreign realm deleted after their
  // successful persist — that hole exists ON MAIN (the redundant per-file
  // mkdir recreates the PARENT, nobody re-writes the removed file) and is the
  // captured cross-realm class (vfs/opfs-sync-cross-realm-mirror-coherence).
  // The honest outcome this unit owns is DIFFERENTIAL: the dedup is never
  // QUIETER than main on the same schedule — where main silently self-repairs
  // the parent and drops the file, the dedup's end state is identical or
  // reports dirty — and a user-level restore retry recovers byte-complete.

  it('row f, same-dir schedule: foreign rm between two same-dir writes → the dedup reports DIRTY (main silently self-repaired); retry recovers every byte', async () => {
    let injected = false;
    const { disk, fs } = freshSetup((path) => {
      if (path === '/ws/a/f1.js' && !injected) {
        injected = true;
        removeSubtreeFromDisk(disk, '/ws/a'); // foreign realm: dirs AND bytes
      }
    });

    applyWorkspaceArchive(fs, ARCHIVE);
    const report = await fs.flush();

    // '/ws/a/f2.js' follows in the same dir: without main's redundant mkdir
    // its write fails on the missing parent — LOUDER than main, never quieter.
    expect(report.total).toBeGreaterThan(0);
    expect(report.anyFailure?.((path) => path.startsWith('/ws'))).toBe(true);

    applyWorkspaceArchive(fs, ARCHIVE); // user-level retry: replace + re-apply
    expect((await fs.flush()).total).toBe(0);
    expect(disk.dirs.has('/ws/a/deep')).toBe(true);
    expectArchiveOnDisk(disk, ARCHIVE); // byte-complete recovery
  });

  it('row f, adversarial interleaving: a later distinct-dirname chain recreates the removed parent → end state IDENTICAL to main (clean flush, foreign-removed file absent — the shared main-level hole), retry recovers', async () => {
    // Schedule: write a/f1 → foreign rm '/ws/a' → mkdir a/deep (recursive,
    // recreates '/ws/a') → write a/deep/h1 → ... On MAIN the trace differs
    // only by no-op duplicate mkdirs: nothing re-writes f1 either, so main
    // also ends CLEAN with f1 absent. The dedup must match that end state
    // exactly — no NEW silent loss beyond the captured class.
    const archive: WorkspaceArchiveV1 = {
      version: 1,
      root: '/ws',
      files: [
        archiveFile('a/f1.js', 'f1'),
        archiveFile('a/deep/h1.js', 'h1'),
        archiveFile('b/g1.js', 'g1'),
      ],
    };
    let injected = false;
    const { disk, fs } = freshSetup((path) => {
      if (path === '/ws/a/f1.js' && !injected) {
        injected = true;
        removeSubtreeFromDisk(disk, '/ws/a'); // foreign realm: dirs AND bytes
      }
    });

    applyWorkspaceArchive(fs, archive);
    const report = await fs.flush();

    // Main-identical end state: clean report, h1/g1 bytes present, f1 bytes
    // really gone from the ONE disk (not retained by a stale fake).
    expect(report.total).toBe(0);
    expect(disk.dirs.has('/ws/a')).toBe(true); // recreated by the a/deep chain
    expectArchiveOnDisk(disk, archive, ['a/f1.js']);

    applyWorkspaceArchive(fs, archive); // retry recovers the lost byte too
    expect((await fs.flush()).total).toBe(0);
    expectArchiveOnDisk(disk, archive);
  });
});
