/// <reference lib="webworker" />
/**
 * Acceptance fixture for playground/project-open-durability-progress (#256,
 * epic project-open-drain-latency invariant I1, ADR-0359) — DESIGNED RED on
 * main.
 *
 * SEAM DRIVEN (stated per the slice contract): the WORKER-REALM drain owner
 * seam — `OpfsFsSync.flush({ onProgress })` over a REAL ≥10k-file restore op
 * stream (first 12 000 files of the committed real-tree-manifest.json, every
 * byte real OPFS I/O) — NOT the page-side workbench owner health stream. Why
 * this depth: in this lane the full page-side workbench owner cannot restore
 * a ≥10k tree (sealed-workbench project definitions carry inline starter
 * files only; the heavy restore rides the owner's dep-snapshot acquisition,
 * which has no browser-unit driver), so I1's "workbench owner health stream"
 * is carried by two committed hops: (a) THIS fixture proves REAL monotone
 * counts at the drain owner at scale, and (b) the workbench-browser-owner
 * unit pin proves the page hop (owner-level `workbench:durability-progress`
 * message → `{kind:'durability-progress'}` health event on subscribeHealth;
 * channel corrected 2026-08-16 by the first-open unit — the original
 * per-project vfs frame hop was mute for the first-open drain).
 *
 * The op stream below is apply()'s exact post-mkdir-dedup restore shape
 * (workspace-archive.ts): one ns-root mkdir, one mkdir per distinct dir
 * (sorted), one write per file, ONE flush — so `total` at the flush
 * watermark is exactly files + dirs + 1 and the terminal snapshot's counts
 * are checkable against the REAL op universe.
 */
import { OpfsFsSync, OpfsVfs, type PersistFailureReport } from '@riftydev/vfs';

const scope = globalThis as unknown as DedicatedWorkerGlobalScope;

/** Shape of tests/browser-unit/fixtures/real-tree-manifest.json. */
interface RealTreeManifest {
  readonly stats: {
    readonly files: number;
    readonly totalBytes: number;
    readonly dirs: number;
  };
  readonly files: ReadonlyArray<readonly [string, number]>;
}

interface FlushProgressSnapshot {
  readonly persisted: number;
  readonly total: number;
}

/** Structural view of the designed ADR-0359 flush seam; cast-invoked so the
 * carrier compiles on main, where the option does not exist yet. */
interface FlushWithProgress {
  flush(options?: {
    readonly onProgress?: (snapshot: FlushProgressSnapshot) => void;
  }): Promise<PersistFailureReport>;
}

interface ProgressAcceptanceResult {
  readonly files: number;
  readonly dirCount: number;
  /** REAL persist-op universe at the flush watermark: files + dirs + root mkdir. */
  readonly expectedOps: number;
  readonly snapshotCount: number;
  /** Snapshots observed DURING the drain (persisted < total) — not only terminal. */
  readonly midDrainSnapshotCount: number;
  readonly monotone: boolean;
  /** Every snapshot honored 0 ≤ persisted ≤ total. */
  readonly boundsRespected: boolean;
  /** Every snapshot's total === expectedOps (watermark fixed at flush call). */
  readonly totalsStable: boolean;
  readonly first: FlushProgressSnapshot | null;
  readonly last: FlushProgressSnapshot | null;
  readonly reportTotal: number;
  readonly flushMs: number;
}

/** Sparse deterministic fill (mirrors opfs-parallel-drain-worker): every
 * 251st byte = (fileIndex + offset) & 0xff — cheap to build, real to write. */
const FILL_STRIDE = 251;

function buildBytes(fileIndex: number, size: number): Uint8Array {
  const bytes = new Uint8Array(size);
  for (let off = 0; off < size; off += FILL_STRIDE) {
    bytes[off] = (fileIndex + off) & 0xff;
  }
  return bytes;
}

/** Every cumulative ancestor of every file's dirname (ns-relative), sorted so
 * parents precede children — apply()'s deduped mkdir universe. */
function distinctDirs(files: ReadonlyArray<readonly [string, number]>): string[] {
  const dirs = new Set<string>();
  for (const [rel] of files) {
    const cut = rel.lastIndexOf('/');
    if (cut <= 0) continue;
    let prefix = '';
    for (const seg of rel.slice(0, cut).split('/')) {
      prefix = prefix === '' ? seg : `${prefix}/${seg}`;
      dirs.add(prefix);
    }
  }
  return [...dirs].sort();
}

async function removeNamespace(ns: string): Promise<void> {
  const storage = (
    navigator as unknown as { storage: { getDirectory(): Promise<FileSystemDirectoryHandle> } }
  ).storage;
  const realRoot = await storage.getDirectory();
  await realRoot.removeEntry(ns.slice(1), { recursive: true }).catch(() => {});
}

async function runAcceptance(
  manifestUrl: string,
  fileLimit: number,
): Promise<ProgressAcceptanceResult> {
  const response = await fetch(manifestUrl);
  if (!response.ok) throw new Error(`manifest fetch failed: ${response.status}`);
  const manifest = (await response.json()) as RealTreeManifest;
  if (typeof manifest?.stats?.files !== 'number' || !manifest.files?.length) {
    throw new Error('manifest missing stats/files');
  }
  const subset = manifest.files.slice(0, fileLimit);
  if (subset.length < 10_000) {
    throw new Error(`manifest subset too small for I1: ${subset.length} < 10000`);
  }
  const sortedDirs = distinctDirs(subset);
  const specs = subset.map(([rel, size], index) => ({ rel, bytes: buildBytes(index, size) }));

  const ns = `/pd256-progress-${crypto.randomUUID()}`;
  const surface = new OpfsVfs();
  await surface.init();
  const fs = await OpfsFsSync.init(surface);

  const snapshots: FlushProgressSnapshot[] = [];
  // The restore op stream is fully SYNCHRONOUS (apply()'s shape), so at the
  // flush() call below the watermark universe is exactly every op enqueued
  // here: 1 root mkdir + |dirs| mkdirs + |files| writes.
  fs.mkdirSync(ns, { recursive: true });
  for (const dir of sortedDirs) {
    fs.mkdirSync(`${ns}/${dir}`, { recursive: true });
  }
  for (const spec of specs) {
    fs.writeFileSync(`${ns}/${spec.rel}`, spec.bytes);
  }
  const t0 = performance.now();
  const report = await (fs as unknown as FlushWithProgress).flush({
    onProgress: (snapshot) => {
      snapshots.push({ persisted: snapshot.persisted, total: snapshot.total });
    },
  });
  const flushMs = performance.now() - t0;

  await removeNamespace(ns);

  const expectedOps = specs.length + sortedDirs.length + 1;
  let monotone = true;
  let boundsRespected = true;
  let totalsStable = true;
  let midDrainSnapshotCount = 0;
  for (let i = 0; i < snapshots.length; i++) {
    const snapshot = snapshots[i] as FlushProgressSnapshot;
    if (snapshot.persisted < 0 || snapshot.persisted > snapshot.total) boundsRespected = false;
    if (snapshot.total !== expectedOps) totalsStable = false;
    if (snapshot.persisted < snapshot.total) midDrainSnapshotCount += 1;
    if (i > 0 && snapshot.persisted < (snapshots[i - 1] as FlushProgressSnapshot).persisted) {
      monotone = false;
    }
  }

  return {
    files: specs.length,
    dirCount: sortedDirs.length,
    expectedOps,
    snapshotCount: snapshots.length,
    midDrainSnapshotCount,
    monotone,
    boundsRespected,
    totalsStable,
    first: snapshots[0] ?? null,
    last: snapshots.at(-1) ?? null,
    reportTotal: report.total,
    flushMs: Math.round(flushMs),
  };
}

scope.addEventListener(
  'message',
  (event: MessageEvent<{ phase?: string; manifestUrl?: string; fileLimit?: number }>) => {
    const { phase, manifestUrl, fileLimit } = event.data ?? {};
    const run =
      phase === 'acceptance' && manifestUrl && typeof fileLimit === 'number'
        ? runAcceptance(manifestUrl, fileLimit)
        : Promise.reject(new Error(`unknown phase: ${String(phase)}`));
    void run
      .then((result) => scope.postMessage({ ok: true, result }))
      .catch((err: unknown) => {
        scope.postMessage({
          ok: false,
          error: err instanceof Error ? (err.stack ?? err.message) : String(err),
        });
      });
  },
);
