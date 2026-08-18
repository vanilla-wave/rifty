/**
 * Fault rows for the restore mkdir dedup (backlog
 * playground/restore-mkdir-persist-dedup, issue #256): `quota-perm-fail`,
 * `concurrent-same-key`, and `poisoned-cache` at the Storage boundary,
 * driven through the REAL `applyWorkspaceArchive` /
 * `prepareWorkspaceArchiveImport` over the REAL `OpfsFsSync` paired with the
 * REAL `OpfsVfs`. The ONLY fake is the browser FileSystem handle tree —
 * the unavoidable external boundary in Node (same injection pattern as
 * `packages/vfs/src/vfs-async-contract.test.ts`) — and BOTH real surfaces
 * share ONE fake tree, so recursive removals clear directories and bytes
 * coherently like real OPFS. No sibling rifty package is mocked.
 */
import { OpfsFsSync, OpfsVfs } from '@riftydev/vfs';
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

interface FakeFile {
  kind: 'file';
  bytes: Uint8Array;
}
interface FakeDir {
  kind: 'dir';
  children: Map<string, FakeFile | FakeDir>;
}

interface FaultState {
  /** Reject create-requested getDirectoryHandle with QuotaExceededError. */
  failCreates: boolean;
  /** Fires after a successful file write lands — row (f) injection point. */
  onWrite?: (path: string) => void;
  /** Full paths of successfully landed file writes. */
  readonly writes: string[];
}

/** ONE disk: a FakeDir tree; both the OpfsFsSync root handle and the real
 * OpfsVfs operate on handles over this same tree. */
function buildFakeDisk(): { tree: FakeDir; state: FaultState } {
  return {
    tree: { kind: 'dir', children: new Map() },
    state: { failCreates: false, writes: [] },
  };
}

function makeRootHandle(tree: FakeDir, state: FaultState): FileSystemDirectoryHandle {
  function fileHandle(f: FakeFile, path: string): FileSystemFileHandle {
    return {
      kind: 'file',
      name: path.split('/').pop() ?? '',
      isSameEntry: () => Promise.resolve(false),
      getFile: () =>
        Promise.resolve({
          size: f.bytes.byteLength,
          lastModified: 0,
          arrayBuffer: () =>
            Promise.resolve(
              f.bytes.buffer.slice(f.bytes.byteOffset, f.bytes.byteOffset + f.bytes.byteLength),
            ),
        } as unknown as File),
      createWritable: () => {
        const chunks: Uint8Array[] = [];
        return Promise.resolve({
          write: (data: Uint8Array) => {
            chunks.push(data instanceof Uint8Array ? data.slice() : new Uint8Array(data));
            return Promise.resolve();
          },
          close: () => {
            const total = chunks.reduce((n, c) => n + c.byteLength, 0);
            const merged = new Uint8Array(total);
            let offset = 0;
            for (const chunk of chunks) {
              merged.set(chunk, offset);
              offset += chunk.byteLength;
            }
            f.bytes = merged;
            state.writes.push(path);
            state.onWrite?.(path);
            return Promise.resolve();
          },
        } as unknown as FileSystemWritableFileStream);
      },
    } as unknown as FileSystemFileHandle;
  }

  function dirHandle(d: FakeDir, prefix: string): FileSystemDirectoryHandle {
    const handle = {
      kind: 'directory' as const,
      name: prefix === '' ? '' : (prefix.split('/').pop() ?? ''),
      isSameEntry: () => Promise.resolve(false),
      getDirectoryHandle(child: string, options?: { create?: boolean }) {
        const node = d.children.get(child);
        const childPath = `${prefix}/${child}`;
        if (node) {
          if (node.kind !== 'dir') return Promise.reject(new DomError('TypeMismatchError'));
          return Promise.resolve(dirHandle(node, childPath));
        }
        if (!options?.create) return Promise.reject(new DomError('NotFoundError'));
        if (state.failCreates) return Promise.reject(new DomError('QuotaExceededError'));
        const created: FakeDir = { kind: 'dir', children: new Map() };
        d.children.set(child, created);
        return Promise.resolve(dirHandle(created, childPath));
      },
      getFileHandle(child: string, options?: { create?: boolean }) {
        const node = d.children.get(child);
        const childPath = `${prefix}/${child}`;
        if (node) {
          if (node.kind !== 'file') return Promise.reject(new DomError('TypeMismatchError'));
          return Promise.resolve(fileHandle(node, childPath));
        }
        if (!options?.create) return Promise.reject(new DomError('NotFoundError'));
        const created: FakeFile = { kind: 'file', bytes: new Uint8Array() };
        d.children.set(child, created);
        return Promise.resolve(fileHandle(created, childPath));
      },
      removeEntry(child: string, options?: { recursive?: boolean }) {
        const node = d.children.get(child);
        if (!node) return Promise.reject(new DomError('NotFoundError'));
        if (node.kind === 'dir' && node.children.size > 0 && !options?.recursive) {
          return Promise.reject(new DomError('InvalidModificationError'));
        }
        d.children.delete(child);
        return Promise.resolve();
      },
      resolve: () => Promise.resolve([] as string[]),
      [Symbol.asyncIterator]() {
        const entries = [...d.children.entries()].sort(([a], [b]) => (a < b ? -1 : 1));
        let i = 0;
        return {
          next: (): Promise<IteratorResult<[string, FileSystemHandle]>> => {
            if (i >= entries.length) return Promise.resolve({ value: undefined, done: true });
            const [childName, node] = entries[i++] as [string, FakeFile | FakeDir];
            const childPath = `${prefix}/${childName}`;
            const childHandle =
              node.kind === 'dir' ? dirHandle(node, childPath) : fileHandle(node, childPath);
            return Promise.resolve({
              value: [childName, childHandle] as [string, FileSystemHandle],
              done: false,
            });
          },
        };
      },
    };
    return handle as unknown as FileSystemDirectoryHandle;
  }

  return dirHandle(tree, '');
}

function diskNode(tree: FakeDir, path: string): FakeFile | FakeDir | undefined {
  let node: FakeFile | FakeDir = tree;
  for (const segment of path.split('/').filter(Boolean)) {
    if (node.kind !== 'dir') return undefined;
    const next = node.children.get(segment);
    if (!next) return undefined;
    node = next;
  }
  return node;
}

/** Foreign realm's recursive rm: dirs AND bytes vanish from the ONE tree. */
function foreignRm(tree: FakeDir, path: string): void {
  const segments = path.split('/').filter(Boolean);
  const leaf = segments.pop();
  if (!leaf) return;
  const parent = diskNode(tree, `/${segments.join('/')}`);
  if (parent?.kind === 'dir') parent.children.delete(leaf);
}

/** Byte-complete oracle: every archive file's bytes are on the ONE disk,
 * except the explicitly `absent` ones which must NOT be. */
function expectArchiveOnDisk(
  tree: FakeDir,
  archive: WorkspaceArchiveV1,
  absent: readonly string[] = [],
): void {
  for (const file of archive.files) {
    const target = `/ws/${file.path}`;
    const node = diskNode(tree, target);
    if (absent.includes(file.path)) {
      expect(node, `${target} must be absent`).toBeUndefined();
    } else {
      expect(node?.kind, `${target} must be a file`).toBe('file');
      expect(Buffer.from((node as FakeFile).bytes).toString('base64')).toBe(file.content);
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

describe('workspace archive restore over OpfsFsSync + real OpfsVfs — Storage-boundary fault rows (#256 mkdir-dedup)', () => {
  beforeEach(() => vi.spyOn(OpfsFsSync, 'isSupported').mockReturnValue(true));
  afterEach(() => vi.restoreAllMocks());

  function freshSetup() {
    const { tree, state } = buildFakeDisk();
    const rootHandle = makeRootHandle(tree, state);
    // REAL sibling OpfsVfs over the same fake handle tree (the injection
    // pattern from vfs-async-contract.test.ts) — init() keeps a pre-set root.
    const vfs = new OpfsVfs();
    (vfs as unknown as { root: FileSystemDirectoryHandle }).root = rootHandle;
    const fs = new OpfsFsSync(rootHandle, vfs);
    return { tree, state, fs };
  }

  it('rows a+b: a quota-struck restore reports dirty (stamp gate honest, mirror live), and re-running it after the fault clears heals byte-complete — I2 heal-on-retry through the dedup', async () => {
    const { tree, state, fs } = freshSetup();

    state.failCreates = true;
    applyWorkspaceArchive(fs, ARCHIVE);
    const dirty = await fs.flush();

    expect(dirty.total).toBeGreaterThan(0);
    expect(dirty.anyFailure?.((path) => path.startsWith('/ws'))).toBe(true);
    // Sync mirror serves the restore regardless — honesty lives in the report.
    expect(fs.existsSync('/ws/a/deep/h1.js')).toBe(true);
    expect(diskNode(tree, '/ws/a')).toBeUndefined(); // disk really lags
    expect(state.writes.length).toBe(0); // and no byte pretends otherwise

    state.failCreates = false;
    applyWorkspaceArchive(fs, ARCHIVE); // the real retry path: replace + re-apply
    const healed = await fs.flush();

    expect(healed.total).toBe(0);
    expect(healed.failures).toEqual([]);
    expect(diskNode(tree, '/ws/a/deep')?.kind).toBe('dir');
    expect(diskNode(tree, '/ws/b')?.kind).toBe('dir');
    expectArchiveOnDisk(tree, ARCHIVE); // byte-complete recovery on the ONE disk
  });

  it('row g: ONE prepared import applied, quota-struck, then re-applied heals — dedup state is per-apply, never prepare-scoped', async () => {
    // poisoned-cache × apply lifecycle: a first-seen Set captured at PREPARE
    // scope would suppress every mkdir on the second apply() after the root
    // replacement — writes into never-recreated dirs would fail forever.
    const { tree, state, fs } = freshSetup();
    const prepared = prepareWorkspaceArchiveImport(fs, ARCHIVE);

    state.failCreates = true;
    prepared.apply();
    expect((await fs.flush()).total).toBeGreaterThan(0);

    state.failCreates = false;
    prepared.apply(); // SAME prepared import — full mkdir set must re-run
    const healed = await fs.flush();

    expect(healed.total).toBe(0);
    expect(diskNode(tree, '/ws/a/deep')?.kind).toBe('dir');
    expectArchiveOnDisk(tree, ARCHIVE);
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
    const { tree, state, fs } = freshSetup();
    let injected = false;
    state.onWrite = (path) => {
      if (path === '/ws/a/f1.js' && !injected) {
        injected = true;
        foreignRm(tree, '/ws/a'); // foreign realm: dirs AND bytes
      }
    };

    applyWorkspaceArchive(fs, ARCHIVE);
    const report = await fs.flush();

    // '/ws/a/f2.js' follows in the same dir: without main's redundant mkdir
    // its write fails on the missing parent — LOUDER than main, never quieter.
    expect(report.total).toBeGreaterThan(0);
    expect(report.anyFailure?.((path) => path.startsWith('/ws'))).toBe(true);

    applyWorkspaceArchive(fs, ARCHIVE); // user-level retry: replace + re-apply
    expect((await fs.flush()).total).toBe(0);
    expectArchiveOnDisk(tree, ARCHIVE); // byte-complete recovery
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
    const { tree, state, fs } = freshSetup();
    let injected = false;
    state.onWrite = (path) => {
      if (path === '/ws/a/f1.js' && !injected) {
        injected = true;
        foreignRm(tree, '/ws/a'); // foreign realm: dirs AND bytes
      }
    };

    applyWorkspaceArchive(fs, archive);
    const report = await fs.flush();

    // Main-identical end state: clean report, h1/g1 bytes present, f1 bytes
    // really gone from the ONE disk (not retained by a stale fake).
    expect(report.total).toBe(0);
    expect(diskNode(tree, '/ws/a')?.kind).toBe('dir'); // recreated by the a/deep chain
    expectArchiveOnDisk(tree, archive, ['a/f1.js']);

    applyWorkspaceArchive(fs, archive); // retry recovers the lost byte too
    expect((await fs.flush()).total).toBe(0);
    expectArchiveOnDisk(tree, archive);
  });
});
