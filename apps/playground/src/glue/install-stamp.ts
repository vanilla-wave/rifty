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
 * Visible `npm install` gates the stamp on a clean drain (`stampInstalledTree`).
 * Boot/restore writes a non-blocking PENDING stamp first (`project-deps.ts`);
 * pending stamps never satisfy reuse and are promoted only after a clean drain.
 */
// TODO(backlog: playground/install-stamp-invalidation)
import { type PersistFailureReport, type Vfs, joinPath } from '@riftydev/vfs';

export interface InstallStamp {
  readonly version: 1;
  /** Project identity (preset slug) the tree was installed for — the reuse key. */
  readonly slug: string;
  /** package.json effective request: dependencies ∪ devDependencies ∪
   *  optionalDependencies (secondary freshness guard alongside the slug). */
  readonly deps: Readonly<Record<string, string>>;
  /** `result.packages.length` of the install that produced the tree. */
  readonly packages: number;
  /** Pending boot/restore stamps are visible for diagnostics but never trusted. */
  readonly durability?: 'pending';
}

/** The dependency tree the stamp attests durable: `<root>/node_modules`. The
 * stamp trusts THIS subtree wholesale — so only persist failures UNDER it mean
 * the stamped tree is torn. A global/foreign path failing to persist (e.g.
 * `/.rifty/eddy-learned-pins.json`, another project's tree) must NOT gate or
 * revoke this project's stamp. */
export function installTreeDir(root: string): string {
  return joinPath(root, 'node_modules');
}

export function installStampPath(root: string): string {
  return joinPath(installTreeDir(root), '.rifty-install-stamp.json');
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

function readStringMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );
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
  return {
    ...readStringMap(raw.dependencies),
    ...readStringMap(raw.devDependencies),
    ...readStringMap(raw.optionalDependencies),
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
  const path = joinPath(root, 'package.json');
  if (!(await vfs.exists(path))) return null;
  return effectiveDepsFromPackageJsonText(await vfs.readFileText(path));
}

export function depsEqual(
  a: Readonly<Record<string, string>>,
  b: Readonly<Record<string, string>>,
): boolean {
  const aKeys = Object.keys(a);
  if (aKeys.length !== Object.keys(b).length) return false;
  return aKeys.every((key) => a[key] === b[key]);
}

function depsInclude(
  full: Readonly<Record<string, string>>,
  subset: Readonly<Record<string, string>>,
): boolean {
  return Object.entries(subset).every(([key, value]) => full[key] === value);
}

export async function readInstallStamp(vfs: Vfs, root: string): Promise<InstallStamp | null> {
  const path = installStampPath(root);
  if (!(await vfs.exists(path))) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(await vfs.readFileText(path));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const raw = parsed as {
    version?: unknown;
    slug?: unknown;
    deps?: unknown;
    packages?: unknown;
    durability?: unknown;
  };
  if (raw.version !== 1 || typeof raw.packages !== 'number') return null;
  if (!raw.deps || typeof raw.deps !== 'object' || Array.isArray(raw.deps)) return null;
  if (raw.durability !== undefined && raw.durability !== 'pending') return null;
  return {
    version: 1,
    slug: typeof raw.slug === 'string' ? raw.slug : '',
    deps: readStringMap(raw.deps),
    packages: raw.packages,
    ...(raw.durability === 'pending' ? { durability: 'pending' as const } : {}),
  };
}

export function stampTrusted(stamp: InstallStamp): boolean {
  return stamp.durability !== 'pending';
}

/**
 * Stamp the tree for project `slug` + the CURRENT package.json effective dep
 * set. No-op when package.json is unreadable (nothing to match against later).
 * `slug` defaults to `''` (page-side ad-hoc installs that no boot ever reuses).
 */
export async function writeInstallStamp(
  vfs: Vfs,
  root: string,
  packages: number,
  slug = '',
  durability?: 'pending',
): Promise<void> {
  const deps = await readEffectiveDeps(vfs, root);
  if (!deps) return;
  const stamp: InstallStamp = {
    version: 1,
    slug,
    deps,
    packages,
    ...(durability === 'pending' ? { durability } : {}),
  };
  // A zero-package install legitimately creates no node_modules — the stamp
  // still must land so the next boot skips the resolver.
  await vfs.mkdir(joinPath(root, 'node_modules'), { recursive: true });
  await vfs.writeFile(installStampPath(root), `${JSON.stringify(stamp, null, 2)}\n`);
}

/**
 * Rewrite an existing stamp's `slug` in place (ADR-0165): a Save MOVES the
 * scratch tree to `/projects/<id>/`, so its node_modules is now project <id>'s —
 * re-key the stamp so a later `installStampSatisfied(root, <id>)` reuses it. The
 * deps + package count are unchanged by a move, so no re-read. No-op when there
 * is no stamp (a fresh, never-installed scratch — best-effort).
 */
export async function restampSlug(vfs: Vfs, root: string, slug: string): Promise<void> {
  const stamp = await readInstallStamp(vfs, root);
  if (!stamp) return;
  const next: InstallStamp = { ...stamp, slug };
  await vfs.writeFile(installStampPath(root), `${JSON.stringify(next, null, 2)}\n`);
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
  const deps = await readEffectiveDeps(vfs, root);
  if (!deps || !depsEqual(stamp.deps, deps)) return null;
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
  const expectedDeps = effectiveDepsFromPackageJsonText(packageJsonText);
  if (!expectedDeps) return null;
  const currentDeps = await readEffectiveDeps(vfs, root);
  if (!currentDeps || !depsInclude(currentDeps, expectedDeps)) return null;
  const stamp = await readInstallStamp(vfs, root);
  if (!stamp) return null;
  if (!stampTrusted(stamp)) return null;
  if (stamp.slug !== slug) return null;
  if (!(await vfs.exists(joinPath(root, 'node_modules')))) return null;
  if (!depsEqual(stamp.deps, currentDeps)) return null;
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
  const expectedDeps = effectiveDepsFromPackageJsonText(packageJsonText);
  if (!expectedDeps) return null;
  const currentDeps = readEffectiveDepsSync(fs, root);
  if (!currentDeps || !depsInclude(currentDeps, expectedDeps)) return null;
  const stamp = readInstallStampSync(fs, root);
  if (!stamp) return null;
  if (!stampTrusted(stamp)) return null;
  if (stamp.slug !== slug) return null;
  if (!fs.existsSync(joinPath(root, 'node_modules'))) return null;
  if (!depsEqual(stamp.deps, currentDeps)) return null;
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

function readEffectiveDepsSync(
  fs: InstallStampSyncFs,
  root: string,
): Record<string, string> | null {
  const text = readTextSyncOrNull(fs, joinPath(root, 'package.json'));
  return text === null ? null : effectiveDepsFromPackageJsonText(text);
}

function readInstallStampSync(fs: InstallStampSyncFs, root: string): InstallStamp | null {
  const text = readTextSyncOrNull(fs, installStampPath(root));
  if (text === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const raw = parsed as {
    version?: unknown;
    slug?: unknown;
    deps?: unknown;
    packages?: unknown;
    durability?: unknown;
  };
  if (raw.version !== 1 || typeof raw.packages !== 'number') return null;
  if (!raw.deps || typeof raw.deps !== 'object' || Array.isArray(raw.deps)) return null;
  if (raw.durability !== undefined && raw.durability !== 'pending') return null;
  return {
    version: 1,
    slug: typeof raw.slug === 'string' ? raw.slug : '',
    deps: readStringMap(raw.deps),
    packages: raw.packages,
    ...(raw.durability === 'pending' ? { durability: 'pending' as const } : {}),
  };
}
