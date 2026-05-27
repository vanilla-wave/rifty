/**
 * Linker — writes a resolved set of packages into `node_modules/`.
 *
 * Strategy: flat at the top level (matches npm v3+), with first-seen-wins
 * hoisting and nested placement for conflicting versions (M11, 2026-05-27).
 * Each `ResolvedPackage` carries its `installPath` — `node_modules/<name>`
 * when hoisted, `<parent>/.../node_modules/<name>` when nested — and the
 * linker simply writes the tarball contents at that path. The placement
 * decision lives in `installer.ts` (`walkAndPin`), not here.
 */

import { type Vfs, joinPath } from '@rifty/vfs';

export interface ResolvedPackage {
  name: string;
  version: string;
  files: Record<string, Uint8Array>;
  /** Direct dependencies (already resolved transitively elsewhere). */
  dependencies: Record<string, string>;
  /**
   * Project-root-relative path where this package's files are written
   * (e.g. `node_modules/express` or
   * `node_modules/finalhandler/node_modules/ms`). Filled by `walkAndPin`'s
   * placement decision (see M11 install nesting). Optional for
   * backward-compatibility with callers that pre-date M11 — when absent
   * the linker falls back to flat `node_modules/<name>`.
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
   * Peer dependencies declared by this package. Persisted in the lockfile
   * so the fast path can run the post-install missing-peer warn pass
   * without re-fetching every packument. npm itself stores `peerDependencies`
   * on lockfile entries since v7 (`lockfileVersion: 3`), so this is
   * backward-compatible with their tooling — readers ignore unknown fields
   * and consumers that don't care simply skip the warn pass.
   */
  peerDependencies?: Record<string, string>;
}

/**
 * Build a v3 lockfile from the resolved package set. Each non-root entry
 * carries the `resolved` tarball URL and `integrity` hash so subsequent
 * installs can hit the tarball cache (ADR-0023) without re-resolving.
 * `peerDependencies` is persisted on each entry so the lockfile fast path
 * can run the same post-install missing-peer warn pass that the
 * live-resolve path already runs (closes the D-F drift, 2026-05-26).
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
  // The root entry lists only the FLAT (hoisted) deps as its dependency
  // map — matching npm's lockfile shape. A nested copy is reachable only
  // via its parent's entry, not via the root.
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
    // Key by installPath — flat packages stay at `node_modules/<name>`;
    // nested copies use their full nested path so npm's resolver (and the
    // lockfile fast-path) can tell them apart.
    const key = p.installPath ?? `node_modules/${p.name}`;
    lf.packages[key] = entry;
  }
  return lf;
}
