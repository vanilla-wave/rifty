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
 * Paths 2 and 3 finish by stamping the tree. Durability ordering is the
 * write-through queue's FIFO (ADR-0187): the stamp is enqueued after every
 * tree write, so a durable stamp implies a durable tree WITHOUT a blocking
 * drain on the boot path. Any snapshot failure — fetch, deps drift, restore —
 * degrades to install; a broken asset never bricks the boot. Extracted from
 * the worker bootstrap so the priority logic is unit-testable outside a
 * worker realm.
 */
import { type Vfs, joinPath } from '@riftydev/vfs';
import {
  type DepSnapshotV1,
  fetchDepSnapshot as realFetchDepSnapshot,
  restoreDepSnapshot,
} from './dep-snapshot.ts';
import {
  depsEqual,
  installStampSatisfied,
  readEffectiveDeps,
  writeInstallStamp,
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
  readonly fetchSnapshot?: (url: string) => Promise<DepSnapshotV1 | null>;
}

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

  if (opts.snapshotUrl) {
    const restored = await tryRestoreSnapshot(opts, opts.snapshotUrl);
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
  await stampTree(opts, result.packages);
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
): Promise<EnsureProjectDepsResult | null> {
  const fetchSnapshot = opts.fetchSnapshot ?? realFetchDepSnapshot;
  const snapshot = await fetchSnapshot(url);
  if (!snapshot) {
    opts.log(`[real-vite/worker] baked snapshot unavailable (${url}) — falling back to install\n`);
    return null;
  }
  const deps = await readEffectiveDeps(opts.vfs, opts.root);
  const expectedSnapshotTemplateId = opts.snapshotTemplateId ?? opts.templateId;
  if (
    snapshot.templateId !== expectedSnapshotTemplateId ||
    !deps ||
    !depsEqual(snapshot.deps, deps)
  ) {
    opts.log(
      '[real-vite/worker] baked snapshot is stale (deps drifted; re-run `pnpm snapshots:bake`) — falling back to install\n',
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
  await stampTree(opts, snapshot.packages);
  opts.log(
    `[real-vite/worker] baked node_modules restored (${snapshot.packages} packages, no install needed)\n`,
  );
  return { source: 'snapshot', packages: snapshot.packages };
}

/** Non-blocking stamp (ADR-0187): the stamp's write-through is enqueued after
 * every tree write, so FIFO ordering lands it after the tree — no drain on
 * the boot path. UNCHECKED by design (a drain here would re-add ~0.5s to
 * boot): a swallowed per-op persist failure can still stamp a torn tree —
 * ADR-0187 Corrected gates only the visible `npm install`.
 * TODO(backlog: playground/boot-restore-stamp-unchecked-persist) */
async function stampTree(opts: EnsureProjectDepsOptions, packages: number): Promise<void> {
  await writeInstallStamp(opts.vfs, opts.root, packages, opts.slug);
}
