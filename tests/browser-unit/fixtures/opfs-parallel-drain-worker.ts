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
 * baseline after parallelization; its per-op-flush inflation is bounded by
 * the manual 'calibrate' phase (see {@link runCalibration}). Every byte of
 * I/O is real OPFS; durability is proven WHOLE-TREE through a fresh OpfsVfs
 * with a BYTE-EXACT read of every file (fault-classes.md exact-bytes rule)
 * and an EXACT-ENTRY dir-set match (stray empty dirs fail).
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

/** Fresh-surface whole-tree durability proof for one variant namespace. */
interface TreeProof {
  readonly treeVerified: boolean;
  /** Files actually enumerated under the namespace on the fresh surface. */
  readonly treeFiles: number;
  /** Directories actually enumerated under the namespace on the fresh surface. */
  readonly treeDirs: number;
  /** First mismatch (path + expected/actual), null when the tree is clean. */
  readonly treeMismatch: string | null;
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
  /** Faithful flush-op count (mkdir+write ⇒ 2×files) — probe-gate multiplier. */
  readonly faithfulOpCount: number;
  /** Same-run probe: mean ms of EMPTY_FLUSH_PROBE_N empty awaited flush()
   * calls on the drained faithful instance. RAW unrounded. */
  readonly emptyFlushMeanMs: number;
  /** RAW unrounded faithful/product ratio — the asserted I3 gate. */
  readonly speedupRaw: number;
  /** Log convenience only (2-decimal rounding of speedupRaw) — never asserted. */
  readonly speedup: number;
  readonly faithfulReportTotal: number;
  readonly productReportTotal: number;
  readonly faithfulTreeVerified: boolean;
  readonly faithfulTreeFiles: number;
  readonly faithfulTreeDirs: number;
  readonly faithfulTreeMismatch: string | null;
  readonly productTreeVerified: boolean;
  readonly productTreeFiles: number;
  readonly productTreeDirs: number;
  readonly productTreeMismatch: string | null;
}

interface CalibrationResult {
  readonly files: number;
  /** Wall time of (a) faithful-per-op — acceptance-baseline shape. */
  readonly perOpFlushMs: number;
  /** Wall time of (b) faithful-one-flush — pre-epic FIFO drain shape. */
  readonly oneFlushMs: number;
  /** RAW unrounded a/b — its measured ceiling seeds SERIAL_OVERHEAD_BOUND. */
  readonly rawRatio: number;
}

interface FileSpec {
  readonly rel: string;
  readonly bytes: Uint8Array;
}

/** Sparse deterministic fill: every 251st byte = (fileIndex + offset) & 0xff —
 * cheap to build (~167 MB total across 26 811 arrays), byte-checkable on
 * re-read (fill positions, zeros between them, and length). */
const FILL_STRIDE = 251;

/** Same-run flush-overhead probe size — frozen-assumption closure: the fixed
 * SERIAL_OVERHEAD_BOUND calibration measured the OLD (pre-ADR-0358) drain and
 * cannot constrain the IMPLEMENTED one — a flush() whose own call cost grew
 * would inflate faithfulMs (~2×files awaited flushes) and manufacture speedup.
 * After the faithful variant fully drains, N empty awaited flush() calls on
 * the SAME instance measure the SHIPPED per-flush overhead every run; the
 * spec gates emptyFlushMeanMs × faithfulOpCount ≤ 0.1 × faithfulMs. */
const EMPTY_FLUSH_PROBE_N = 2000;

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

/** Fetch + validate the manifest, build the byte specs ONCE (~167 MB). */
async function loadSpecs(
  manifestUrl: string,
): Promise<{ manifest: RealTreeManifest; specs: FileSpec[]; totalBytes: number }> {
  const response = await fetch(manifestUrl);
  if (!response.ok) throw new Error(`manifest fetch failed: ${response.status}`);
  const manifest = (await response.json()) as RealTreeManifest;
  if (typeof manifest?.stats?.files !== 'number' || !manifest.files?.length) {
    throw new Error('manifest missing stats/files');
  }
  let totalBytes = 0;
  const specs: FileSpec[] = manifest.files.map(([rel, size], index) => {
    totalBytes += size;
    return { rel, bytes: buildBytes(index, size) };
  });
  return { manifest, specs, totalBytes };
}

async function removeNamespace(ns: string): Promise<void> {
  const storage = (
    navigator as unknown as { storage: { getDirectory(): Promise<FileSystemDirectoryHandle> } }
  ).storage;
  const realRoot = await storage.getDirectory();
  await realRoot.removeEntry(ns.slice(1), { recursive: true }).catch(() => {});
}

/** WHOLE-TREE fresh-surface proof, BYTE-EXACT for ALL files: fault-classes.md
 * demands exact bytes/digest, and review rejected a sampled oracle —
 * same-length corruption in an unsampled file must fail. Two passes through a
 * FRESH OpfsVfs: (1) readdir walk enumerates EVERYTHING persisted under `ns`,
 * files AND directories — any file outside the manifest is `unexpected:`, any
 * dir outside the derived ancestor set is `unexpected dir:`; (2) chunked concurrent
 * readFile (Promise.all × 64 — each read re-walks handles from the OPFS root,
 * packages/vfs/src/opfs.ts:216) of EVERY manifest file, comparing byteLength
 * to the source size and EVERY byte to the in-memory source array. readFile
 * bytes ARE the exact stored content, so sizes come from the read — no
 * separate stat pass. Walk-no-extras + every manifest read succeeding ⇒ the
 * trees are identical. Read buffers are compared and released per chunk —
 * never accumulated (26 811 reads would otherwise hold ~167 MB). */
async function verifyTree(
  ns: string,
  specs: ReadonlyArray<FileSpec>,
  sortedDirs: ReadonlyArray<string>,
): Promise<TreeProof> {
  const surface = new OpfsVfs();
  await surface.init();

  const filePaths: string[] = [];
  const dirPaths: string[] = [];
  const queue: string[] = [ns];
  while (queue.length > 0) {
    const dir = queue.pop() as string;
    for (const entry of await surface.readdir(dir)) {
      const abs = `${dir}/${entry.name}`;
      if (entry.isDirectory) {
        dirPaths.push(abs);
        queue.push(abs);
      } else filePaths.push(abs);
    }
  }

  const fail = (treeMismatch: string): TreeProof => ({
    treeVerified: false,
    treeFiles: filePaths.length,
    treeDirs: dirPaths.length,
    treeMismatch,
  });

  const prefix = `${ns}/`;
  const expected = new Set(specs.map((spec) => spec.rel));
  for (const abs of filePaths) {
    const rel = abs.slice(prefix.length);
    if (!expected.has(rel)) return fail(`unexpected: ${rel}`);
  }
  if (filePaths.length !== specs.length) {
    return fail(`file count: persisted ${filePaths.length} !== manifest ${specs.length}`);
  }

  // Exact-entry DIR oracle (lossy-aggregate closure): a files-only walk passes
  // with a stray EMPTY directory. Compare the walked dir set against the
  // manifest-derived expectation (every cumulative ancestor of every file's
  // dirname, ns-relative) — unexpected dirs (incl. empty) and missing dirs are
  // mismatches, same first-mismatch reporting as files.
  const expectedDirs = new Set(sortedDirs);
  const walkedDirs = new Set<string>();
  for (const abs of dirPaths) {
    const rel = abs.slice(prefix.length);
    if (!expectedDirs.has(rel)) return fail(`unexpected dir: ${rel}`);
    walkedDirs.add(rel);
  }
  if (walkedDirs.size !== expectedDirs.size) {
    const missing = sortedDirs.find((dir) => !walkedDirs.has(dir));
    return fail(`missing dir: ${missing ?? `count ${walkedDirs.size} !== ${expectedDirs.size}`}`);
  }

  const READ_CHUNK = 64;
  for (let base = 0; base < specs.length; base += READ_CHUNK) {
    const chunk = specs.slice(base, base + READ_CHUNK);
    const reads = await Promise.all(
      chunk.map((spec) => surface.readFile(`${ns}/${spec.rel}`).catch(() => null)),
    );
    for (let j = 0; j < chunk.length; j++) {
      const spec = chunk[j] as FileSpec;
      const readBack = reads[j] ?? null;
      if (readBack === null) return fail(`missing: ${spec.rel}`);
      if (readBack.byteLength !== spec.bytes.byteLength) {
        return fail(`size: ${spec.rel} got=${readBack.byteLength} want=${spec.bytes.byteLength}`);
      }
      for (let i = 0; i < readBack.length; i++) {
        if (readBack[i] !== spec.bytes[i]) {
          return fail(
            `bytes: ${spec.rel} @${i} got=${String(readBack[i])} want=${String(spec.bytes[i])}`,
          );
        }
      }
    }
    // Chunk's read buffers drop here — compare-and-release, no accumulation.
  }

  return {
    treeVerified: true,
    treeFiles: filePaths.length,
    treeDirs: dirPaths.length,
    treeMismatch: null,
  };
}

interface VariantOutcome {
  /** Raw, unrounded — speedupRaw divides these; rounding is report-only. */
  readonly ms: number;
  readonly reportTotal: number;
  /** Faithful only (null on product): same-run empty-flush probe mean, see
   * EMPTY_FLUSH_PROBE_N. */
  readonly emptyFlushMeanMs: number | null;
  readonly tree: TreeProof;
}

/** One variant on a fresh OPFS namespace: build the tree, time it, prove
 * whole-tree durability through a FRESH OpfsVfs, then clean the namespace
 * (AFTER the verify, best-effort). Bytes are shared with the other variant —
 * never copy. */
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
  let emptyFlushMeanMs: number | null = null;
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
    // Same-run flush-overhead probe (see EMPTY_FLUSH_PROBE_N): on the fully
    // drained instance, OUTSIDE the timed window — times the SHIPPED empty
    // flush() call itself.
    const p0 = performance.now();
    for (let i = 0; i < EMPTY_FLUSH_PROBE_N; i++) await fs.flush();
    emptyFlushMeanMs = (performance.now() - p0) / EMPTY_FLUSH_PROBE_N;
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

  // Whole-tree durability proven through a FRESH surface, never the writing
  // one — outside the timed window.
  const tree = await verifyTree(ns, specs, sortedDirs);
  await removeNamespace(ns);

  return { ms, reportTotal: report.total, emptyFlushMeanMs, tree };
}

async function runAcceptance(manifestUrl: string): Promise<AcceptanceResult> {
  // Bytes built ONCE (~167 MB) and shared by both variants — no copies held.
  const { manifest, specs, totalBytes } = await loadSpecs(manifestUrl);
  const sortedDirs = distinctDirs(manifest.files);

  const faithful = await runVariant('faithful', specs, sortedDirs);
  const product = await runVariant('product', specs, sortedDirs);
  const speedupRaw = faithful.ms / product.ms;
  if (faithful.emptyFlushMeanMs === null) {
    throw new Error('faithful variant returned no empty-flush probe');
  }

  return {
    files: specs.length,
    totalBytes,
    dirCount: sortedDirs.length,
    statsFiles: manifest.stats.files,
    statsTotalBytes: manifest.stats.totalBytes,
    faithfulMs: Math.round(faithful.ms),
    productMs: Math.round(product.ms),
    // Flushes actually awaited by the faithful loop: mkdir+write per file.
    faithfulOpCount: 2 * specs.length,
    emptyFlushMeanMs: faithful.emptyFlushMeanMs,
    speedupRaw,
    speedup: Math.round(speedupRaw * 100) / 100,
    faithfulReportTotal: faithful.reportTotal,
    productReportTotal: product.reportTotal,
    faithfulTreeVerified: faithful.tree.treeVerified,
    faithfulTreeFiles: faithful.tree.treeFiles,
    faithfulTreeDirs: faithful.tree.treeDirs,
    faithfulTreeMismatch: faithful.tree.treeMismatch,
    productTreeVerified: product.tree.treeVerified,
    productTreeFiles: product.tree.treeFiles,
    productTreeDirs: product.tree.treeDirs,
    productTreeMismatch: product.tree.treeMismatch,
  };
}

/** One calibration variant on a fresh namespace — same tree, timed, then
 * cleaned. Both variants mkdir before EVERY write (never deduped): the ONLY
 * difference is flush placement. */
async function runCalibrationVariant(
  label: 'per-op' | 'one-flush',
  specs: ReadonlyArray<FileSpec>,
): Promise<number> {
  const ns = `/pd256-cal-${label}-${crypto.randomUUID()}`;
  const surface = new OpfsVfs();
  await surface.init();
  await surface.mkdir(ns);
  const fs = await OpfsFsSync.init(surface);

  let ms: number;
  let report: PersistFailureReport;
  if (label === 'per-op') {
    // (a) faithful-per-op — IDENTICAL shape to the acceptance baseline.
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
    if (last === null) throw new Error('per-op calibration drained no files');
    report = last;
  } else {
    // (b) faithful-one-flush — the pre-epic FIFO drain shape: same per-file
    // mkdir-before-every-write op stream, ONE final awaited flush.
    const t0 = performance.now();
    for (const spec of specs) {
      const abs = `${ns}/${spec.rel}`;
      fs.mkdirSync(abs.slice(0, abs.lastIndexOf('/')), { recursive: true });
      fs.writeFileSync(abs, spec.bytes);
    }
    report = await fs.flush();
    ms = performance.now() - t0;
  }
  if (report.total !== 0) {
    throw new Error(`calibration ${label} flush ledger dirty: total=${report.total}`);
  }

  await removeNamespace(ns);
  return ms;
}

/** Calibration harness for the acceptance baseline's denominator (manual,
 * run ONCE pre-implementation): rawRatio = (a) faithful-per-op wall time /
 * (b) faithful-one-flush wall time bounds how much the per-op awaited flush
 * inflates the serial baseline vs the one-final-flush serial regime. ONLY
 * meaningful pre-implementation: on main BOTH variants drain the serial
 * FIFO, so a/b isolates pure flush-placement overhead; after ADR-0358
 * parallelization (b) stops being serial and the ratio no longer measures
 * serial overhead. The measured ceiling seeds SERIAL_OVERHEAD_BOUND in
 * opfs-parallel-drain.spec.ts. */
async function runCalibration(manifestUrl: string): Promise<CalibrationResult> {
  const { specs } = await loadSpecs(manifestUrl);
  const perOpFlushMs = await runCalibrationVariant('per-op', specs);
  const oneFlushMs = await runCalibrationVariant('one-flush', specs);
  return {
    files: specs.length,
    perOpFlushMs: Math.round(perOpFlushMs),
    oneFlushMs: Math.round(oneFlushMs),
    rawRatio: perOpFlushMs / oneFlushMs,
  };
}

scope.addEventListener(
  'message',
  (event: MessageEvent<{ phase?: string; manifestUrl?: string }>) => {
    const { phase, manifestUrl } = event.data ?? {};
    const run =
      phase === 'acceptance' && manifestUrl
        ? runAcceptance(manifestUrl)
        : phase === 'calibrate' && manifestUrl
          ? runCalibration(manifestUrl)
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
