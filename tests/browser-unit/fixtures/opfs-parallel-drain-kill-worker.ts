/// <reference lib="webworker" />
/**
 * Mid-drain kill fixture for vfs/opfs-parallel-write-through-drain (issue
 * #256, epic project-open-drain-latency, fault row c; ADR-0358 "Reload
 * honesty unchanged"): a realm terminated while `promote()`'s durability
 * drain is in flight must never leave a TRUSTED stamp; a fresh realm's own
 * boot-path check refuses reuse, and only a full re-run (demote → tree →
 * promote with the real flush seam) ends trusted over a clean ledger.
 *
 * Real OPFS, real `OpfsFsSync`, real install-stamp authority wired exactly
 * like the owner glue (`setSyncMirror` + `SyncMirrorVfs` +
 * `createInstallStampAuthority` — workbench-owner-runtime.ts:249 /
 * install-stamp-authority.fault.test.ts). The ONLY test double is the
 * completed-write counter subclass below.
 */
import { OpfsFsSync, OpfsVfs } from '@riftydev/vfs';
import { setSyncMirror } from '@riftydev/vfs/internal';
import { installArtifactIdentity } from '../../../packages/workbench/src/glue/install-artifact-identity.ts';
import {
  type InstallStampAuthority,
  createInstallStampAuthority,
} from '../../../packages/workbench/src/glue/install-stamp-authority.ts';
import { installStampPath } from '../../../packages/workbench/src/glue/install-stamp.ts';
import { SyncMirrorVfs } from '../../../packages/workbench/src/glue/sync-mirror-vfs.ts';

const scope = globalThis as unknown as DedicatedWorkerGlobalScope;
const enc = new TextEncoder();

const SLUG = 'pd256-kill';
const PACKAGE_JSON = '{"name":"pd256-kill","dependencies":{"left-pad":"1.3.0"}}\n';
const PKG_COUNT = 40;
const FILES_PER_PKG = 15; // package.json + 14 lib files per package

class CountingOpfsVfs extends OpfsVfs {
  /** COMPLETED (durably closed) writes — incremented after the real write. */
  writes = 0;

  override async writeFile(path: string, data: Uint8Array | string): Promise<void> {
    await super.writeFile(path, data);
    this.writes += 1;
  }
}

/** Exactly the owner glue wiring: the real `OpfsFsSync` becomes the sync
 * mirror, `SyncMirrorVfs` its paired async view, and the authority reads and
 * writes claims through both surfaces. */
function wireAuthority(fsSync: OpfsFsSync): InstallStampAuthority {
  const vfs = new SyncMirrorVfs();
  setSyncMirror(fsSync, { async: vfs });
  return createInstallStampAuthority({ vfs, fsSync });
}

function pkgName(p: number): string {
  return `pkg-${String(p).padStart(3, '0')}`;
}

/** Procedural, byte-reproducible content (~1.4 KB) — the same (p, f) always
 * yields the same bytes, so both phases and the spot verify agree exactly. */
function fileBytes(p: number, f: number): Uint8Array {
  return enc.encode(`// pd256 pkg=${p} file=${f}\n${'0123456789abcdef'.repeat(4)}\n`.repeat(16));
}

/** Install-shaped tree: 40 pkgs × (package.json + 14 lib files) = 600 files
 * over 81 dirs (node_modules + pkg + lib each), ~850 KB total — enough queued
 * write ops that the page's terminate() provably lands with hundreds of OPFS
 * writes still in flight. */
function writeInstallTree(fs: OpfsFsSync, root: string): { fileCount: number; spotPath: string } {
  let fileCount = 0;
  for (let p = 0; p < PKG_COUNT; p++) {
    const pkgDir = `${root}/node_modules/${pkgName(p)}`;
    fs.mkdirSync(`${pkgDir}/lib`, { recursive: true });
    fs.writeFileSync(
      `${pkgDir}/package.json`,
      enc.encode(`{"name":"${pkgName(p)}","version":"1.0.0"}\n`),
    );
    fileCount += 1;
    for (let f = 1; f < FILES_PER_PKG; f++) {
      fs.writeFileSync(`${pkgDir}/lib/f${String(f).padStart(3, '0')}.js`, fileBytes(p, f));
      fileCount += 1;
    }
  }
  const spotPath = `${root}/node_modules/${pkgName(PKG_COUNT - 1)}/lib/f${String(
    FILES_PER_PKG - 1,
  ).padStart(3, '0')}.js`;
  return { fileCount, spotPath };
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
 * only once the drain is observably mid-flight (some writes durably closed,
 * most still pending). The page terminates this realm on that ack — a real
 * death with OPFS I/O and a pending-only stamp in flight. */
async function runKillRun(ns: string): Promise<{
  readonly phase: 'mid-drain';
  readonly completed: number;
  readonly total: number;
}> {
  const root = `${ns}/project`;
  const surface = new CountingOpfsVfs();
  await surface.init();
  const storage = (
    navigator as unknown as { storage: { getDirectory(): Promise<FileSystemDirectoryHandle> } }
  ).storage;
  const fs = new OpfsFsSync(await storage.getDirectory(), surface);
  const stamps = wireAuthority(fs);

  fs.mkdirSync(`${root}/node_modules`, { recursive: true });
  fs.writeFileSync(`${root}/package.json`, enc.encode(PACKAGE_JSON));
  // node_modules exists → demote materializes the PENDING claim on disk.
  const claim = await stamps.demote({ root, slug: SLUG });
  if (!fs.existsSync(installStampPath(root))) {
    throw new Error('demote did not materialize the pending stamp (write accounting broken)');
  }
  const { fileCount } = writeInstallTree(fs, root);

  const promotion = stamps.promote(
    { root, slug: SLUG, packageJsonText: PACKAGE_JSON },
    { epoch: claim.epoch, packages: PKG_COUNT, flush: () => fs.flush() },
  );
  // Realm dies mid-drain by design; the promotion can never conclude here.
  void promotion.catch(() => {});

  // package.json + the pending stamp precede the tree in the write queue.
  const preTreeWrites = 2;
  const total = fileCount + preTreeWrites;
  while (surface.writes <= preTreeWrites) {
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  const completed = surface.writes;
  if (completed >= total) throw new Error('drain finished before the kill window');
  return { phase: 'mid-drain', completed, total };
}

/** Phase 2: a FRESH realm over the torn OPFS. FIRST the boot path's own
 * check must refuse the stamp (pending or torn — never trusted); then the
 * FULL install sequence re-runs to conclusion and must end trusted with a
 * clean ledger and a byte-exact deep file through a fresh OpfsVfs. */
async function runVerifyRetry(ns: string): Promise<{
  readonly preTrusted: boolean;
  readonly preCheckStatus: string;
  readonly promoteStatus: string;
  readonly postTrusted: boolean;
  readonly reportTotal: number;
  readonly spotByteVerified: boolean;
}> {
  const root = `${ns}/project`;
  const surface = new OpfsVfs();
  await surface.init();
  const fs = await OpfsFsSync.init(surface);
  const stamps = wireAuthority(fs);

  // ADR-0358 reload honesty: never trust a stamp over an unproven tree.
  const pre = await bootPathTrusts(stamps, root);

  const claim = await stamps.demote({ root, slug: SLUG });
  fs.mkdirSync(`${root}/node_modules`, { recursive: true });
  fs.writeFileSync(`${root}/package.json`, enc.encode(PACKAGE_JSON));
  const { spotPath } = writeInstallTree(fs, root);
  const promotion = await stamps.promote(
    { root, slug: SLUG, packageJsonText: PACKAGE_JSON },
    { epoch: claim.epoch, packages: PKG_COUNT, flush: () => fs.flush() },
  );
  const post = await bootPathTrusts(stamps, root);
  const report = await fs.flush();

  // Durability proven through a FRESH surface, never the writing one.
  const reopened = new OpfsVfs();
  await reopened.init();
  const bytes = await reopened.readFile(spotPath).catch(() => null);
  const expected = fileBytes(PKG_COUNT - 1, FILES_PER_PKG - 1);
  const spotByteVerified =
    bytes !== null &&
    bytes.byteLength === expected.byteLength &&
    bytes.every((byte, index) => byte === expected[index]);

  const storage = (
    navigator as unknown as { storage: { getDirectory(): Promise<FileSystemDirectoryHandle> } }
  ).storage;
  const realRoot = await storage.getDirectory();
  await realRoot.removeEntry(ns.slice(1), { recursive: true }).catch(() => {});

  return {
    preTrusted: pre.trusted,
    preCheckStatus: pre.status,
    promoteStatus: promotion.status,
    postTrusted: post.trusted,
    reportTotal: report.total,
    spotByteVerified,
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
