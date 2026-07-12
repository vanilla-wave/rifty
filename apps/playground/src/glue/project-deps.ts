/**
 * Dependency arrival for a real-project boot (ADR-0135), in priority order:
 *
 *   1. **stamp** — a tree stamped for THIS project `slug` already sits in OPFS
 *      (reuse is keyed on the slug, not the deps: two projects can share deps
 *      yet must not reuse each other's tree) → do nothing;
 *   2. **snapshot** — a baked asset matching the template AND the current
 *      package.json deps → restore it (no network, no resolver);
 *   3. **install** — clear any foreign node_modules + lockfile (a prior preset's
 *      tree poisons a from-scratch install — EBROKENLOCK), then real `install()`
 *      through the registry.
 *
 * from-scratch presets pass no `snapshotUrl`, so on a slug miss they run the
 * visible install (never a silent snapshot restore). Because the slug differs
 * from the instant default that shares the same template, a from-scratch preset
 * shows its install even when OPFS was already warmed by an instant preset.
 *
 * Paths 2 and 3 finish by stamping the tree. On OPFS, boot/restore first writes
 * a PENDING stamp (visible but untrusted), then a fire-and-forget drain promotes
 * it to a trusted stamp only after the tree is clean. The dev line never waits;
 * a reload before promotion just re-runs dependency arrival. Any snapshot
 * failure — fetch, deps drift, restore — degrades to install; a broken asset
 * never bricks the boot. Extracted from the worker bootstrap so the priority
 * logic is unit-testable outside a worker realm.
 */
import { type PersistFailureReport, type Vfs, joinPath } from '@riftydev/vfs';
import {
  type DepSnapshotV2,
  fetchDepSnapshot as realFetchDepSnapshot,
  restoreDepSnapshot,
} from './dep-snapshot.ts';
import { installArtifactIdentity } from './install-artifact-identity.ts';
import {
  createInstallStamp,
  installStampPath,
  installStampSatisfied,
  isStampedTreeDamage,
  readInstallStamp,
  readInstallStampSync,
  readPackageJsonText,
  reportHasFailure,
} from './install-stamp.ts';
import type { WorkspaceArchiveFs } from './workspace-archive.ts';

export type ProjectDepsSource = 'stamp' | 'snapshot' | 'install' | 'none';

export interface EnsureProjectDepsResult {
  readonly source: ProjectDepsSource;
  readonly packages: number;
}

export interface EnsureProjectDepsOptions {
  /** Async surface of the realm's VFS (stamp + package.json reads). */
  readonly vfs: Vfs;
  /** Sync surface of the SAME store (archive restore writes). */
  readonly fsSync: WorkspaceArchiveFs;
  readonly root: string;
  readonly templateId: string;
  /** Expected `templateId` inside the baked snapshot. Defaults to `templateId`. */
  readonly snapshotTemplateId?: string;
  /** Project identity (preset slug) — the install-stamp reuse key. A stamp from
   *  a different slug never suppresses this project's install. */
  readonly slug: string;
  /** Baked snapshot URL; absent → no snapshot restore. */
  readonly snapshotUrl?: string;
  /**
   * Runs the real installer; returns the installed package count. OPTIONAL:
   * omit for a RESTORE-ONLY call (instant preset at owner-seed) — then a stampless,
   * snapshotless tree resolves to `'none'` (deps left absent) instead of a
   * network install. The faithful from-scratch install is the explicit `npm install`
   * command, never a dev-line side effect.
   */
  readonly install?: () => Promise<{ readonly packages: number }>;
  readonly log: (line: string) => void;
  /** Test seam; defaults to fetch + gunzip + parse. */
  readonly fetchSnapshot?: (url: string) => Promise<DepSnapshotV2 | null>;
  /**
   * Drains the realm's OPFS write-through and reports persist failures
   * (ADR-0187 Corrected). NEVER awaited on the boot critical path — it promotes
   * a PENDING stamp after a clean drain or discards it after tree damage.
   * Optional: absent on the memory backend and in restore-only harnesses.
   */
  readonly flush?: () => Promise<PersistFailureReport | undefined>;
}

let arrivalEpochSeq = 0;
let pendingPromotionSeq = 0;
const arrivalEpochByRoot = new Map<string, number>();
const stampEncoder = new TextEncoder();
const stampDecoder = new TextDecoder('utf-8');

export async function ensureProjectDependencies(
  opts: EnsureProjectDepsOptions,
): Promise<EnsureProjectDepsResult> {
  const stamp = await installStampSatisfied(opts.vfs, opts.root, opts.slug);
  if (stamp) {
    opts.log(
      `[real-vite/worker] node_modules reused via install stamp (${stamp.packages} packages, install skipped)\n`,
    );
    return { source: 'stamp', packages: stamp.packages };
  }

  const arrivalEpoch = beginDependencyArrival(opts.root);

  if (opts.snapshotUrl) {
    const restored = await tryRestoreSnapshot(opts, opts.snapshotUrl, arrivalEpoch);
    if (restored) return restored;
  }

  // Restore-only mode (no `install` provided): instant deps come SOLELY from the
  // baked snapshot. A stampless, snapshotless (or drifted) tree leaves node_modules
  // ABSENT — the dev line never installs as a side effect; from-scratch uses the
  // explicit `npm install` command. (Real Node: a missing dep is a loud failure.)
  if (!opts.install) {
    return { source: 'none', packages: 0 };
  }

  // Reaching install() means NO stamp matched this slug and NO snapshot applied —
  // so any node_modules + lockfile on disk belong to a DIFFERENT preset (e.g.
  // project-files' instant baked snapshot, whose lockfile omits the shimmed
  // esbuild). A from-scratch install over that tree trips the installer's
  // lockfile-coverage check (EBROKENLOCK) — and the owner's preset-switch clean is
  // keyed on templateId, so it skips presets that share one (project-files /
  // node-worker / real-vite are all `vite`). Clear the foreign tree HERE so the
  // install is truly from-scratch — independent of the owner's in-memory switch
  // state, so it also holds across a reload that re-boots a from-scratch preset.
  clearProjectTree(opts.fsSync, opts.root);

  const result = await opts.install();
  await stampTree(opts, result.packages, arrivalEpoch);
  return { source: 'install', packages: result.packages };
}

/** Drop a foreign/stale node_modules + lockfile so a from-scratch install starts
 *  clean (best-effort: a fresh boot has nothing to remove). */
export function clearProjectTree(fsSync: WorkspaceArchiveFs, root: string): void {
  fsSync.rmSync(joinPath(root, 'node_modules'), { recursive: true, force: true });
  fsSync.rmSync(joinPath(root, 'package-lock.json'), { force: true });
}

async function tryRestoreSnapshot(
  opts: EnsureProjectDepsOptions,
  url: string,
  arrivalEpoch: number,
): Promise<EnsureProjectDepsResult | null> {
  const fetchSnapshot = opts.fetchSnapshot ?? realFetchDepSnapshot;
  const snapshot = await fetchSnapshot(url);
  if (!snapshot) {
    opts.log(`[real-vite/worker] baked snapshot unavailable (${url}) — falling back to install\n`);
    return null;
  }
  const packageJsonText = await readPackageJsonText(opts.vfs, opts.root);
  const expectedSnapshotTemplateId = opts.snapshotTemplateId ?? opts.templateId;
  if (
    snapshot.templateId !== expectedSnapshotTemplateId ||
    packageJsonText === null ||
    snapshot.packageJsonText !== packageJsonText ||
    snapshot.installArtifactIdentity !== installArtifactIdentity
  ) {
    opts.log(
      '[real-vite/worker] baked snapshot is stale (package.json or install artifacts drifted; re-run `pnpm snapshots:bake`) — falling back to install\n',
    );
    return null;
  }
  try {
    restoreDepSnapshot(opts.fsSync, opts.root, snapshot);
  } catch (err) {
    opts.log(
      `[real-vite/worker] baked snapshot restore failed: ${(err as Error).message} — falling back to install\n`,
    );
    return null;
  }
  await stampTree(opts, snapshot.packages, arrivalEpoch);
  opts.log(
    `[real-vite/worker] baked node_modules restored (${snapshot.packages} packages, no install needed)\n`,
  );
  return { source: 'snapshot', packages: snapshot.packages };
}

function beginDependencyArrival(root: string): number {
  arrivalEpochSeq += 1;
  arrivalEpochByRoot.set(root, arrivalEpochSeq);
  return arrivalEpochSeq;
}

function arrivalStillCurrent(root: string, epoch: number): boolean {
  return arrivalEpochByRoot.get(root) === epoch;
}

function nextPendingPromotionId(epoch: number): string {
  pendingPromotionSeq += 1;
  return `${epoch}:${pendingPromotionSeq}`;
}

function readPackageJsonTextSync(fsSync: WorkspaceArchiveFs, root: string): string | null {
  const path = joinPath(root, 'package.json');
  if (!fsSync.existsSync(path)) return null;
  try {
    return stampDecoder.decode(fsSync.readFileBytesSync(path));
  } catch {
    return null;
  }
}

function writeInstallStampSync(
  opts: EnsureProjectDepsOptions,
  packages: number,
  durability?: 'pending',
  promotionId?: string,
): boolean {
  const packageJsonText = readPackageJsonTextSync(opts.fsSync, opts.root);
  if (packageJsonText === null) return false;
  writeInstallStampForPackageJsonSync(opts, packageJsonText, packages, durability, promotionId);
  return true;
}

function writeInstallStampForPackageJsonSync(
  opts: EnsureProjectDepsOptions,
  packageJsonText: string,
  packages: number,
  durability?: 'pending',
  promotionId?: string,
): void {
  const stamp = createInstallStamp(packageJsonText, {
    slug: opts.slug,
    packages,
    ...(durability === 'pending' ? { durability } : {}),
    ...(durability === 'pending' && promotionId ? { promotionId } : {}),
  });
  if (!stamp) return;
  opts.fsSync.mkdirSync(joinPath(opts.root, 'node_modules'), { recursive: true });
  opts.fsSync.writeFileSync(
    installStampPath(opts.root),
    stampEncoder.encode(`${JSON.stringify(stamp, null, 2)}\n`),
  );
}

async function pendingPromotionStillCurrent(
  opts: EnsureProjectDepsOptions,
  packages: number,
  arrivalEpoch: number,
  promotionId: string,
  packageJsonText: string,
): Promise<boolean> {
  if (!arrivalStillCurrent(opts.root, arrivalEpoch)) return false;
  const stamp = await readInstallStamp(opts.vfs, opts.root);
  if (!arrivalStillCurrent(opts.root, arrivalEpoch)) return false;
  return (
    stamp?.durability === 'pending' &&
    stamp.promotionId === promotionId &&
    stamp.slug === opts.slug &&
    stamp.packages === packages &&
    stamp.packageJsonText === packageJsonText &&
    stamp.installArtifactIdentity === installArtifactIdentity
  );
}

/** Non-blocking stamp (ADR-0187): OPFS-backed boot/restore writes a PENDING
 * stamp first. Pending stamps are never trusted by `installStampSatisfied`, so
 * a crash/reload before the deferred drain re-runs arrival instead of trusting
 * an unproven tree. The deferred drain promotes the stamp after a clean report
 * or discards it after tree damage. Memory/no-flush harnesses have no durability
 * tier, so they keep the old immediate trusted stamp. */
async function stampTree(
  opts: EnsureProjectDepsOptions,
  packages: number,
  arrivalEpoch: number,
): Promise<void> {
  if (!opts.flush) {
    writeInstallStampSync(opts, packages);
    return;
  }
  if (!arrivalStillCurrent(opts.root, arrivalEpoch)) return;
  const promotionId = nextPendingPromotionId(arrivalEpoch);
  const packageJsonText = readPackageJsonTextSync(opts.fsSync, opts.root);
  if (packageJsonText === null) return;
  writeInstallStampForPackageJsonSync(opts, packageJsonText, packages, 'pending', promotionId);
  scheduleStampDurabilityCheck(opts, packages, arrivalEpoch, promotionId, packageJsonText);
}

/**
 * Fire-and-forget: drain → inspect ledger → promote or discard the PENDING
 * stamp. Only failures INSIDE the stamped tree (`<root>/node_modules`, minus
 * the stamp file itself) count as tree damage: a foreign/global path failing to
 * persist (`/.rifty/eddy-learned-pins.json`, another project's tree) is not THIS
 * tree torn and must not block promotion (`isStampedTreeDamage`). A stamp-file
 * failure means the pending marker itself was not durable, so promotion is
 * skipped; a later boot will re-run arrival instead of trusting a stamp.
 */
function scheduleStampDurabilityCheck(
  opts: EnsureProjectDepsOptions,
  packages: number,
  arrivalEpoch: number,
  promotionId: string,
  packageJsonText: string,
): void {
  const flush = opts.flush;
  if (!flush) return;
  const stampPath = installStampPath(opts.root);
  void (async () => {
    const report = await flush();
    if (
      !(await pendingPromotionStillCurrent(
        opts,
        packages,
        arrivalEpoch,
        promotionId,
        packageJsonText,
      ))
    ) {
      return;
    }
    // Ask the FULL ledger (`reportHasFailure`), not the 20-entry sample: foreign
    // failures could fill the sample while `node_modules` damage sits beyond it,
    // and trusting a stamp over a torn tree is exactly what this check exists
    // to prevent. The example for the message comes from the sample when present.
    if (report && reportHasFailure(report, (p) => isStampedTreeDamage(p, opts.root))) {
      const example = report.failures.find((f) => isStampedTreeDamage(f.path, opts.root));
      const sample = example ? ` (first: ${example.op} ${example.path}: ${example.message})` : '';
      opts.fsSync.rmSync(stampPath, { force: true });
      opts.log(
        `[real-vite/worker] WARNING: node_modules failed to persist${sample} — pending install stamp discarded; the next boot re-runs dependency arrival instead of trusting a torn tree\n`,
      );
      const after = await flush();
      if (after && reportHasFailure(after, (p) => p === stampPath)) {
        opts.log(
          '[real-vite/worker] WARNING: pending install stamp delete did not reach disk — it remains untrusted and a later boot will re-run dependency arrival\n',
        );
      }
      return;
    }
    if (report && reportHasFailure(report, (p) => p === stampPath)) {
      opts.log(
        '[real-vite/worker] WARNING: pending install stamp failed to persist — promotion skipped; the next boot re-runs dependency arrival\n',
      );
      return;
    }

    const currentPackageJsonText = readPackageJsonTextSync(opts.fsSync, opts.root);
    if (currentPackageJsonText !== packageJsonText) {
      opts.fsSync.rmSync(stampPath, { force: true });
      opts.log(
        '[real-vite/worker] WARNING: package.json deps changed before install stamp promotion — pending install stamp discarded; the next boot re-runs dependency arrival\n',
      );
      const after = await flush();
      if (after && reportHasFailure(after, (p) => p === stampPath)) {
        opts.log(
          '[real-vite/worker] WARNING: stale pending install stamp delete did not reach disk — it remains untrusted and a later boot will re-run dependency arrival\n',
        );
      }
      return;
    }
    if (!arrivalStillCurrent(opts.root, arrivalEpoch)) return;
    // SYNC recheck AT the write: pendingPromotionStillCurrent's async read
    // can resolve, then a command-site demote (a pending stamp with no
    // promotionId) lands before this continuation runs — the stale read must
    // not promote over it. Sync read + sync write = atomic in-realm.
    const atWrite = readInstallStampSync(opts.fsSync, opts.root);
    if (atWrite?.durability !== 'pending' || atWrite.promotionId !== promotionId) return;
    writeInstallStampForPackageJsonSync(opts, packageJsonText, packages);
    const promoted = await flush();
    if (!arrivalStillCurrent(opts.root, arrivalEpoch)) return;
    const promotedPackageJsonText = readPackageJsonTextSync(opts.fsSync, opts.root);
    if (promotedPackageJsonText !== packageJsonText) {
      opts.fsSync.rmSync(stampPath, { force: true });
      opts.log(
        '[real-vite/worker] WARNING: package.json deps changed during install stamp promotion — install stamp revoked; the next boot re-runs dependency arrival\n',
      );
      await flush();
      return;
    }
    if (promoted && reportHasFailure(promoted, (p) => isStampedTreeDamage(p, opts.root))) {
      opts.fsSync.rmSync(stampPath, { force: true });
      opts.log(
        '[real-vite/worker] WARNING: node_modules failed to persist during stamp promotion — install stamp revoked; the next boot re-runs dependency arrival\n',
      );
      await flush();
      return;
    }
    if (promoted && reportHasFailure(promoted, (p) => p === stampPath)) {
      opts.log(
        '[real-vite/worker] WARNING: trusted install stamp promotion did not reach disk — this session can reuse the tree, but a later boot will re-run dependency arrival\n',
      );
    }
  })().catch((err) => {
    // The check itself failing (rm error, throwing flush impl) must not
    // surface as an unhandled rejection — but it must not stay silent either.
    opts.log(
      `[real-vite/worker] WARNING: stamp durability check failed: ${(err as Error).message}\n`,
    );
  });
}
