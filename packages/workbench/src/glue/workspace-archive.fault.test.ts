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

/** Paired surface honouring real OPFS semantics: writeFile creates NO parents
 * (opfs.ts) — a write into a dir missing on "disk" fails. Typed structurally:
 * OpfsFsSync's paired-surface parameter accepts this shape (the named type is
 * deliberately not on the vfs public entry). `onWrite` fires after a
 * successful write — the foreign-rm injection point for row (f). */
function parentCheckingSurface(dirs: Set<string>, onWrite?: (path: string) => void) {
  const writes: string[] = [];
  return {
    writes,
    readFile: () => Promise.reject(new DomError('NotFoundError')),
    writeFile: (path: string) => {
      const parent = path.slice(0, path.lastIndexOf('/')) || '/';
      if (!dirs.has(parent)) return Promise.reject(new DomError('NotFoundError'));
      writes.push(path);
      onWrite?.(path);
      return Promise.resolve();
    },
    rm: (path: string) => {
      for (const dir of [...dirs]) {
        if (dir === path || dir.startsWith(`${path}/`)) dirs.delete(dir);
      }
      return Promise.resolve();
    },
  };
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

  it('row f: a FOREIGN rm landing mid-drain is never trusted over — flush is dirty or the tree is really back; retry heals', async () => {
    // concurrent-same-key at the Storage boundary: another realm removes
    // '/ws/a' from disk between two same-dir ops. Main self-repairs via its
    // redundant per-file mkdir persist; the dedup may instead surface a dirty
    // ledger. BOTH are honest — the pinned invariant is that a clean flush
    // NEVER coexists with a missing tree (no provenance lie), and a restore
    // retry recovers. Cross-realm coherence itself has no owner here — class
    // captured in vfs/opfs-sync-cross-realm-mirror-coherence.
    const fake = buildInjectableRoot();
    let injected = false;
    const surface = parentCheckingSurface(fake.dirs, (path) => {
      if (path === '/ws/a/f1.js' && !injected) {
        injected = true;
        for (const dir of [...fake.dirs]) {
          if (dir === '/ws/a' || dir.startsWith('/ws/a/')) fake.dirs.delete(dir);
        }
      }
    });
    const fs = new OpfsFsSync(fake.root, surface);

    applyWorkspaceArchive(fs, ARCHIVE);
    const report = await fs.flush();

    const treeFullyOnDisk =
      fake.dirs.has('/ws/a') &&
      fake.dirs.has('/ws/a/deep') &&
      surface.writes.filter((path) => path === '/ws/a/f2.js').length > 0;
    if (report.total === 0) {
      // A clean report while the foreign-removed subtree is absent would be
      // a provenance lie — clean is only legal when the tree really came back.
      expect(treeFullyOnDisk).toBe(true);
    } else {
      expect(report.anyFailure?.((path) => path.startsWith('/ws'))).toBe(true);
    }

    applyWorkspaceArchive(fs, ARCHIVE); // user-level retry: replace + re-apply
    const healed = await fs.flush();
    expect(healed.total).toBe(0);
    expect(fake.dirs.has('/ws/a/deep')).toBe(true);
    expect(fake.dirs.has('/ws/b')).toBe(true);
  });
});
