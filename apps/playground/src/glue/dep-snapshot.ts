/**
 * Baked dependency snapshot (ADR-0135): a template's fully installed
 * node_modules tree + lockfile, serialized at bake time (`pnpm snapshots:bake`)
 * and shipped as a same-origin gzipped JSON asset. The worker bootstrap
 * restores it on a stampless boot instead of running `install()`, so the
 * first-ever open of an instant preset is truly instant.
 *
 * Snapshot v2 carries the exact package.json text and install-artifact identity
 * that produced the tree. Restore compares both byte-for-byte (ADR-0241).
 */
import { joinPath } from '@riftydev/vfs';
import { drainByteStreamBounded, fetchAssetBytesBounded } from './bounded-asset-fetch.ts';
import { installArtifactIdentity } from './install-artifact-identity.ts';
import { depsEqual, effectiveDepsFromPackageJsonText } from './install-stamp.ts';
import {
  type WorkspaceArchiveFs,
  type WorkspaceArchiveV1,
  applyWorkspaceArchive,
  buildWorkspaceArchive,
} from './workspace-archive.ts';

export interface DepSnapshotV2 {
  readonly version: 2;
  readonly templateId: string;
  readonly packageJsonText: string;
  readonly installArtifactIdentity: string;
  /** Effective dep request the baked tree satisfies (deps ∪ dev ∪ optional). */
  readonly deps: Readonly<Record<string, string>>;
  /** Installed package count — recorded into the install stamp on restore. */
  readonly packages: number;
  /** package-lock.json text — keeps later explicit installs on the fast path. */
  readonly lockfile: string;
  /** The node_modules subtree (nested copies included). */
  readonly nodeModules: WorkspaceArchiveV1;
}

/** One byte-stable top-level order for bake and provenance tooling. */
export function serializeDepSnapshot(snapshot: DepSnapshotV2): string {
  return JSON.stringify({
    version: snapshot.version,
    templateId: snapshot.templateId,
    deps: snapshot.deps,
    packages: snapshot.packages,
    packageJsonText: snapshot.packageJsonText,
    installArtifactIdentity: snapshot.installArtifactIdentity,
    lockfile: snapshot.lockfile,
    nodeModules: snapshot.nodeModules,
  });
}

const enc = new TextEncoder();
const SNAPSHOT_MAX_BYTES = 128 * 1024 * 1024;

/** Serialize the installed tree at `<root>` into a snapshot (bake script). */
export function buildDepSnapshot(
  fs: WorkspaceArchiveFs,
  root: string,
  meta: {
    readonly templateId: string;
    readonly deps: Record<string, string>;
    readonly packages: number;
  },
): DepSnapshotV2 {
  const packageJsonPath = joinPath(root, 'package.json');
  if (!fs.existsSync(packageJsonPath)) {
    throw new Error('Cannot build dep snapshot without package.json');
  }
  const packageJsonText = new TextDecoder().decode(fs.readFileBytesSync(packageJsonPath));
  const lockfilePath = joinPath(root, 'package-lock.json');
  const lockfile = fs.existsSync(lockfilePath)
    ? new TextDecoder().decode(fs.readFileBytesSync(lockfilePath))
    : '';
  // exclude: [] — the default exclusion list contains 'node_modules', which
  // would silently drop the nested copies nest-on-conflict creates.
  const nodeModules = buildWorkspaceArchive(fs, joinPath(root, 'node_modules'), { exclude: [] });
  return {
    version: 2,
    ...meta,
    packageJsonText,
    installArtifactIdentity,
    lockfile,
    nodeModules,
  };
}

export function parseDepSnapshot(json: string): DepSnapshotV2 {
  const parsed = JSON.parse(json) as DepSnapshotV2;
  if (parsed.version !== 2) {
    throw new Error(`Unsupported dep snapshot version ${parsed.version}`);
  }
  if (
    typeof parsed.templateId !== 'string' ||
    typeof parsed.packageJsonText !== 'string' ||
    typeof parsed.installArtifactIdentity !== 'string' ||
    !/^sha256:[0-9a-f]{64}$/.test(parsed.installArtifactIdentity) ||
    typeof parsed.packages !== 'number'
  ) {
    throw new Error('Malformed dep snapshot: missing templateId/packages');
  }
  if (!parsed.deps || typeof parsed.deps !== 'object' || Array.isArray(parsed.deps)) {
    throw new Error('Malformed dep snapshot: missing deps');
  }
  const exactDeps = effectiveDepsFromPackageJsonText(parsed.packageJsonText);
  if (!exactDeps || !depsEqual(parsed.deps, exactDeps)) {
    throw new Error('Malformed dep snapshot: deps do not match packageJsonText');
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
  snapshot: DepSnapshotV2,
): void {
  applyWorkspaceArchive(fs, snapshot.nodeModules, {
    root: joinPath(root, 'node_modules'),
    replace: true,
    // ADR-0165: the snapshot is baked at one root but restored into the active
    // project root (/scratch or /projects/<id>); re-root the relative tree.
    rebase: true,
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
export async function fetchDepSnapshot(url: string): Promise<DepSnapshotV2 | null> {
  try {
    const bytes = await fetchAssetBytesBounded(url, {
      label: `dependency snapshot ${url}`,
      maxBytes: SNAPSHOT_MAX_BYTES,
    });
    const gzipped = bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
    const decoded = gzipped
      ? await drainByteStreamBounded(
          new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')),
          { label: `dependency snapshot ${url} decompression`, maxBytes: SNAPSHOT_MAX_BYTES },
        )
      : bytes;
    const text = new TextDecoder().decode(decoded);
    return parseDepSnapshot(text);
  } catch {
    return null;
  }
}
