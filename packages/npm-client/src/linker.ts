/**
 * Linker — writes a resolved set of packages into `node_modules/`.
 *
 * Flat top level (npm v3+), first-seen-wins hoisting, nested placement for
 * conflicting versions (M11, 2026-05-27). Each `ResolvedPackage` carries its
 * `installPath` (hoisted `node_modules/<name>` or nested
 * `<parent>/.../node_modules/<name>`); the linker just writes the tarball
 * there. Placement is decided in `installer.ts` (`walkAndPin`), not here.
 */

import { type Vfs, joinPath } from '@riftydev/vfs';

export interface ResolvedPackage {
  name: string;
  version: string;
  files: Record<string, Uint8Array>;
  /** Direct dependencies (already resolved transitively elsewhere). */
  dependencies: Record<string, string>;
  /**
   * Project-root-relative write path (e.g. `node_modules/express` or
   * `node_modules/finalhandler/node_modules/ms`). Filled by `walkAndPin`
   * (M11 install nesting). Optional for pre-M11 callers — absent falls back
   * to flat `node_modules/<name>`.
   */
  installPath?: string;
}

export async function link(
  vfs: Vfs,
  root: string,
  packages: readonly ResolvedPackage[],
): Promise<void> {
  const nodeModules = joinPath(root, 'node_modules');
  await vfs.mkdir(nodeModules, { recursive: true });
  for (const pkg of packages) {
    const relPath = pkg.installPath ?? `node_modules/${pkg.name}`;
    const target = joinPath(root, relPath);
    await vfs.mkdir(target, { recursive: true });
    for (const [entryPath, data] of Object.entries(pkg.files)) {
      const fullPath = joinPath(target, entryPath);
      const dir = fullPath.slice(0, fullPath.lastIndexOf('/'));
      await vfs.mkdir(dir, { recursive: true });
      await vfs.writeFile(fullPath, data);
    }
  }
}

/** Lockfile shape — npm-compatible "v3"-ish subset. */
export interface Lockfile {
  name: string;
  version: string;
  lockfileVersion: 3;
  requires: true;
  packages: Record<string, LockfileEntry>;
}

export interface LockfileEntry {
  version: string;
  resolved?: string;
  integrity?: string;
  dependencies?: Record<string, string>;
  /**
   * Persisted so the fast path can run the post-install missing-peer warn
   * pass without re-fetching every packument. npm stores `peerDependencies`
   * on lockfile v3 entries since v7, so this stays compatible with their
   * tooling (readers ignore unknown fields).
   */
  peerDependencies?: Record<string, string>;
}

/**
 * Build a v3 lockfile from the resolved package set. Each non-root entry
 * carries `resolved` (tarball URL) and `integrity` so subsequent installs
 * hit the tarball cache (ADR-0023) without re-resolving. `peerDependencies`
 * is persisted so the lockfile fast path runs the same missing-peer warn
 * pass as the live-resolve path (closes D-F drift, 2026-05-26).
 */
export function buildLockfile(
  rootName: string,
  rootVersion: string,
  packages: readonly (ResolvedPackage & {
    resolved?: string;
    integrity?: string;
    peerDependencies?: Record<string, string>;
  })[],
): Lockfile {
  // Root entry lists only FLAT (hoisted) deps, matching npm's lockfile
  // shape. A nested copy is reachable only via its parent's entry.
  const flatTopLevel: Record<string, string> = {};
  for (const p of packages) {
    if (!p.installPath || p.installPath === `node_modules/${p.name}`) {
      flatTopLevel[p.name] = p.version;
    }
  }
  const lf: Lockfile = {
    name: rootName,
    version: rootVersion,
    lockfileVersion: 3,
    requires: true,
    packages: {
      '': { version: rootVersion, dependencies: flatTopLevel },
    },
  };
  for (const p of packages) {
    const entry: LockfileEntry = {
      version: p.version,
      dependencies: p.dependencies,
    };
    if (p.resolved) entry.resolved = p.resolved;
    if (p.integrity) entry.integrity = p.integrity;
    if (p.peerDependencies && Object.keys(p.peerDependencies).length > 0) {
      entry.peerDependencies = p.peerDependencies;
    }
    // Key by installPath so npm's resolver (and the lockfile fast-path)
    // can distinguish a nested copy from its flat counterpart.
    const key = p.installPath ?? `node_modules/${p.name}`;
    lf.packages[key] = entry;
  }
  return lf;
}
