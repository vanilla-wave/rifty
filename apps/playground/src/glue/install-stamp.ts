/**
 * Install stamp (ADR-0135): `<root>/node_modules/.rifty-install-stamp.json`
 * marks "this node_modules was installed for project SLUG". The worker bootstrap
 * skips its `install()` when the stamp's slug matches the project being booted —
 * that skip is what makes a re-opened project fast.
 *
 * Reuse key = the project SLUG (preset id), NOT the dep set: two projects can
 * share dependencies (e.g. `project-files` and `real-vite` both run `vite`) yet
 * must not reuse each other's tree — otherwise a from-scratch preset would skip
 * the very install it exists to show. package.json deps are kept as a secondary
 * freshness guard.
 *
 * Trust model: the stamp trusts the tree wholesale — no per-file verification.
 * Durability ordering (ADR-0187 Corrected): trusted stamps mean durable tree.
 * Every transition is owned by `install-stamp-authority.ts`; pending stamps
 * never satisfy reuse and are promoted only after a clean durability proof.
 */
// TODO(backlog: playground/install-stamp-invalidation)
import {
  type PersistFailureReport,
  type Vfs,
  isAbsolute,
  joinPath,
  normalizePath,
} from '@riftydev/vfs';
import { installArtifactIdentity } from './install-artifact-identity.ts';

export interface InstallStamp {
  readonly version: 3;
  /** Canonical absolute project root this claim was minted for. */
  readonly root: string;
  /** Project identity (preset slug) the tree was installed for — the reuse key. */
  readonly slug: string;
  /** Exact request bytes that produced the tree; never a flattened projection. */
  readonly packageJsonText: string;
  /** Exact installer/shim/generated-runtime policy that produced the tree. */
  readonly installArtifactIdentity: string;
  /** package.json effective request: dependencies ∪ devDependencies ∪
   *  optionalDependencies (secondary freshness guard alongside the slug). */
  readonly deps: Readonly<Record<string, string>>;
  /** `result.packages.length` of the install that produced the tree. */
  readonly packages: number;
  /** Pending boot/restore stamps are visible for diagnostics but never trusted. */
  readonly durability?: 'pending';
  /** Authority-issued per-claim fence; present only while pending. */
  readonly epoch?: string;
}

/** The dependency tree the stamp attests durable: `<root>/node_modules`. The
 * stamp trusts THIS subtree wholesale — so only persist failures UNDER it mean
 * the stamped tree is torn. A global/foreign path failing to persist (e.g.
 * `/.rifty/eddy-learned-pins.json`, another project's tree) must NOT gate or
 * revoke this project's stamp. */
export function installTreeDir(root: string): string {
  return joinPath(root, 'node_modules');
}

export const INSTALL_STAMP_BASENAME = '.rifty-install-stamp.json';

export function installStampPath(root: string): string {
  return joinPath(installTreeDir(root), INSTALL_STAMP_BASENAME);
}

/** True for a reserved claim location or anything structurally below it. */
export function isInstallStampPath(path: string): boolean {
  if (!isAbsolute(path)) return false;
  const normalized = normalizePath(path);
  const suffix = `/node_modules/${INSTALL_STAMP_BASENAME}`;
  return normalized === suffix || normalized.endsWith(suffix) || normalized.includes(`${suffix}/`);
}

/** True iff `path` is inside the stamped tree AND is not the stamp file itself
 * (a stamp-file failure is not a torn TREE: no stamp on disk simply re-runs
 * arrival; a stamp about to be rewritten heals). */
export function isStampedTreeDamage(path: string, root: string): boolean {
  if (path === installStampPath(root)) return false;
  const dir = installTreeDir(root);
  return path === dir || path.startsWith(`${dir}/`);
}

/** Ask a {@link PersistFailureReport} whether ANY unhealed path matches, over
 * the FULL ledger when the backend can answer it (`anyFailure`), else the
 * SAMPLE. A durability gate must use this, never scan `report.failures`
 * directly: the sample truncates at PERSIST_REPORT_SAMPLE, so a torn-tree path
 * beyond it would be missed and the stamp would trust a broken tree. */
export function reportHasFailure(
  report: PersistFailureReport,
  predicate: (path: string) => boolean,
): boolean {
  return report.anyFailure
    ? report.anyFailure(predicate)
    : report.failures.some((f) => predicate(f.path));
}

function readExactStringMap(value: unknown): Record<string, string> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const entries = Object.entries(value);
  if (!entries.every((entry): entry is [string, string] => typeof entry[1] === 'string')) {
    return null;
  }
  return Object.fromEntries(entries);
}

export function effectiveDepsFromPackageJsonText(text: string): Record<string, string> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const raw = parsed as Record<string, unknown>;
  const dependencies = raw.dependencies === undefined ? {} : readExactStringMap(raw.dependencies);
  const devDependencies =
    raw.devDependencies === undefined ? {} : readExactStringMap(raw.devDependencies);
  const optionalDependencies =
    raw.optionalDependencies === undefined ? {} : readExactStringMap(raw.optionalDependencies);
  if (!dependencies || !devDependencies || !optionalDependencies) return null;
  return {
    ...dependencies,
    ...devDependencies,
    ...optionalDependencies,
  };
}

/**
 * The dep set an `install({vfs, cwd})` call would request for this project,
 * or `null` when package.json is missing/malformed (then nothing can be
 * stamped or matched).
 */
export async function readEffectiveDeps(
  vfs: Vfs,
  root: string,
): Promise<Record<string, string> | null> {
  const text = await readPackageJsonText(vfs, root);
  return text === null ? null : effectiveDepsFromPackageJsonText(text);
}

export async function readPackageJsonText(vfs: Vfs, root: string): Promise<string | null> {
  const path = joinPath(root, 'package.json');
  if (!(await vfs.exists(path))) return null;
  try {
    return await vfs.readFileText(path);
  } catch {
    return null;
  }
}

export function depsEqual(
  a: Readonly<Record<string, string>>,
  b: Readonly<Record<string, string>>,
): boolean {
  const aKeys = Object.keys(a);
  if (aKeys.length !== Object.keys(b).length) return false;
  return aKeys.every((key) => a[key] === b[key]);
}

export interface InstallStampPayload {
  readonly slug: string;
  readonly packages: number;
  readonly durability?: 'pending';
  readonly epoch?: string;
}

/** One constructor for every async/sync stamp writer. */
export function createInstallStamp(
  root: string,
  packageJsonText: string,
  payload: InstallStampPayload,
): InstallStamp | null {
  if (!isAbsolute(root)) return null;
  if (!Number.isSafeInteger(payload.packages) || payload.packages < 0) return null;
  const canonicalRoot = normalizePath(root);
  const deps = effectiveDepsFromPackageJsonText(packageJsonText);
  if (!deps) return null;
  const stamp = {
    version: 3,
    root: canonicalRoot,
    slug: payload.slug,
    packageJsonText,
    installArtifactIdentity,
    deps,
    packages: payload.packages,
  } satisfies Omit<InstallStamp, 'durability' | 'epoch'>;
  if (payload.durability === 'pending') {
    if (typeof payload.epoch !== 'string' || payload.epoch.length === 0) return null;
    return { ...stamp, durability: 'pending', epoch: payload.epoch };
  }
  if (payload.epoch !== undefined) return null;
  return stamp;
}

/** One parser for async and sync readers. Legacy/malformed claims are misses. */
export function parseInstallStamp(value: unknown, root: string): InstallStamp | null {
  if (!isAbsolute(root)) return null;
  const canonicalRoot = normalizePath(root);
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as {
    version?: unknown;
    root?: unknown;
    slug?: unknown;
    packageJsonText?: unknown;
    installArtifactIdentity?: unknown;
    deps?: unknown;
    packages?: unknown;
    durability?: unknown;
    epoch?: unknown;
  };
  if (
    raw.version !== 3 ||
    typeof raw.root !== 'string' ||
    !isAbsolute(raw.root) ||
    normalizePath(raw.root) !== raw.root ||
    raw.root !== canonicalRoot ||
    typeof raw.slug !== 'string' ||
    typeof raw.packageJsonText !== 'string' ||
    typeof raw.installArtifactIdentity !== 'string' ||
    !/^sha256:[0-9a-f]{64}$/.test(raw.installArtifactIdentity) ||
    typeof raw.packages !== 'number' ||
    !Number.isSafeInteger(raw.packages) ||
    raw.packages < 0
  ) {
    return null;
  }
  const exactDeps = effectiveDepsFromPackageJsonText(raw.packageJsonText);
  const deps = readExactStringMap(raw.deps);
  if (!exactDeps || !deps) return null;
  if (!depsEqual(deps, exactDeps)) return null;
  if (raw.durability !== undefined && raw.durability !== 'pending') return null;
  if (
    raw.durability === 'pending'
      ? typeof raw.epoch !== 'string' || raw.epoch.length === 0
      : raw.epoch !== undefined
  ) {
    return null;
  }
  return {
    version: 3,
    root: raw.root,
    slug: raw.slug,
    packageJsonText: raw.packageJsonText,
    installArtifactIdentity: raw.installArtifactIdentity,
    deps,
    packages: raw.packages,
    ...(raw.durability === 'pending' ? { durability: 'pending' as const } : {}),
    ...(typeof raw.epoch === 'string' ? { epoch: raw.epoch } : {}),
  };
}

function depsInclude(
  full: Readonly<Record<string, string>>,
  subset: Readonly<Record<string, string>>,
): boolean {
  return Object.entries(subset).every(([key, value]) => full[key] === value);
}

export async function readInstallStamp(vfs: Vfs, root: string): Promise<InstallStamp | null> {
  if (!isAbsolute(root)) return null;
  const path = installStampPath(root);
  if (!(await vfs.exists(path))) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(await vfs.readFileText(path));
  } catch {
    return null;
  }
  return parseInstallStamp(parsed, root);
}

export function stampTrusted(stamp: InstallStamp): boolean {
  return (
    stamp.durability !== 'pending' && stamp.installArtifactIdentity === installArtifactIdentity
  );
}

/**
 * The skip predicate: stamp present, its slug matches the project being booted,
 * `node_modules/` exists, and deps still match package.json (freshness guard).
 * Returns the stamp (for its package count) or null.
 */
export async function installStampSatisfied(
  vfs: Vfs,
  root: string,
  slug = '',
): Promise<InstallStamp | null> {
  const stamp = await readInstallStamp(vfs, root);
  if (!stamp) return null;
  if (!stampTrusted(stamp)) return null;
  if (stamp.slug !== slug) return null;
  if (!(await vfs.exists(joinPath(root, 'node_modules')))) return null;
  const packageJsonText = await readPackageJsonText(vfs, root);
  if (packageJsonText === null || stamp.packageJsonText !== packageJsonText) return null;
  return stamp;
}

/**
 * Same skip predicate as installStampSatisfied, but the caller also provides the
 * template package.json that is about to boot. This prevents a same-root starter
 * switch from reusing a stamp that only matches the previous package.json still
 * on disk.
 */
export async function installStampSatisfiedForPackageJson(
  vfs: Vfs,
  root: string,
  slug: string,
  packageJsonText: string,
): Promise<InstallStamp | null> {
  if (!isAbsolute(root)) return null;
  const expectedDeps = effectiveDepsFromPackageJsonText(packageJsonText);
  if (!expectedDeps) return null;
  const currentText = await readPackageJsonText(vfs, root);
  if (currentText === null) return null;
  const currentDeps = effectiveDepsFromPackageJsonText(currentText);
  if (!currentDeps || !depsInclude(currentDeps, expectedDeps)) return null;
  const stamp = await readInstallStamp(vfs, root);
  if (!stamp) return null;
  if (!stampTrusted(stamp)) return null;
  if (stamp.slug !== slug) return null;
  if (!(await vfs.exists(joinPath(root, 'node_modules')))) return null;
  if (stamp.packageJsonText !== currentText) return null;
  return stamp;
}

/** The sync fs slice the SYNC stamp predicate reads through. */
export interface InstallStampSyncFs {
  existsSync(path: string): boolean;
  readFileBytesSync(path: string): Uint8Array;
}

const stampDecoder = new TextDecoder('utf-8');

/**
 * Sync twin of {@link installStampSatisfiedForPackageJson} over the sync
 * mirror. Exists for the owner-boot eddy prefetch gate (ADR-0195): an ASYNC
 * gate starves behind the owner's busy boot loop, so the prefetch used to fire
 * AFTER the install it was meant to feed — a sync gate lets the fetch start
 * before any boot work blocks the realm.
 */
export function installStampSatisfiedForPackageJsonSync(
  fs: InstallStampSyncFs,
  root: string,
  slug: string,
  packageJsonText: string,
): InstallStamp | null {
  if (!isAbsolute(root)) return null;
  const expectedDeps = effectiveDepsFromPackageJsonText(packageJsonText);
  if (!expectedDeps) return null;
  const currentText = readTextSyncOrNull(fs, joinPath(root, 'package.json'));
  if (currentText === null) return null;
  const currentDeps = effectiveDepsFromPackageJsonText(currentText);
  if (!currentDeps || !depsInclude(currentDeps, expectedDeps)) return null;
  const stamp = readInstallStampSync(fs, root);
  if (!stamp) return null;
  if (!stampTrusted(stamp)) return null;
  if (stamp.slug !== slug) return null;
  if (!fs.existsSync(joinPath(root, 'node_modules'))) return null;
  if (stamp.packageJsonText !== currentText) return null;
  return stamp;
}

function readTextSyncOrNull(fs: InstallStampSyncFs, path: string): string | null {
  if (!fs.existsSync(path)) return null;
  try {
    return stampDecoder.decode(fs.readFileBytesSync(path));
  } catch {
    return null;
  }
}

/** Sync twin of {@link readInstallStamp} — exported for write-site rechecks
 * that must be ATOMIC with a sync write (no await between read and write). */
export function readInstallStampSync(fs: InstallStampSyncFs, root: string): InstallStamp | null {
  if (!isAbsolute(root)) return null;
  const text = readTextSyncOrNull(fs, installStampPath(root));
  if (text === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  return parseInstallStamp(parsed, root);
}
