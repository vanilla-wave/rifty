/// <reference lib="webworker" />
/**
 * Acceptance fixture for playground/restore-mkdir-persist-dedup (issue #256, epic
 * project-open-drain-latency, invariant I2): restoring an N-file / D-dir
 * archive through the REAL `applyWorkspaceArchive` loop over `OpfsFsSync`
 * enqueues at most one mkdir persist op per distinct dirname (≤ D + 2 with
 * the root mkdir), never ~one per file. Counting sits at the real OPFS
 * boundary — a delegating root-handle wrapper and an `OpfsVfs.writeFile`
 * counter; every byte of I/O is real.
 */
import { OpfsFsSync, OpfsVfs } from '@riftydev/vfs';
import {
  applyWorkspaceArchive,
  type WorkspaceArchiveV1,
} from '../../../packages/workbench/src/glue/workspace-archive.ts';

const scope = globalThis as unknown as DedicatedWorkerGlobalScope;

interface AcceptanceResult {
  readonly fileCount: number;
  readonly dirCount: number;
  readonly mkdirPersistOps: number;
  readonly writeOps: number;
  readonly reportTotal: number;
  readonly tailVerified: boolean;
  readonly applyMs: number;
  readonly flushMs: number;
}

class CountingOpfsVfs extends OpfsVfs {
  writes = 0;

  override async writeFile(path: string, data: Uint8Array | string): Promise<void> {
    this.writes += 1;
    return super.writeFile(path, data);
  }
}

/** Delegates every call to the REAL root handle; counts getDirectoryHandle —
 * each OpfsFsSync persist chain calls it exactly once (first segment). */
function countingRoot(
  real: FileSystemDirectoryHandle,
  counter: { calls: number },
): FileSystemDirectoryHandle {
  const wrapper = {
    kind: 'directory' as const,
    name: real.name,
    isSameEntry: (other: FileSystemHandle) => real.isSameEntry(other),
    getFileHandle: (name: string, options?: { create?: boolean }) =>
      real.getFileHandle(name, options),
    getDirectoryHandle(name: string, options?: { create?: boolean }) {
      counter.calls += 1;
      return real.getDirectoryHandle(name, options);
    },
    removeEntry: (name: string, options?: { recursive?: boolean }) =>
      real.removeEntry(name, options),
    resolve: (handle: FileSystemHandle) => real.resolve(handle),
    [Symbol.asyncIterator]: () =>
      (real as unknown as AsyncIterable<[string, FileSystemHandle]>)[Symbol.asyncIterator](),
  };
  return wrapper as unknown as FileSystemDirectoryHandle;
}

/** Deterministic node_modules-shaped archive: 100 pkgs × 30 files. */
function buildArchive(): {
  archive: WorkspaceArchiveV1;
  fileCount: number;
  dirCount: number;
  tailRel: string;
  tailText: string;
} {
  const files: Array<{ path: string; encoding: 'base64'; content: string }> = [];
  const dirs = new Set<string>();
  const subdirs = ['lib', 'esm', 'internals'];
  let tailRel = '';
  let tailText = '';
  for (let p = 0; p < 100; p++) {
    const pkg = `pkg-${String(p).padStart(3, '0')}`;
    for (let f = 0; f < 30; f++) {
      const sub = subdirs[f % subdirs.length] as string;
      const deep = f % 7 === 0 ? `${sub}/nested` : sub;
      const dir = `node_modules/${pkg}/${deep}`;
      let prefix = '';
      for (const seg of dir.split('/')) {
        prefix = prefix === '' ? seg : `${prefix}/${seg}`;
        dirs.add(prefix);
      }
      const rel = `${dir}/f${String(f).padStart(3, '0')}.js`;
      const text = `export const v_${p}_${f} = ${p * 1000 + f};\n`;
      files.push({ path: rel, encoding: 'base64', content: btoa(text) });
      tailRel = rel;
      tailText = text;
    }
  }
  return {
    archive: { version: 1, root: '/ws', files },
    fileCount: files.length,
    dirCount: dirs.size,
    tailRel,
    tailText,
  };
}

async function runAcceptance(): Promise<AcceptanceResult> {
  const ns = `/mkdir-dedup-256-${crypto.randomUUID()}`;
  const { archive, fileCount, dirCount, tailRel, tailText } = buildArchive();

  const surface = new CountingOpfsVfs();
  await surface.init();
  const storage = (
    navigator as unknown as { storage: { getDirectory(): Promise<FileSystemDirectoryHandle> } }
  ).storage;
  const realRoot = await storage.getDirectory();
  const counter = { calls: 0 };
  const fs = new OpfsFsSync(countingRoot(realRoot, counter), surface);
  await fs.refreshIndex();
  await fs.preloadContent();

  counter.calls = 0;
  surface.writes = 0;
  const t0 = performance.now();
  applyWorkspaceArchive(fs, archive, { root: ns, rebase: true });
  const applyMs = performance.now() - t0;
  const t1 = performance.now();
  const report = await fs.flush();
  const flushMs = performance.now() - t1;

  // Durability proven through a FRESH surface, never the writing one.
  const reopened = new OpfsVfs();
  await reopened.init();
  const tailBytes = await reopened.readFile(`${ns}/${tailRel}`);
  const tailVerified = new TextDecoder().decode(tailBytes) === tailText;

  await realRoot.removeEntry(ns.slice(1), { recursive: true }).catch(() => {});

  return {
    fileCount,
    dirCount,
    mkdirPersistOps: counter.calls,
    writeOps: surface.writes,
    reportTotal: report.total,
    tailVerified,
    applyMs: Math.round(applyMs),
    flushMs: Math.round(flushMs),
  };
}

scope.addEventListener('message', () => {
  void runAcceptance()
    .then((result) => scope.postMessage({ ok: true, result }))
    .catch((err: unknown) => {
      scope.postMessage({
        ok: false,
        error: err instanceof Error ? (err.stack ?? err.message) : String(err),
      });
    });
});
