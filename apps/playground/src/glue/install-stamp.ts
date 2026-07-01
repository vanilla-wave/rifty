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
 * Durability ordering (ADR-0187): the write-through queue is FIFO, so the
 * stamp — written after the tree — lands durably after it by construction;
 * callers do NOT drain the queue around the stamp.
 */
// TODO(backlog: playground/install-stamp-invalidation)
import { type Vfs, joinPath } from '@riftydev/vfs';

export interface InstallStamp {
  readonly version: 1;
  /** Project identity (preset slug) the tree was installed for — the reuse key. */
  readonly slug: string;
  /** package.json effective request: dependencies ∪ devDependencies ∪
   *  optionalDependencies (secondary freshness guard alongside the slug). */
  readonly deps: Readonly<Record<string, string>>;
  /** `result.packages.length` of the install that produced the tree. */
  readonly packages: number;
}

export function installStampPath(root: string): string {
  return joinPath(root, 'node_modules/.rifty-install-stamp.json');
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
  };
  if (raw.version !== 1 || typeof raw.packages !== 'number') return null;
  if (!raw.deps || typeof raw.deps !== 'object' || Array.isArray(raw.deps)) return null;
  return {
    version: 1,
    slug: typeof raw.slug === 'string' ? raw.slug : '',
    deps: readStringMap(raw.deps),
    packages: raw.packages,
  };
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
): Promise<void> {
  const deps = await readEffectiveDeps(vfs, root);
  if (!deps) return;
  const stamp: InstallStamp = { version: 1, slug, deps, packages };
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
  if (stamp.slug !== slug) return null;
  if (!(await vfs.exists(joinPath(root, 'node_modules')))) return null;
  if (!depsEqual(stamp.deps, currentDeps)) return null;
  return stamp;
}
