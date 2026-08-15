/// <reference lib="webworker" />
/**
 * Mid-drain kill fixture for vfs/opfs-parallel-write-through-drain (issue
 * #256, epic project-open-drain-latency, fault row c; ADR-0358 "Reload
 * honesty unchanged"): a realm terminated while `promote()`'s durability
 * drain is in flight must never leave a TRUSTED stamp; a fresh realm's own
 * boot-path check refuses reuse, and only a full re-run (demote → tree →
 * promote with the real flush seam) ends trusted over a clean ledger.
 *
 * The mid-drain discriminator is PATH-AWARE (attempt-4 reviewer finding,
 * frozen-assumption/torn-state): an aggregate completed-writes count
 * (`0 < completed < total`) silently re-encoded the removed FIFO's ordering —
 * stamp + package.json durable before any tree write. Under parallel lanes
 * the ack instead requires the durable PENDING stamp and package.json BY
 * PATH plus a strictly partial tree, so the realm provably dies with a
 * durable pending claim on disk and phase 2 can pin its durability EXACTLY.
 *
 * Real OPFS, real `OpfsFsSync`, and the PRODUCTION install-stamp composition
 * (reviewer-demanded sibling of the raw-fsSync unit pins — BOTH stamp
 * writers are swept: the raw-fsSync pins and the claimIo composition here):
 * `createOwnerVfsAuthorityComposition` wraps the raw `OpfsFsSync`, the owner
 * authority becomes the sync mirror (`setSyncMirror` + `SyncMirrorVfs`), and
 * `createInstallStampAuthority` gets the PRIVILEGED `claimIo` writer — exactly
 * workbench-owner-runtime.ts:244-249 → owner-package-state.ts:230-234. All
 * owner-realm mutations (tree, package.json, flush) route through the
 * authority like production; the ONLY test double is the completed-write
 * path recorder subclass below.
 */
import { type FsSync, OpfsFsSync, OpfsVfs } from '@riftydev/vfs';
import { setSyncMirror } from '@riftydev/vfs/internal';
import { installArtifactIdentity } from '../../../packages/workbench/src/glue/install-artifact-identity.ts';
import {
  type InstallStampAuthority,
  createInstallStampAuthority,
} from '../../../packages/workbench/src/glue/install-stamp-authority.ts';
import { installStampPath } from '../../../packages/workbench/src/glue/install-stamp.ts';
import { SyncMirrorVfs } from '../../../packages/workbench/src/glue/sync-mirror-vfs.ts';
import {
  type OwnerVfsAuthority,
  createOwnerVfsAuthorityComposition,
} from '../../../packages/workbench/src/workers/owner-vfs-authority.ts';

const scope = globalThis as unknown as DedicatedWorkerGlobalScope;
const enc = new TextEncoder();
const dec = new TextDecoder();

const SLUG = 'pd256-kill';
const PACKAGE_JSON = '{"name":"pd256-kill","dependencies":{"left-pad":"1.3.0"}}\n';
const PKG_COUNT = 40;
const FILES_PER_PKG = 15; // package.json + 14 lib files per package

class PathRecordingOpfsVfs extends OpfsVfs {
  /** COMPLETED (durably closed) writes BY PATH → exact bytes, recorded after
   * the real write. Path-aware because an aggregate counter was a FIFO-shaped
   * assumption (attempt-4 reviewer finding): only naming WHICH paths closed
   * can prove the pending stamp is durable while the tree is still partial. */
  readonly completed = new Map<string, Uint8Array>();

  override async writeFile(path: string, data: Uint8Array | string): Promise<void> {
    await super.writeFile(path, data);
    this.completed.set(path, typeof data === 'string' ? enc.encode(data) : data.slice());
  }
}

/** Exactly the owner boot wiring (workbench-owner-runtime.ts:244-249 →
 * owner-package-state.ts:230-234): the owner VFS authority composition wraps
 * the raw `OpfsFsSync` (same `initialRoots` as production), the AUTHORITY —
 * not the raw fsSync — becomes the sync mirror with `SyncMirrorVfs` as its
 * paired async view, and the install-stamp authority reads/writes claims
 * through the privileged `claimIo` composition capability. */
function wireAuthority(fsSync: OpfsFsSync): {
  readonly stamps: InstallStampAuthority;
  readonly authority: OwnerVfsAuthority;
} {
  const composition = createOwnerVfsAuthorityComposition(fsSync, {
    initialRoots: ['/', '/.rifty'],
  });
  const vfs = new SyncMirrorVfs();
  setSyncMirror(composition.authority, { async: vfs });
  const stamps = createInstallStampAuthority({
    vfs,
    fsSync: composition.authority,
    claimIo: composition.installStampClaims,
  });
  return { stamps, authority: composition.authority };
}

function pkgName(p: number): string {
  return `pkg-${String(p).padStart(3, '0')}`;
}

/** Procedural, byte-reproducible content (~1.4 KB) — the same (p, f) always
 * yields the same bytes, so both phases and the full-tree verify agree
 * exactly. */
function fileBytes(p: number, f: number): Uint8Array {
  return enc.encode(`// pd256 pkg=${p} file=${f}\n${'0123456789abcdef'.repeat(4)}\n`.repeat(16));
}

function pkgJsonBytes(p: number): Uint8Array {
  return enc.encode(`{"name":"${pkgName(p)}","version":"1.0.0"}\n`);
}

/** Install-shaped tree: 40 pkgs × (package.json + 14 lib files) = 600 files
 * over 81 dirs (node_modules + pkg + lib each), ~850 KB total — enough queued
 * write ops that the page's terminate() provably lands with hundreds of OPFS
 * writes still in flight. */
function writeInstallTree(fs: FsSync, root: string): number {
  let fileCount = 0;
  for (let p = 0; p < PKG_COUNT; p++) {
    const pkgDir = `${root}/node_modules/${pkgName(p)}`;
    fs.mkdirSync(`${pkgDir}/lib`, { recursive: true });
    fs.writeFileSync(`${pkgDir}/package.json`, pkgJsonBytes(p));
    fileCount += 1;
    for (let f = 1; f < FILES_PER_PKG; f++) {
      fs.writeFileSync(`${pkgDir}/lib/f${String(f).padStart(3, '0')}.js`, fileBytes(p, f));
      fileCount += 1;
    }
  }
  return fileCount;
}

/** The 600-file tree SPEC, regenerated procedurally: every expected path
 * under node_modules → exact bytes. Verification holds OPFS against THIS,
 * never against what the writer happened to produce. */
function expectedTree(root: string): Map<string, Uint8Array> {
  const spec = new Map<string, Uint8Array>();
  for (let p = 0; p < PKG_COUNT; p++) {
    const pkgDir = `${root}/node_modules/${pkgName(p)}`;
    spec.set(`${pkgDir}/package.json`, pkgJsonBytes(p));
    for (let f = 1; f < FILES_PER_PKG; f++) {
      spec.set(`${pkgDir}/lib/f${String(f).padStart(3, '0')}.js`, fileBytes(p, f));
    }
  }
  return spec;
}

/** Every FILE path under `dir`, recursively, through the given surface. */
async function listFiles(vfs: OpfsVfs, dir: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await vfs.readdir(dir)) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory) files.push(...(await listFiles(vfs, path)));
    else files.push(path);
  }
  return files;
}

/** FULL-TREE proof (#256 fault row c): a spot check could bless a partially
 * drained tree, so the whole node_modules namespace is enumerated and held
 * against the regenerated spec — exact path set, exact size, exact bytes,
 * all 600 files. The trusted stamp is the authority's own artifact inside
 * the tree dir, not tree content (install-stamp.ts isStampedTreeDamage) —
 * it is excluded from the path set. */
async function verifyFullTree(
  vfs: OpfsVfs,
  root: string,
): Promise<{ verified: boolean; files: number; firstMismatch: string | null }> {
  const spec = expectedTree(root);
  const stampPath = installStampPath(root);
  const found = (await listFiles(vfs, `${root}/node_modules`)).filter(
    (path) => path !== stampPath,
  );
  const foundSet = new Set(found);
  let firstMismatch: string | null = null;
  for (const path of found) {
    if (!spec.has(path)) {
      firstMismatch = `unexpected: ${path}`;
      break;
    }
  }
  for (const path of spec.keys()) {
    if (firstMismatch) break;
    if (!foundSet.has(path)) firstMismatch = `missing: ${path}`;
  }
  for (const [path, expected] of spec) {
    if (firstMismatch) break;
    const actual = await vfs.readFile(path).catch(() => null);
    if (actual === null) firstMismatch = `unreadable: ${path}`;
    else if (actual.byteLength !== expected.byteLength)
      firstMismatch = `size: ${path} got=${actual.byteLength} want=${expected.byteLength}`;
    else {
      const at = actual.findIndex((byte, index) => byte !== expected[index]);
      if (at !== -1) firstMismatch = `bytes: ${path} @${at}`;
    }
  }
  return { verified: firstMismatch === null, files: found.length, firstMismatch };
}

/** The boot path's OWN reuse gate, verbatim predicate from
 * owner-package-state.ts `transition()` (stamps.check + identity equality):
 * only this decides whether a re-open would skip the install. */
async function bootPathTrusts(
  stamps: InstallStampAuthority,
  root: string,
): Promise<{ trusted: boolean; status: string }> {
  const checked = await stamps.check({
    root,
    slug: SLUG,
    expectedPackageJsonText: PACKAGE_JSON,
  });
  return {
    trusted:
      checked.status === 'trusted' &&
      checked.stamp.installArtifactIdentity === installArtifactIdentity,
    status: checked.status,
  };
}

/** Phase 1: real install sequence up to an UNAWAITED promote(); acknowledge
 * only once the drain is observably mid-flight, PATH-AWARE: the PENDING stamp
 * write and the package.json write are durably closed and the node_modules
 * tree is strictly partial. The page terminates this realm on that ack — a
 * real death with OPFS I/O in flight and a DURABLE pending claim on disk. */
async function runKillRun(ns: string): Promise<{
  readonly phase: 'mid-drain';
  readonly treeCompleted: number;
  readonly treeTotal: number;
  readonly stampDurable: boolean;
  readonly packageJsonDurable: boolean;
}> {
  const root = `${ns}/project`;
  const surface = new PathRecordingOpfsVfs();
  await surface.init();
  const storage = (
    navigator as unknown as { storage: { getDirectory(): Promise<FileSystemDirectoryHandle> } }
  ).storage;
  const fs = new OpfsFsSync(await storage.getDirectory(), surface);
  const { stamps, authority } = wireAuthority(fs);

  authority.mkdirSync(`${root}/node_modules`, { recursive: true });
  authority.writeFileSync(`${root}/package.json`, enc.encode(PACKAGE_JSON));
  // node_modules exists → demote materializes the PENDING claim on disk.
  const claim = await stamps.demote({ root, slug: SLUG });
  if (!authority.existsSync(installStampPath(root))) {
    throw new Error('demote did not materialize the pending stamp (write accounting broken)');
  }
  const fileCount = writeInstallTree(authority, root);

  const promotion = stamps.promote(
    { root, slug: SLUG, packageJsonText: PACKAGE_JSON },
    { epoch: claim.epoch, packages: PKG_COUNT, flush: () => authority.flush() },
  );
  // Realm dies mid-drain by design; the promotion can never conclude here.
  void promotion.catch(() => {});

  const stampPath = installStampPath(root);
  const packageJsonPath = `${root}/package.json`;
  const treePrefix = `${root}/node_modules/`;
  // node_modules tree FILE writes only: the stamp lives under node_modules
  // and is excluded; package.json sits outside the prefix by construction.
  const treeCompleted = (): number => {
    let count = 0;
    for (const path of surface.completed.keys()) {
      if (path !== stampPath && path.startsWith(treePrefix)) count += 1;
    }
    return count;
  };
  // Durable PENDING claim: the COMPLETED write at the stamp path must parse
  // as a stamp whose `durability` field is exactly 'pending'
  // (install-stamp.ts InstallStamp.durability) — some write there is not
  // enough; promote()'s trusted rewrite carries no durability field.
  const stampDurablePending = (): boolean => {
    const bytes = surface.completed.get(stampPath);
    if (!bytes) return false;
    try {
      return (JSON.parse(dec.decode(bytes)) as { durability?: unknown }).durability === 'pending';
    } catch {
      return false;
    }
  };
  // Path-aware mid-drain ack: durable pending stamp AND durable package.json
  // AND strictly partial tree. On main's FIFO this is deterministic (the
  // stamp + package.json enqueue before the first tree write, lines above);
  // under parallel lanes the poll simply waits until those exact paths
  // complete — schedule-agnostic by construction, no ordering assumed.
  for (;;) {
    const tree = treeCompleted();
    if (tree >= fileCount) throw new Error('drain finished before the kill window');
    if (stampDurablePending() && surface.completed.has(packageJsonPath) && tree > 0) {
      return {
        phase: 'mid-drain',
        treeCompleted: tree,
        treeTotal: fileCount,
        stampDurable: true,
        packageJsonDurable: true,
      };
    }
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}

/** EXACT stamp state on the torn disk, read from the file itself (never the
 * check verdict): the parsed stamp's `durability` field, 'absent' when the
 * file is missing, 'none' when a durability-less (trusted-shape) stamp,
 * 'unparseable' on damage. The spec pins === 'pending': the durable PENDING
 * claim must have SURVIVED the kill — 'absent' no longer satisfies the
 * strong half of reload honesty (a durable pending stamp is never trusted). */
async function readStampDurability(vfs: OpfsVfs, root: string): Promise<string> {
  const bytes = await vfs.readFile(installStampPath(root)).catch(() => null);
  if (bytes === null) return 'absent';
  try {
    const parsed = JSON.parse(dec.decode(bytes)) as { durability?: unknown };
    return parsed.durability === undefined ? 'none' : String(parsed.durability);
  } catch {
    return 'unparseable';
  }
}

/** Phase 2: a FRESH realm over the torn OPFS. FIRST the on-disk stamp must
 * still be the durable PENDING claim and the boot path's own check must
 * refuse it (never trusted); then the FULL install sequence re-runs to
 * conclusion and must end trusted with a clean ledger and a FULL-TREE
 * byte-exact verify through a fresh OpfsVfs (every path, every size, every
 * byte vs the regenerated spec). */
async function runVerifyRetry(ns: string): Promise<{
  readonly preTrusted: boolean;
  readonly preCheckStatus: string;
  readonly preStampDurability: string;
  readonly promoteStatus: string;
  readonly postTrusted: boolean;
  readonly reportTotal: number;
  readonly treeVerified: boolean;
  readonly treeFiles: number;
  readonly treeFirstMismatch: string | null;
}> {
  const root = `${ns}/project`;
  const surface = new OpfsVfs();
  await surface.init();
  const fs = await OpfsFsSync.init(surface);
  // Production boot order: the composition is constructed over the FRESHLY
  // booted fsSync (torn durable state already hydrated), so the claimIo stamp
  // read below is the boot path's honest view of disk.
  const { stamps, authority } = wireAuthority(fs);

  // Torn-disk stamp read FIRST (before any check/demote can touch it): the
  // durable pending claim written before the kill must still be on disk.
  const preStampDurability = await readStampDurability(surface, root);
  // ADR-0358 reload honesty: never trust a stamp over an unproven tree.
  const pre = await bootPathTrusts(stamps, root);

  const claim = await stamps.demote({ root, slug: SLUG });
  authority.mkdirSync(`${root}/node_modules`, { recursive: true });
  authority.writeFileSync(`${root}/package.json`, enc.encode(PACKAGE_JSON));
  writeInstallTree(authority, root);
  const promotion = await stamps.promote(
    { root, slug: SLUG, packageJsonText: PACKAGE_JSON },
    { epoch: claim.epoch, packages: PKG_COUNT, flush: () => authority.flush() },
  );
  const post = await bootPathTrusts(stamps, root);
  const report = await authority.flush();
  if (report === undefined) {
    throw new Error('owner authority flush returned no durability report');
  }

  // Durability proven through a FRESH surface, never the writing one.
  const reopened = new OpfsVfs();
  await reopened.init();
  const tree = await verifyFullTree(reopened, root);

  const storage = (
    navigator as unknown as { storage: { getDirectory(): Promise<FileSystemDirectoryHandle> } }
  ).storage;
  const realRoot = await storage.getDirectory();
  await realRoot.removeEntry(ns.slice(1), { recursive: true }).catch(() => {});

  return {
    preTrusted: pre.trusted,
    preCheckStatus: pre.status,
    preStampDurability,
    promoteStatus: promotion.status,
    postTrusted: post.trusted,
    reportTotal: report.total,
    treeVerified: tree.verified,
    treeFiles: tree.files,
    treeFirstMismatch: tree.firstMismatch,
  };
}

scope.addEventListener('message', (event: MessageEvent<{ phase?: string; ns?: string }>) => {
  const { phase, ns } = event.data ?? {};
  const run =
    phase === 'kill-run' && ns
      ? runKillRun(ns)
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
