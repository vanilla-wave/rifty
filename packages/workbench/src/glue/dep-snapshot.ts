/**
 * Baked dependency snapshot (ADR-0135): a template's fully installed
 * node_modules tree + lockfile replay cache, serialized at bake time (`pnpm snapshots:bake`)
 * and shipped as a same-origin gzipped JSON asset. The worker bootstrap
 * restores it on a stampless boot instead of running `install()`; runtime
 * assets follow the separate verified-store contract (ADR-0320).
 *
 * Snapshot v3 carries the exact package.json text, install-artifact identity,
 * and integrity-verified cache closure that produced the tree (ADR-0346).
 */
import {
  TARBALL_CACHE_ROOT,
  computeIntegrity,
  parseIntegrityAlgorithm,
  tarballCachePath,
} from '@riftydev/npm-client';
import { planShadowSubstitutionsFromLockfile } from '@riftydev/npm-client/internal';
import { joinPath } from '@riftydev/vfs';
import { drainByteStreamBounded, fetchAssetBytesBounded } from './bounded-asset-fetch.ts';
import { installArtifactIdentity } from './install-artifact-identity.ts';
import { depsEqual, effectiveDepsFromPackageJsonText } from './install-stamp.ts';
import {
  type WorkspaceArchiveFs,
  type WorkspaceArchiveV1,
  buildWorkspaceArchive,
  prepareWorkspaceArchiveImport,
} from './workspace-archive.ts';

export interface DepSnapshotV3 {
  readonly version: 3;
  readonly templateId: string;
  readonly packageJsonText: string;
  readonly installArtifactIdentity: string;
  /** Effective dep request the baked tree satisfies (deps ∪ dev ∪ optional). */
  readonly deps: Readonly<Record<string, string>>;
  /** Installed package count — recorded into the install stamp on restore. */
  readonly packages: number;
  /** package-lock.json text — keeps later explicit installs on the fast path. */
  readonly lockfile: string;
  /** Exact tarballs required to replay registry-backed shadow substitutions offline. */
  readonly tarballCache: WorkspaceArchiveV1;
  /** The node_modules subtree (nested copies included). */
  readonly nodeModules: WorkspaceArchiveV1;
}

export interface PreparedDepSnapshotRestore {
  apply(): void;
}

export type VerifiedDepSnapshot =
  | { readonly status: 'matched'; readonly snapshot: DepSnapshotV3 }
  | { readonly status: 'mismatch' };

/** One byte-stable top-level order for bake and provenance tooling. */
export function serializeDepSnapshot(snapshot: DepSnapshotV3): string {
  return JSON.stringify({
    version: snapshot.version,
    templateId: snapshot.templateId,
    deps: snapshot.deps,
    packages: snapshot.packages,
    packageJsonText: snapshot.packageJsonText,
    installArtifactIdentity: snapshot.installArtifactIdentity,
    lockfile: snapshot.lockfile,
    tarballCache: snapshot.tarballCache,
    nodeModules: snapshot.nodeModules,
  });
}

const enc = new TextEncoder();
const SNAPSHOT_MAX_BYTES = 128 * 1024 * 1024;

export type DepSnapshotFetchStage = 'fetch' | 'decompress' | 'parse';

/** Exact boundary failure; acquisition records it before choosing real install. */
export class DepSnapshotFetchError extends Error {
  readonly code = 'DEP_SNAPSHOT_FETCH_FAILED' as const;

  constructor(
    readonly url: string,
    readonly stage: DepSnapshotFetchStage,
    cause: unknown,
  ) {
    super(`Dependency snapshot ${url} ${stage} failed: ${errorReason(cause)}`, { cause });
    this.name = 'DepSnapshotFetchError';
  }
}

function errorReason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Serialize the installed tree at `<root>` into a snapshot (bake script). */
export function buildDepSnapshot(
  fs: WorkspaceArchiveFs,
  root: string,
  meta: {
    readonly templateId: string;
    readonly deps: Record<string, string>;
    readonly packages: number;
  },
): DepSnapshotV3 {
  const packageJsonPath = joinPath(root, 'package.json');
  if (!fs.existsSync(packageJsonPath)) {
    throw new Error('Cannot build dep snapshot without package.json');
  }
  const packageJsonText = new TextDecoder().decode(fs.readFileBytesSync(packageJsonPath));
  const lockfilePath = joinPath(root, 'package-lock.json');
  const lockfile = fs.existsSync(lockfilePath)
    ? new TextDecoder().decode(fs.readFileBytesSync(lockfilePath))
    : '';
  const tarballCache = buildReplayCacheArchive(fs, lockfile);
  // exclude: [] — the default exclusion list contains 'node_modules', which
  // would silently drop the nested copies nest-on-conflict creates.
  const nodeModules = buildWorkspaceArchive(fs, joinPath(root, 'node_modules'), { exclude: [] });
  return {
    version: 3,
    ...meta,
    packageJsonText,
    installArtifactIdentity,
    lockfile,
    tarballCache,
    nodeModules,
  };
}

export function parseDepSnapshot(json: string): DepSnapshotV3 {
  const parsed = JSON.parse(json) as DepSnapshotV3;
  if (parsed.version !== 3) {
    throw new Error(`Unsupported dep snapshot version ${parsed.version}`);
  }
  if (
    typeof parsed.templateId !== 'string' ||
    typeof parsed.packageJsonText !== 'string' ||
    typeof parsed.installArtifactIdentity !== 'string' ||
    !/^sha256:[0-9a-f]{64}$/.test(parsed.installArtifactIdentity) ||
    typeof parsed.packages !== 'number' ||
    !Number.isSafeInteger(parsed.packages) ||
    parsed.packages < 0
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
  if (typeof parsed.lockfile !== 'string' || !parsed.tarballCache || !parsed.nodeModules) {
    throw new Error('Malformed dep snapshot: missing lockfile/tarballCache/nodeModules');
  }
  return parsed;
}

/**
 * Write the snapshot's tree into `<root>`: node_modules is REPLACED (a stale
 * partial tree must not shadow baked files), the lockfile overwrites.
 */
export async function restoreDepSnapshot(
  fs: WorkspaceArchiveFs,
  root: string,
  snapshot: DepSnapshotV3,
): Promise<void> {
  (await prepareDepSnapshotRestore(fs, root, snapshot)).apply();
}

/** Decode and validate the complete restore mapping before destination mutation. */
export async function prepareDepSnapshotRestore(
  fs: WorkspaceArchiveFs,
  root: string,
  snapshot: DepSnapshotV3,
): Promise<PreparedDepSnapshotRestore> {
  await verifyDepSnapshotReplayCache(snapshot);
  const nodeModules = prepareWorkspaceArchiveImport(fs, snapshot.nodeModules, {
    root: joinPath(root, 'node_modules'),
    replace: true,
    // ADR-0165: the snapshot is baked at one root but restored into the active
    // project root (/scratch or /projects/<id>); re-root the relative tree.
    rebase: true,
  });
  const tarballCache = prepareWorkspaceArchiveImport(fs, snapshot.tarballCache, {
    root: TARBALL_CACHE_ROOT,
    replace: false,
  });
  const lockfile = snapshot.lockfile.length > 0 ? enc.encode(snapshot.lockfile) : null;
  return {
    apply() {
      nodeModules.apply();
      // The global cache is shared across projects: merge this exact closure;
      // never replace unrelated warm entries. Publish the lockfile last.
      tarballCache.apply();
      if (lockfile) fs.writeFileSync(joinPath(root, 'package-lock.json'), lockfile);
    },
  };
}

interface ReplayCacheRequirement {
  readonly integrity: string;
  readonly name: string;
  readonly path: string;
  readonly relativePath: string;
  readonly version: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function replayCacheRequirements(lockfileText: string): readonly ReplayCacheRequirement[] {
  if (lockfileText.length === 0) return [];
  const plan = planShadowSubstitutionsFromLockfile(JSON.parse(lockfileText) as unknown);
  const byPath = new Map<string, ReplayCacheRequirement>();
  for (const substitution of plan.substitutions) {
    const acquisition = substitution.acquisition;
    if (acquisition.kind === 'synthetic') continue;
    if (parseIntegrityAlgorithm(acquisition.integrity) === null) {
      throw new Error(`Unsupported dep snapshot cache integrity for ${acquisition.name}`);
    }
    const path = tarballCachePath(acquisition.name, acquisition.version, acquisition.integrity);
    const requirement = {
      name: acquisition.name,
      version: acquisition.version,
      integrity: acquisition.integrity,
      path,
      relativePath: path.slice(TARBALL_CACHE_ROOT.length + 1),
    } satisfies ReplayCacheRequirement;
    const prior = byPath.get(path);
    if (prior && prior.integrity !== requirement.integrity) {
      throw new Error(`Dep snapshot cache key collision at "${path}"`);
    }
    byPath.set(path, requirement);
  }
  return [...byPath.values()].sort((left, right) => left.path.localeCompare(right.path));
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

function base64ToBytes(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function buildReplayCacheArchive(fs: WorkspaceArchiveFs, lockfile: string): WorkspaceArchiveV1 {
  const files = replayCacheRequirements(lockfile).map((requirement) => {
    if (!fs.existsSync(requirement.path)) {
      throw new Error(
        `Cannot build dep snapshot without replay cache ${requirement.name}@${requirement.version}`,
      );
    }
    return {
      path: requirement.relativePath,
      encoding: 'base64' as const,
      content: bytesToBase64(fs.readFileBytesSync(requirement.path)),
    };
  });
  return { version: 1, root: TARBALL_CACHE_ROOT, files };
}

/** Prove the portable cache is the exact integrity-pinned lockfile closure. */
export async function verifyDepSnapshotReplayCache(snapshot: DepSnapshotV3): Promise<void> {
  if (
    snapshot.tarballCache.version !== 1 ||
    snapshot.tarballCache.root !== TARBALL_CACHE_ROOT ||
    !Array.isArray(snapshot.tarballCache.files)
  ) {
    throw new Error('Malformed dep snapshot tarball cache archive');
  }
  const requirements = replayCacheRequirements(snapshot.lockfile);
  const files = new Map<string, string>();
  for (const file of snapshot.tarballCache.files) {
    if (
      !isRecord(file) ||
      typeof file.path !== 'string' ||
      file.encoding !== 'base64' ||
      typeof file.content !== 'string' ||
      files.has(file.path)
    ) {
      throw new Error('Malformed dep snapshot tarball cache entry');
    }
    files.set(file.path, file.content);
  }
  if (files.size !== requirements.length) {
    throw new Error('Dep snapshot tarball cache does not match its lockfile closure');
  }
  for (const requirement of requirements) {
    const content = files.get(requirement.relativePath);
    if (content === undefined) {
      throw new Error(
        `Dep snapshot is missing replay cache ${requirement.name}@${requirement.version}`,
      );
    }
    const algorithm = parseIntegrityAlgorithm(requirement.integrity);
    if (algorithm === null) {
      throw new Error(`Unsupported replay cache integrity for ${requirement.name}`);
    }
    const actual = await computeIntegrity(base64ToBytes(content), algorithm);
    if (actual !== requirement.integrity) {
      throw new Error(`Dep snapshot replay cache integrity mismatch for ${requirement.name}`);
    }
  }
}

/**
 * Fetch + gunzip + parse a baked snapshot. Failure is typed and reason-bearing;
 * the acquisition authority records it and falls back to a real install.
 *
 * Gzip is detected by MAGIC BYTES, not by URL or headers: some static servers
 * (vite dev among them) serve `.gz` with `Content-Encoding: gzip`, so the
 * browser hands us already-decoded JSON; others serve the raw gzip bytes.
 */
async function fetchDepSnapshotBytes(url: string): Promise<Uint8Array<ArrayBuffer>> {
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = await fetchAssetBytesBounded(url, {
      label: `dependency snapshot ${url}`,
      maxBytes: SNAPSHOT_MAX_BYTES,
    });
  } catch (error) {
    throw new DepSnapshotFetchError(url, 'fetch', error);
  }

  const gzipped = bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
  let decoded: Uint8Array<ArrayBuffer> = bytes;
  if (gzipped) {
    try {
      decoded = await drainByteStreamBounded(
        new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')),
        { label: `dependency snapshot ${url} decompression`, maxBytes: SNAPSHOT_MAX_BYTES },
      );
    } catch (error) {
      throw new DepSnapshotFetchError(url, 'decompress', error);
    }
  }

  return decoded;
}

function parseFetchedDepSnapshot(url: string, bytes: Uint8Array): DepSnapshotV3 {
  try {
    return parseDepSnapshot(new TextDecoder().decode(bytes));
  } catch (error) {
    throw new DepSnapshotFetchError(
      url,
      'parse',
      new Error(`dependency snapshot ${url}: ${errorReason(error)}`, { cause: error }),
    );
  }
}

async function sha256Identity(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes));
  let hex = '';
  for (const byte of digest) hex += byte.toString(16).padStart(2, '0');
  return `sha256:${hex}`;
}

export async function fetchVerifiedDepSnapshot(
  url: string,
  expectedSnapshotId: string,
): Promise<VerifiedDepSnapshot> {
  const bytes = await fetchDepSnapshotBytes(url);
  if ((await sha256Identity(bytes)) !== expectedSnapshotId) return { status: 'mismatch' };
  return { status: 'matched', snapshot: parseFetchedDepSnapshot(url, bytes) };
}

export async function fetchDepSnapshot(url: string): Promise<DepSnapshotV3> {
  return parseFetchedDepSnapshot(url, await fetchDepSnapshotBytes(url));
}
