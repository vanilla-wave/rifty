/**
 * Baked dependency snapshot (ADR-0135): a template's fully installed
 * node_modules tree + lockfile, serialized at bake time (`pnpm snapshots:bake`)
 * and shipped as a same-origin gzipped JSON asset. The worker bootstrap
 * restores it on a stampless boot instead of running `install()`, so the
 * first-ever open of an instant preset is truly instant.
 *
 * The snapshot carries the effective dep set it satisfies; restore is gated on
 * `depsEqual(snapshot.deps, package.json deps)` — a stale asset (template deps
 * bumped without re-baking) falls back to a real install, never a wrong tree.
 */
import { joinPath } from '@riftydev/vfs';
import {
  type WorkspaceArchiveFs,
  type WorkspaceArchiveV1,
  applyWorkspaceArchive,
  buildWorkspaceArchive,
} from './workspace-archive.ts';

export interface DepSnapshotV1 {
  readonly version: 1;
  readonly templateId: string;
  /** Effective dep request the baked tree satisfies (deps ∪ dev ∪ optional). */
  readonly deps: Readonly<Record<string, string>>;
  /** Installed package count — recorded into the install stamp on restore. */
  readonly packages: number;
  /** package-lock.json text — keeps later explicit installs on the fast path. */
  readonly lockfile: string;
  /** The node_modules subtree (nested copies included). */
  readonly nodeModules: WorkspaceArchiveV1;
}

const enc = new TextEncoder();

/** Serialize the installed tree at `<root>` into a snapshot (bake script). */
export function buildDepSnapshot(
  fs: WorkspaceArchiveFs,
  root: string,
  meta: {
    readonly templateId: string;
    readonly deps: Record<string, string>;
    readonly packages: number;
  },
): DepSnapshotV1 {
  const lockfilePath = joinPath(root, 'package-lock.json');
  const lockfile = fs.existsSync(lockfilePath)
    ? new TextDecoder().decode(fs.readFileBytesSync(lockfilePath))
    : '';
  // exclude: [] — the default exclusion list contains 'node_modules', which
  // would silently drop the nested copies nest-on-conflict creates.
  const nodeModules = buildWorkspaceArchive(fs, joinPath(root, 'node_modules'), { exclude: [] });
  return { version: 1, ...meta, lockfile, nodeModules };
}

export function parseDepSnapshot(json: string): DepSnapshotV1 {
  const parsed = JSON.parse(json) as DepSnapshotV1;
  if (parsed.version !== 1) {
    throw new Error(`Unsupported dep snapshot version ${parsed.version}`);
  }
  if (typeof parsed.templateId !== 'string' || typeof parsed.packages !== 'number') {
    throw new Error('Malformed dep snapshot: missing templateId/packages');
  }
  if (!parsed.deps || typeof parsed.deps !== 'object') {
    throw new Error('Malformed dep snapshot: missing deps');
  }
  if (typeof parsed.lockfile !== 'string' || !parsed.nodeModules) {
    throw new Error('Malformed dep snapshot: missing lockfile/nodeModules');
  }
  return parsed;
}

/**
 * Write the snapshot's tree into `<root>`: node_modules is REPLACED (a stale
 * partial tree must not shadow baked files), the lockfile overwrites.
 */
export function restoreDepSnapshot(
  fs: WorkspaceArchiveFs,
  root: string,
  snapshot: DepSnapshotV1,
): void {
  applyWorkspaceArchive(fs, snapshot.nodeModules, {
    root: joinPath(root, 'node_modules'),
    replace: true,
  });
  if (snapshot.lockfile.length > 0) {
    fs.writeFileSync(joinPath(root, 'package-lock.json'), enc.encode(snapshot.lockfile));
  }
}

/**
 * Fetch + gunzip + parse a baked snapshot. Returns `null` on ANY failure
 * (missing asset, network, decompression, malformed JSON) — the caller falls
 * back to a real install; a broken asset must never brick the boot.
 *
 * Gzip is detected by MAGIC BYTES, not by URL or headers: some static servers
 * (vite dev among them) serve `.gz` with `Content-Encoding: gzip`, so the
 * browser hands us already-decoded JSON; others serve the raw gzip bytes.
 */
export async function fetchDepSnapshot(url: string): Promise<DepSnapshotV1 | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const bytes = new Uint8Array(await response.arrayBuffer());
    const gzipped = bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
    const text = gzipped
      ? await new Response(
          new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')),
        ).text()
      : new TextDecoder().decode(bytes);
    return parseDepSnapshot(text);
  } catch {
    return null;
  }
}
