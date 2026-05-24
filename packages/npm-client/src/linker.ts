/**
 * Linker — writes a resolved set of packages into `node_modules/`.
 *
 * Strategy: flat at the top level (matches npm v3+), with dedupe by name.
 * Conflicts (multiple incompatible versions of the same name) get nested
 * under the consumer that needs them — same as npm. For M9 we go flat-only
 * since the integration target is small; nested resolution arrives the first
 * time a real dependency tree forces it.
 */

import { type Vfs, joinPath } from '@rifty/vfs';

export interface ResolvedPackage {
  name: string;
  version: string;
  files: Record<string, Uint8Array>;
  /** Direct dependencies (already resolved transitively elsewhere). */
  dependencies: Record<string, string>;
}

export async function link(
  vfs: Vfs,
  root: string,
  packages: readonly ResolvedPackage[],
): Promise<void> {
  const nodeModules = joinPath(root, 'node_modules');
  await vfs.mkdir(nodeModules, { recursive: true });
  for (const pkg of packages) {
    const target = joinPath(nodeModules, pkg.name);
    await vfs.mkdir(target, { recursive: true });
    for (const [relPath, data] of Object.entries(pkg.files)) {
      const fullPath = joinPath(target, relPath);
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
}

/**
 * Build a v3 lockfile from the resolved package set. Each non-root entry
 * carries the `resolved` tarball URL and `integrity` hash so subsequent
 * installs can hit the tarball cache (ADR-0023) without re-resolving.
 */
export function buildLockfile(
  rootName: string,
  rootVersion: string,
  packages: readonly (ResolvedPackage & { resolved?: string; integrity?: string })[],
): Lockfile {
  const lf: Lockfile = {
    name: rootName,
    version: rootVersion,
    lockfileVersion: 3,
    requires: true,
    packages: {
      '': {
        version: rootVersion,
        dependencies: Object.fromEntries(packages.map((p) => [p.name, p.version])),
      },
    },
  };
  for (const p of packages) {
    const entry: LockfileEntry = {
      version: p.version,
      dependencies: p.dependencies,
    };
    if (p.resolved) entry.resolved = p.resolved;
    if (p.integrity) entry.integrity = p.integrity;
    lf.packages[`node_modules/${p.name}`] = entry;
  }
  return lf;
}
