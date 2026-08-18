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
  type WorkspaceArchiveV1,
  applyWorkspaceArchive,
} from '../../../packages/workbench/src/glue/workspace-archive.ts';

const scope = globalThis as unknown as DedicatedWorkerGlobalScope;

interface AcceptanceResult {
  readonly fileCount: number;
  readonly dirCount: number;
  /** Distinct file dirnames in the archive (the ns root counts once). */
  readonly distinctDirnames: number;
  readonly mkdirPersistOps: number;
  readonly writeOps: number;
  readonly reportTotal: number;
  readonly tailVerified: boolean;
  readonly applyMs: number;
  readonly flushMs: number;
}

class CountingOpfsVfs extends OpfsVfs {
  /** COMPLETED (durably closed) writes — incremented after the real write. */
  writes = 0;

  override async writeFile(path: string, data: Uint8Array | string): Promise<void> {
    await super.writeFile(path, data);
    this.writes += 1;
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

/** Deterministic node_modules-shaped archive: 100 pkgs × 30 files, plus TWO
 * nonconsecutive root-level files (the root dirname must dedup too). */
function buildArchive(): {
  archive: WorkspaceArchiveV1;
  fileCount: number;
  dirCount: number;
  tailRel: string;
} {
  const files: Array<{ path: string; encoding: 'base64'; content: string }> = [
    { path: 'root-first.txt', encoding: 'base64', content: btoa('root-first\n') },
  ];
  const dirs = new Set<string>();
  const subdirs = ['lib', 'esm', 'internals'];
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
    }
  }
  const tailRel = 'root-last.txt';
  files.push({ path: tailRel, encoding: 'base64', content: btoa('root-last\n') });
  return {
    archive: { version: 1, root: '/ws', files },
    fileCount: files.length,
    dirCount: dirs.size,
    tailRel,
  };
}

/** Byte-EXACT oracle (no text projection — a BOM-prefixed mutation must
 * fail): decodes the archive's base64 and compares every byte. */
function bytesEqualBase64(bytes: Uint8Array, base64: string): boolean {
  const expected = atob(base64);
  if (bytes.byteLength !== expected.length) return false;
  for (let i = 0; i < bytes.byteLength; i++) {
    if (bytes[i] !== expected.charCodeAt(i)) return false;
  }
  return true;
}

async function runAcceptance(): Promise<AcceptanceResult> {
  const ns = `/mkdir-dedup-256-${crypto.randomUUID()}`;
  const { archive, fileCount, dirCount, tailRel } = buildArchive();
  const tailContent = archive.files[archive.files.length - 1]?.content ?? '';
  // Exact expected mkdir persists = one per distinct file dirname ('' = ns
  // root counts once) + apply()'s own root mkdir. A root-duplicate mutant
  // lands at +1 and must FAIL the exact-equality gate in the spec.
  const distinctDirnames = new Set(
    archive.files.map((file) => file.path.slice(0, file.path.lastIndexOf('/') + 1)),
  ).size;

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

  // Durability proven through a FRESH surface, never the writing one —
  // byte-exact against the archive's base64, no text projection.
  const reopened = new OpfsVfs();
  await reopened.init();
  const tailBytes = await reopened.readFile(`${ns}/${tailRel}`);
  const tailVerified = bytesEqualBase64(tailBytes, tailContent);

  await realRoot.removeEntry(ns.slice(1), { recursive: true }).catch(() => {});

  return {
    fileCount,
    dirCount,
    distinctDirnames,
    mkdirPersistOps: counter.calls,
    writeOps: surface.writes,
    reportTotal: report.total,
    tailVerified,
    applyMs: Math.round(applyMs),
    flushMs: Math.round(flushMs),
  };
}

/** Row (c) phase 1: apply the archive, start the drain, then acknowledge
 * only once the drain is OBSERVABLY mid-flight — some writes durably done,
 * most still pending (`0 < completed < total`). The page terminates this
 * worker on that discriminated ack: a real realm death with in-flight OPFS
 * I/O, provably neither before the first byte nor after the last. */
async function runApplyNoFlush(ns: string): Promise<{
  readonly phase: 'mid-drain';
  readonly completed: number;
  readonly total: number;
}> {
  const { archive, fileCount } = buildArchive();
  const surface = new CountingOpfsVfs();
  await surface.init();
  const storage = (
    navigator as unknown as { storage: { getDirectory(): Promise<FileSystemDirectoryHandle> } }
  ).storage;
  const fs = new OpfsFsSync(await storage.getDirectory(), surface);
  applyWorkspaceArchive(fs, archive, { root: ns, rebase: true });
  void fs.flush(); // drain keeps running; the page kills us inside it
  while (surface.writes === 0) {
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  const completed = surface.writes;
  if (completed >= fileCount) throw new Error('drain finished before the kill window');
  return { phase: 'mid-drain', completed, total: fileCount };
}

/** Row (c) phase 2: a FRESH realm over the torn OPFS first OBSERVES the
 * partial state the kill left (`0 < filesOnDisk < total`), then retries the
 * SAME restore and byte-verifies EVERY archive file through a fresh
 * OpfsVfs — exact bytes, no text projection. */
async function runVerifyRetry(ns: string): Promise<{
  readonly reportTotal: number;
  readonly fileCount: number;
  readonly preRetryFiles: number;
  readonly verifiedAll: boolean;
}> {
  const { archive, fileCount } = buildArchive();
  const surface = new OpfsVfs();
  await surface.init();
  const fs = await OpfsFsSync.init(surface);
  // Partial-state proof BEFORE the retry: the boot walk indexed the torn tree.
  let preRetryFiles = 0;
  for (const file of archive.files) {
    if (fs.existsSync(`${ns}/${file.path}`)) preRetryFiles += 1;
  }

  applyWorkspaceArchive(fs, archive, { root: ns, rebase: true });
  const report = await fs.flush();

  const reopened = new OpfsVfs();
  await reopened.init();
  let verifiedAll = true;
  for (const file of archive.files) {
    const bytes = await reopened.readFile(`${ns}/${file.path}`).catch(() => null);
    if (bytes === null || !bytesEqualBase64(bytes, file.content)) {
      verifiedAll = false;
      break;
    }
  }
  const storage = (
    navigator as unknown as { storage: { getDirectory(): Promise<FileSystemDirectoryHandle> } }
  ).storage;
  const realRoot = await storage.getDirectory();
  await realRoot.removeEntry(ns.slice(1), { recursive: true }).catch(() => {});
  return { reportTotal: report.total, fileCount, preRetryFiles, verifiedAll };
}

scope.addEventListener('message', (event: MessageEvent<{ phase?: string; ns?: string }>) => {
  const { phase, ns } = event.data ?? {};
  const run =
    phase === 'acceptance'
      ? runAcceptance()
      : phase === 'apply-no-flush' && ns
        ? runApplyNoFlush(ns)
        : phase === 'verify-retry' && ns
          ? runVerifyRetry(ns)
          : Promise.reject(new Error(`unknown phase: ${String(phase)}`));
  void run
    .then((result) => scope.postMessage({ ok: true, result }))
    .catch((err: unknown) => {
      scope.postMessage({
        ok: false,
        error: err instanceof Error ? (err.stack ?? err.message) : String(err),
      });
    });
});
