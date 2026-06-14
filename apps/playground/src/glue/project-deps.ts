/**
 * Dependency arrival for a real-project boot (ADR-0135), in priority order:
 *
 *   1. **stamp** — a tree stamped for THIS project `slug` already sits in OPFS
 *      (reuse is keyed on the slug, not the deps: two projects can share deps
 *      yet must not reuse each other's tree) → do nothing;
 *   2. **snapshot** — a baked asset matching the template AND the current
 *      package.json deps → restore it (no network, no resolver);
 *   3. **install** — real `install()` through the registry.
 *
 * from-scratch presets pass no `snapshotUrl`, so on a slug miss they run the
 * visible install (never a silent snapshot restore). Because the slug differs
 * from the instant default that shares the same template, a from-scratch preset
 * shows its install even when OPFS was already warmed by an instant preset.
 *
 * Paths 2 and 3 finish by stamping the tree (flush → stamp → flush, so a
 * durable stamp implies a durable tree). Any snapshot failure — fetch,
 * deps drift, restore — degrades to install; a broken asset never bricks
 * the boot. Extracted from the worker bootstrap so the priority logic is
 * unit-testable outside a worker realm.
 */
import type { Vfs } from '@riftydev/vfs';
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

export type ProjectDepsSource = 'stamp' | 'snapshot' | 'install';

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
  /** Project identity (preset slug) — the install-stamp reuse key. A stamp from
   *  a different slug never suppresses this project's install. */
  readonly slug: string;
  /** Baked snapshot URL; absent → straight to install on a stampless boot. */
  readonly snapshotUrl?: string;
  /** Runs the real installer; returns the installed package count. */
  readonly install: () => Promise<{ readonly packages: number }>;
  /** Drains the VFS write-through (stamp durability ordering). */
  readonly flush: () => Promise<void>;
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

  const result = await opts.install();
  await stampTree(opts, result.packages);
  return { source: 'install', packages: result.packages };
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
  if (snapshot.templateId !== opts.templateId || !deps || !depsEqual(snapshot.deps, deps)) {
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

async function stampTree(opts: EnsureProjectDepsOptions, packages: number): Promise<void> {
  await opts.flush();
  await writeInstallStamp(opts.vfs, opts.root, packages, opts.slug);
  await opts.flush();
}
