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
import {
  type ShadowAssetPlan,
  type ShadowSubstitutionLockfileTrace,
  createShadowSubstitutionLockfileTrace,
} from './internal/shadow/planner.ts';
import { linkPackageBins } from './package-bin.ts';

export interface ResolvedPackage {
  name: string;
  version: string;
  files: Record<string, Uint8Array>;
  /** Direct dependencies (already resolved transitively elsewhere). */
  dependencies: Record<string, string>;
  /** npm package `bin` metadata. String form uses the package basename. */
  bin?: string | Record<string, string>;
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
  await linkTree(vfs, root, packages, () => {});
}

/**
 * Installer-owned cancellable entry. Kept off `src/index.ts`: cancellation
 * enters the public package through `InstallOptions.signal` (ADR-0314).
 */
export async function linkInstallTree(
  vfs: Vfs,
  root: string,
  packages: readonly ResolvedPackage[],
  checkpoint: () => void,
): Promise<void> {
  try {
    await linkTree(vfs, root, packages, checkpoint);
  } catch (error) {
    checkpoint();
    throw error;
  }
}

async function linkTree(
  vfs: Vfs,
  root: string,
  packages: readonly ResolvedPackage[],
  checkpoint: () => void,
): Promise<void> {
  checkpoint();
  const nodeModules = joinPath(root, 'node_modules');
  await vfs.mkdir(nodeModules, { recursive: true });
  checkpoint();
  for (const pkg of packages) {
    checkpoint();
    const relPath = pkg.installPath ?? `node_modules/${pkg.name}`;
    const target = joinPath(root, relPath);
    const entries = Object.entries(pkg.files);
    // #7 (perf-audit 2026-06-05): dedup distinct parent dirs into a Set (O(M*D)
    // per-file mkdir -> O(K) distinct mkdirs), then fan out the writes. Pre-create
    // ALL distinct dirs FIRST (serial) so no parallel write races a missing dir;
    // the writes are an independent write-only fan-out into already-created dirs,
    // so the settled write batch is order-independent and final state is identical.
    const dirs = new Set<string>([target]);
    const writes: Array<[string, Uint8Array]> = [];
    for (const [entryPath, data] of entries) {
      const fullPath = joinPath(target, entryPath);
      dirs.add(fullPath.slice(0, fullPath.lastIndexOf('/')));
      writes.push([fullPath, data]);
    }
    for (const dir of dirs) {
      await vfs.mkdir(dir, { recursive: true });
      checkpoint();
    }
    const failures: unknown[] = [];
    await Promise.allSettled(
      writes.map(async ([fullPath, data]) => {
        try {
          await vfs.writeFile(fullPath, data);
        } catch (error) {
          if (failures.length === 0) failures.push(error);
          throw error;
        }
      }),
    );
    checkpoint();
    if (failures.length > 0) throw failures[0];
    await linkPackageBins(
      vfs,
      root,
      {
        name: pkg.name,
        installPath: relPath,
        bin: pkg.bin,
      },
      checkpoint,
    );
    checkpoint();
  }
}

/** Lockfile shape — npm-compatible "v3"-ish subset. */
export interface Lockfile {
  name: string;
  version: string;
  lockfileVersion: 3;
  requires: true;
  packages: Record<string, LockfileEntry>;
  readonly rifty?: Readonly<{
    shadowSubstitutions: ShadowSubstitutionLockfileTrace;
  }>;
}

export interface LockfileEntry {
  version: string;
  resolved?: string;
  integrity?: string;
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  bin?: string | Record<string, string>;
  /**
   * Persisted so the fast path can run the post-install missing-peer warn
   * pass without re-fetching every packument. npm stores `peerDependencies`
   * on lockfile v3 entries since v7, so this stays compatible with their
   * tooling (readers ignore unknown fields).
   */
  peerDependencies?: Record<string, string>;
  /** Exact built-in recipe attested by `lockfile.rifty.shadowSubstitutions`. */
  riftyShadowRecipe?: string;
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
    optionalDependencies?: Record<string, string>;
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
    if (p.optionalDependencies && Object.keys(p.optionalDependencies).length > 0) {
      entry.optionalDependencies = p.optionalDependencies;
    }
    if (p.bin) entry.bin = p.bin;
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

/** Installer-only writer: root trace and per-entry markers form one replay fact. */
export function buildInstallLockfile(
  rootName: string,
  rootVersion: string,
  packages: Parameters<typeof buildLockfile>[2],
  planValue: ShadowAssetPlan,
): Lockfile {
  const plan = planValue;
  if (!Object.isFrozen(plan) || !Object.isFrozen(plan.substitutions)) {
    throw new TypeError('trusted installer shadow plan invariant failed');
  }
  const lockfile = buildLockfile(rootName, rootVersion, packages);
  if (plan.substitutions.length === 0) return lockfile;
  for (const substitution of plan.substitutions) {
    let entry = lockfile.packages[substitution.materialization.installPath];
    if (!entry) {
      entry = { version: substitution.materialization.version };
      lockfile.packages[substitution.materialization.installPath] = entry;
    } else if (entry.version !== substitution.materialization.version) {
      throw new TypeError(`shadow substitution ${substitution.substitutionId} entry drifted`);
    }
    if (Object.keys(substitution.materialization.bin).length > 0) {
      entry.bin = { ...substitution.materialization.bin };
    }
    entry.riftyShadowRecipe = substitution.substitutionId;
  }
  return {
    ...lockfile,
    rifty: {
      shadowSubstitutions: createShadowSubstitutionLockfileTrace(plan),
    },
  };
}
