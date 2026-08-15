/// <reference lib="webworker" />
/**
 * Acceptance fixture for vfs/opfs-parallel-write-through-drain (issue #256,
 * epic project-open-drain-latency invariant I3, ADR-0358): on the REAL
 * gravity-ui node_modules manifest (26 811 files / 166.8 MB — paths+sizes
 * from a real npm install, bytes procedural) the product drain must complete
 * ≥2.5x faster than a faithful serial baseline measured in the SAME run on
 * the same machine. The baseline is serial BY CONSTRUCTION — per-op awaited
 * flush ⇒ completion order == call order (the superseded FIFO contract)
 * whatever the drain internals — so it stays a valid same-run serial
 * baseline after parallelization. Every byte of I/O is real OPFS.
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

interface AcceptanceResult {
  readonly files: number;
  readonly totalBytes: number;
  readonly dirCount: number;
  /** Manifest stats echo — the spec pins built tree === manifest walk. */
  readonly statsFiles: number;
  readonly statsTotalBytes: number;
  readonly faithfulMs: number;
  readonly productMs: number;
  readonly speedup: number;
  readonly faithfulReportTotal: number;
  readonly productReportTotal: number;
  readonly faithfulTailVerified: boolean;
  readonly productTailVerified: boolean;
}

interface FileSpec {
  readonly rel: string;
  readonly bytes: Uint8Array;
}

/** Sparse deterministic fill: every 251st byte = (fileIndex + offset) & 0xff —
 * cheap to build (~167 MB total across 26 811 arrays), byte-checkable on
 * re-read (fill positions, zeros between them, and length). */
const FILL_STRIDE = 251;

function buildBytes(fileIndex: number, size: number): Uint8Array {
  const bytes = new Uint8Array(size);
  for (let off = 0; off < size; off += FILL_STRIDE) {
    bytes[off] = (fileIndex + off) & 0xff;
  }
  return bytes;
}

/** Every cumulative ancestor of every file's dirname (ns-relative), sorted so
 * parents precede children. Root-level files contribute nothing — the ns root
 * is mkdir'd once separately, mirroring apply()'s root mkdir. */
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

interface VariantOutcome {
  readonly ms: number;
  readonly reportTotal: number;
  readonly tailVerified: boolean;
}

/** One variant on a fresh OPFS namespace: build the tree, time it, prove tail
 * durability through a FRESH OpfsVfs, then clean the namespace (AFTER the
 * verify, best-effort). Bytes are shared with the other variant — never copy. */
async function runVariant(
  label: 'faithful' | 'product',
  specs: ReadonlyArray<FileSpec>,
  sortedDirs: ReadonlyArray<string>,
): Promise<VariantOutcome> {
  const ns = `/pd256-${label}-${crypto.randomUUID()}`;
  const surface = new OpfsVfs();
  await surface.init();
  await surface.mkdir(ns);
  const fs = await OpfsFsSync.init(surface);

  let ms: number;
  let report: PersistFailureReport;
  if (label === 'faithful') {
    // Faithful serial — the epic's baseline, the pre-dedup #256 regime
    // (mkdir before EVERY write, ~2 persist ops/file), serialized by the
    // per-op awaited flush regardless of drain internals.
    const t0 = performance.now();
    let last: PersistFailureReport | null = null;
    for (const spec of specs) {
      const abs = `${ns}/${spec.rel}`;
      fs.mkdirSync(abs.slice(0, abs.lastIndexOf('/')), { recursive: true });
      await fs.flush();
      fs.writeFileSync(abs, spec.bytes);
      last = await fs.flush();
    }
    ms = performance.now() - t0;
    if (last === null) throw new Error('faithful variant drained no files');
    report = last;
  } else {
    // Product drain — the CURRENT landed caller shape (slice-1 deduped):
    // one mkdir per distinct dir (sorted, recursive), one write per file,
    // ONE flush. On main this drains the serial FIFO; post-ADR-0358 through
    // ~16 per-path lanes.
    const t0 = performance.now();
    fs.mkdirSync(ns, { recursive: true }); // apply()'s root mkdir, once
    for (const dir of sortedDirs) {
      fs.mkdirSync(`${ns}/${dir}`, { recursive: true });
    }
    for (const spec of specs) {
      fs.writeFileSync(`${ns}/${spec.rel}`, spec.bytes);
    }
    report = await fs.flush();
    ms = performance.now() - t0;
  }

  // Tail durability proven through a FRESH surface, never the writing one —
  // byte-exact vs the in-memory source (sparse fills, zeros, length).
  const tail = specs[specs.length - 1];
  if (!tail) throw new Error('empty spec set');
  const reopened = new OpfsVfs();
  await reopened.init();
  const readBack = await reopened.readFile(`${ns}/${tail.rel}`).catch(() => null);
  const tailVerified =
    readBack !== null &&
    readBack.byteLength === tail.bytes.byteLength &&
    readBack.every((byte, i) => byte === tail.bytes[i]);

  const storage = (
    navigator as unknown as { storage: { getDirectory(): Promise<FileSystemDirectoryHandle> } }
  ).storage;
  const realRoot = await storage.getDirectory();
  await realRoot.removeEntry(ns.slice(1), { recursive: true }).catch(() => {});

  return { ms: Math.round(ms), reportTotal: report.total, tailVerified };
}

async function runAcceptance(manifestUrl: string): Promise<AcceptanceResult> {
  const response = await fetch(manifestUrl);
  if (!response.ok) throw new Error(`manifest fetch failed: ${response.status}`);
  const manifest = (await response.json()) as RealTreeManifest;
  if (typeof manifest?.stats?.files !== 'number' || !manifest.files?.length) {
    throw new Error('manifest missing stats/files');
  }

  // Bytes built ONCE (~167 MB) and shared by both variants — no copies held.
  let totalBytes = 0;
  const specs: FileSpec[] = manifest.files.map(([rel, size], index) => {
    totalBytes += size;
    return { rel, bytes: buildBytes(index, size) };
  });
  const sortedDirs = distinctDirs(manifest.files);

  const faithful = await runVariant('faithful', specs, sortedDirs);
  const product = await runVariant('product', specs, sortedDirs);

  return {
    files: specs.length,
    totalBytes,
    dirCount: sortedDirs.length,
    statsFiles: manifest.stats.files,
    statsTotalBytes: manifest.stats.totalBytes,
    faithfulMs: faithful.ms,
    productMs: product.ms,
    speedup: Math.round((faithful.ms / product.ms) * 100) / 100,
    faithfulReportTotal: faithful.reportTotal,
    productReportTotal: product.reportTotal,
    faithfulTailVerified: faithful.tailVerified,
    productTailVerified: product.tailVerified,
  };
}

scope.addEventListener(
  'message',
  (event: MessageEvent<{ phase?: string; manifestUrl?: string }>) => {
    const { phase, manifestUrl } = event.data ?? {};
    const run =
      phase === 'acceptance' && manifestUrl
        ? runAcceptance(manifestUrl)
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
