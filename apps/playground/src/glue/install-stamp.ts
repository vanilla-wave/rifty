/**
 * Install stamp (ADR-0135): `<root>/node_modules/.rifty-install-stamp.json`
 * marks "this node_modules was fully installed for dep set D". Written after
 * every successful install (page `npm install` and worker bootstrap); the
 * worker bootstrap skips its redundant `install()` when the stamp still
 * matches package.json — that skip is what makes instant presets fast.
 *
 * Trust model: the stamp trusts the tree wholesale — no per-file verification.
 * An explicit terminal `npm install` never consults it (always re-installs,
 * then re-stamps). Callers own flush ordering: drain the VFS write-through
 * BEFORE `writeInstallStamp` so a durable stamp implies a durable tree.
 */
// TODO(backlog: playground/install-stamp-invalidation)
import { type Vfs, joinPath } from '@riftydev/vfs';

export interface InstallStamp {
  readonly version: 1;
  /** package.json effective request: dependencies ∪ devDependencies ∪
   *  optionalDependencies (mirrors the installer's package.json-driven set). */
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
  let parsed: unknown;
  try {
    parsed = JSON.parse(await vfs.readFileText(path));
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

export function depsEqual(
  a: Readonly<Record<string, string>>,
  b: Readonly<Record<string, string>>,
): boolean {
  const aKeys = Object.keys(a);
  if (aKeys.length !== Object.keys(b).length) return false;
  return aKeys.every((key) => a[key] === b[key]);
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
  const raw = parsed as { version?: unknown; deps?: unknown; packages?: unknown };
  if (raw.version !== 1 || typeof raw.packages !== 'number') return null;
  if (!raw.deps || typeof raw.deps !== 'object' || Array.isArray(raw.deps)) return null;
  return { version: 1, deps: readStringMap(raw.deps), packages: raw.packages };
}

/**
 * Stamp the tree for the CURRENT package.json effective dep set. No-op when
 * package.json is unreadable (nothing to match against later).
 */
export async function writeInstallStamp(vfs: Vfs, root: string, packages: number): Promise<void> {
  const deps = await readEffectiveDeps(vfs, root);
  if (!deps) return;
  const stamp: InstallStamp = { version: 1, deps, packages };
  await vfs.writeFile(installStampPath(root), `${JSON.stringify(stamp, null, 2)}\n`);
}

/**
 * The skip predicate: stamp present, deps still match package.json, and
 * `node_modules/` exists. Returns the stamp (for its package count) or null.
 */
export async function installStampSatisfied(vfs: Vfs, root: string): Promise<InstallStamp | null> {
  const stamp = await readInstallStamp(vfs, root);
  if (!stamp) return null;
  if (!(await vfs.exists(joinPath(root, 'node_modules')))) return null;
  const deps = await readEffectiveDeps(vfs, root);
  if (!deps || !depsEqual(stamp.deps, deps)) return null;
  return stamp;
}
