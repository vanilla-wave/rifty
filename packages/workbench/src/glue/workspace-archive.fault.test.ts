/**
 * Fault rows for the restore mkdir dedup (backlog
 * playground/restore-mkdir-persist-dedup, issue #256): `quota-perm-fail` at
 * the Storage boundary, driven through the REAL `applyWorkspaceArchive` over
 * the REAL `OpfsFsSync` — faked only at the OPFS handle boundary (Node has no
 * OPFS). Rows (a)+(b) of the item's `## Fault matrix`: a quota-struck restore
 * reports dirty (stamp-gate honest), and re-running the SAME restore after
 * the fault clears heals the ledger (epic I2 heal-on-retry preserved through
 * the dedup — `OpfsFsSync.mkdirSync` persist semantics are untouched by this
 * item).
 */
import { OpfsFsSync } from '@riftydev/vfs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type WorkspaceArchiveV1, applyWorkspaceArchive } from './workspace-archive.ts';

class DomError extends Error {
  constructor(name: string) {
    super(name);
    this.name = name;
  }
}

/** Minimal injectable OPFS root: dirs-set semantics + quota fault toggle.
 * Boundary decorator per fault-classes.md — one fault, one boundary. */
function buildInjectableRoot(): {
  root: FileSystemDirectoryHandle;
  dirs: Set<string>;
  state: { failCreates: boolean };
} {
  const dirs = new Set<string>(['/']);
  const state = { failCreates: false };

  function makeDir(prefix: string): FileSystemDirectoryHandle {
    const handle = {
      kind: 'directory' as const,
      name: prefix === '/' ? '' : (prefix.split('/').pop() ?? ''),
      isSameEntry: () => Promise.resolve(false),
      getFileHandle: () => Promise.reject(new DomError('NotFoundError')),
      getDirectoryHandle(name: string, options?: { create?: boolean }) {
        const fullPath = prefix === '/' ? `/${name}` : `${prefix}/${name}`;
        if (dirs.has(fullPath)) return Promise.resolve(makeDir(fullPath));
        if (!options?.create) return Promise.reject(new DomError('NotFoundError'));
        if (state.failCreates) return Promise.reject(new DomError('QuotaExceededError'));
        dirs.add(fullPath);
        return Promise.resolve(makeDir(fullPath));
      },
      removeEntry(name: string) {
        const fullPath = prefix === '/' ? `/${name}` : `${prefix}/${name}`;
        if (!dirs.has(fullPath)) return Promise.reject(new DomError('NotFoundError'));
        for (const dir of [...dirs]) {
          if (dir === fullPath || dir.startsWith(`${fullPath}/`)) dirs.delete(dir);
        }
        return Promise.resolve();
      },
      resolve: () => Promise.resolve([] as string[]),
      [Symbol.asyncIterator]() {
        return { next: () => Promise.resolve({ value: undefined, done: true as const }) };
      },
    };
    return handle as unknown as FileSystemDirectoryHandle;
  }

  return { root: makeDir('/'), dirs, state };
}

/** Paired surface honouring real OPFS semantics with a FILE-COMPLETE disk
 * model: `files` holds the actual on-"disk" bytes, writeFile creates NO
 * parents (opfs.ts) — a write into a dir missing on disk fails. Typed
 * structurally: OpfsFsSync's paired-surface parameter accepts this shape
 * (the named type is deliberately not on the vfs public entry). `onWrite`
 * fires after a successful write — the foreign-rm injection point for
 * row (f). */
function parentCheckingSurface(dirs: Set<string>, onWrite?: (path: string) => void) {
  const files = new Map<string, Uint8Array>();
  const writes: string[] = [];
  return {
    files,
    writes,
    readFile: (path: string) => {
      const bytes = files.get(path);
      return bytes ? Promise.resolve(bytes.slice()) : Promise.reject(new DomError('NotFoundError'));
    },
    writeFile: (path: string, data: Uint8Array) => {
      const parent = path.slice(0, path.lastIndexOf('/')) || '/';
      if (!dirs.has(parent)) return Promise.reject(new DomError('NotFoundError'));
      files.set(path, data.slice());
      writes.push(path);
      onWrite?.(path);
      return Promise.resolve();
    },
    rm: (path: string) => {
      for (const dir of [...dirs]) {
        if (dir === path || dir.startsWith(`${path}/`)) dirs.delete(dir);
      }
      for (const file of [...files.keys()]) {
        if (file === path || file.startsWith(`${path}/`)) files.delete(file);
      }
      return Promise.resolve();
    },
  };
}

/** Removes a subtree from the fake DISK exactly like a foreign realm's
 * recursive rm: directories AND file bytes under `path` vanish. */
function foreignRm(
  fake: { dirs: Set<string> },
  surface: { files: Map<string, Uint8Array> },
  path: string,
): void {
  for (const dir of [...fake.dirs]) {
    if (dir === path || dir.startsWith(`${path}/`)) fake.dirs.delete(dir);
  }
  for (const file of [...surface.files.keys()]) {
    if (file === path || file.startsWith(`${path}/`)) surface.files.delete(file);
  }
}

/** Byte-complete oracle: every archive file's bytes are on the fake disk,
 * except the explicitly `absent` ones which must NOT be. */
function expectArchiveOnDisk(
  surface: { files: Map<string, Uint8Array> },
  archive: WorkspaceArchiveV1,
  absent: readonly string[] = [],
): void {
  for (const file of archive.files) {
    const target = `/ws/${file.path}`;
    const onDisk = surface.files.get(target);
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

describe('workspace archive restore over OpfsFsSync — quota-perm-fail (Storage boundary)', () => {
  beforeEach(() => vi.spyOn(OpfsFsSync, 'isSupported').mockReturnValue(true));
  afterEach(() => vi.restoreAllMocks());

  it('row a: a quota-struck restore reports dirty — the stamp gate sees the divergence, the mirror stays live', async () => {
    const fake = buildInjectableRoot();
    const surface = parentCheckingSurface(fake.dirs);
    const fs = new OpfsFsSync(fake.root, surface);

    fake.state.failCreates = true;
    applyWorkspaceArchive(fs, ARCHIVE);
    const dirty = await fs.flush();

    expect(dirty.total).toBeGreaterThan(0);
    expect(dirty.anyFailure?.((path) => path.startsWith('/ws'))).toBe(true);
    // Sync mirror serves the restore regardless — honesty lives in the report.
    expect(fs.existsSync('/ws/a/deep/h1.js')).toBe(true);
    expect(fake.dirs.has('/ws/a')).toBe(false); // disk really lags
  });

  it('row b: re-running the SAME restore after the fault clears heals — I2 heal-on-retry through the dedup', async () => {
    const fake = buildInjectableRoot();
    const surface = parentCheckingSurface(fake.dirs);
    const fs = new OpfsFsSync(fake.root, surface);

    fake.state.failCreates = true;
    applyWorkspaceArchive(fs, ARCHIVE);
    expect((await fs.flush()).total).toBeGreaterThan(0);

    fake.state.failCreates = false;
    applyWorkspaceArchive(fs, ARCHIVE); // the real retry path: replace + re-apply
    const healed = await fs.flush();

    expect(healed.total).toBe(0);
    expect(healed.failures).toEqual([]);
    expect(fake.dirs.has('/ws/a')).toBe(true);
    expect(fake.dirs.has('/ws/a/deep')).toBe(true);
    expect(fake.dirs.has('/ws/b')).toBe(true);
    expect(surface.writes).toContain('/ws/a/deep/h1.js');
    expect(surface.writes).toContain('/ws/b/g1.js');
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
    const fake = buildInjectableRoot();
    let injected = false;
    const surface: ReturnType<typeof parentCheckingSurface> = parentCheckingSurface(
      fake.dirs,
      (path) => {
        if (path === '/ws/a/f1.js' && !injected) {
          injected = true;
          foreignRm(fake, surface, '/ws/a');
        }
      },
    );
    const fs = new OpfsFsSync(fake.root, surface);

    applyWorkspaceArchive(fs, ARCHIVE);
    const report = await fs.flush();

    // '/ws/a/f2.js' follows in the same dir: without main's redundant mkdir
    // its write fails on the missing parent — LOUDER than main, never quieter.
    expect(report.total).toBeGreaterThan(0);
    expect(report.anyFailure?.((path) => path.startsWith('/ws'))).toBe(true);

    applyWorkspaceArchive(fs, ARCHIVE); // user-level retry: replace + re-apply
    expect((await fs.flush()).total).toBe(0);
    expect(fake.dirs.has('/ws/a/deep')).toBe(true);
    expectArchiveOnDisk(surface, ARCHIVE); // byte-complete recovery
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
    const fake = buildInjectableRoot();
    let injected = false;
    const surface: ReturnType<typeof parentCheckingSurface> = parentCheckingSurface(
      fake.dirs,
      (path) => {
        if (path === '/ws/a/f1.js' && !injected) {
          injected = true;
          foreignRm(fake, surface, '/ws/a');
        }
      },
    );
    const fs = new OpfsFsSync(fake.root, surface);

    applyWorkspaceArchive(fs, archive);
    const report = await fs.flush();

    // Main-identical end state: clean report, h1/g1 bytes present, f1 gone.
    expect(report.total).toBe(0);
    expect(fake.dirs.has('/ws/a')).toBe(true); // recreated by the a/deep chain
    expectArchiveOnDisk(surface, archive, ['a/f1.js']);

    applyWorkspaceArchive(fs, archive); // retry recovers the lost byte too
    expect((await fs.flush()).total).toBe(0);
    expectArchiveOnDisk(surface, archive);
  });
});
