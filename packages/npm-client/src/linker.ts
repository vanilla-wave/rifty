/**
 * Linker — writes a resolved set of packages into `node_modules/`.
 *
 * Flat top level (npm v3+), first-seen-wins hoisting, nested placement for
 * conflicting versions (M11, 2026-05-27). Each `ResolvedPackage` carries its
 * `installPath` (hoisted `node_modules/<name>` or nested
 * `<parent>/.../node_modules/<name>`); the linker just writes the tarball
 * there. Placement is decided in `installer.ts` (`walkAndPin`), not here.
 */

import { type Vfs, joinPath, normalizePath } from '@riftydev/vfs';
import {
  type LockfilePackageMaterialization,
  type PackageMaterialization,
  lockfilePackageMaterialization,
} from './package-materialization.ts';
import {
  type ShadowSubstitutionLockfileTrace,
  createShadowSubstitutionLockfileTrace,
} from './shadow-asset-lockfile-trace.ts';
import type { ShadowAssetPlan } from './shadow-asset-plan.ts';

export { RIFTY_LOCKFILE_SHADOW_SUBSTITUTIONS_PROTOCOL } from './shadow-asset-lockfile-trace.ts';

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
  const nodeModules = joinPath(root, 'node_modules');
  await vfs.mkdir(nodeModules, { recursive: true });
  for (const pkg of packages) {
    const relPath = pkg.installPath ?? `node_modules/${pkg.name}`;
    const target = joinPath(root, relPath);
    const entries = Object.entries(pkg.files);
    // #7 (perf-audit 2026-06-05): dedup distinct parent dirs into a Set (O(M*D)
    // per-file mkdir -> O(K) distinct mkdirs), then fan out the writes. Pre-create
    // ALL distinct dirs FIRST (serial) so no parallel write races a missing dir;
    // the writes are an independent write-only fan-out into already-created dirs,
    // so Promise.all is order-independent and the final FS state is identical.
    const dirs = new Set<string>([target]);
    const writes: Array<[string, Uint8Array]> = [];
    for (const [entryPath, data] of entries) {
      const fullPath = joinPath(target, entryPath);
      dirs.add(fullPath.slice(0, fullPath.lastIndexOf('/')));
      writes.push([fullPath, data]);
    }
    for (const dir of dirs) {
      await vfs.mkdir(dir, { recursive: true });
    }
    await Promise.all(writes.map(([fullPath, data]) => vfs.writeFile(fullPath, data)));
    await linkBins(vfs, root, target, pkg);
  }
}

const shimEncoder = new TextEncoder();

async function linkBins(
  vfs: Vfs,
  root: string,
  packageRoot: string,
  pkg: ResolvedPackage,
): Promise<void> {
  const installPath = pkg.installPath ?? `node_modules/${pkg.name}`;
  const bins = normalizeBin(pkg.name, pkg.bin);
  const entries = Object.entries(bins);
  if (entries.length === 0) return;

  const binDir = joinPath(root, packageNodeModulesDir(installPath, pkg.name), '.bin');
  await vfs.mkdir(binDir, { recursive: true });
  for (const [command, target] of entries) {
    const relTarget = normalizeBinTarget(target);
    // Existence check: a manifest pointing at a file the tarball lacks fails
    // loudly here rather than at first exec.
    await vfs.readFile(joinPath(packageRoot, relTarget));
    // Launcher shim, NOT a byte copy (ADR-0050: no symlinks). A copy breaks the
    // moment the bin does a relative require/import (vite's bin/vite.js loads
    // '../dist/...'): relative resolution must happen at the REAL file's path.
    // Dynamic import() loads both CJS and ESM targets.
    const shim = `#!/usr/bin/env node\nimport('../${pkg.name}/${relTarget}');\n`;
    await vfs.writeFile(joinPath(binDir, command), shimEncoder.encode(shim));
  }
}

function packageNodeModulesDir(installPath: string, packageName: string): string {
  const suffix = `node_modules/${packageName}`;
  if (!installPath.endsWith(suffix)) {
    throw new Error(`Invalid package installPath for ${packageName}: ${installPath}`);
  }
  return installPath.slice(0, installPath.length - packageName.length - 1);
}

function normalizeBin(name: string, bin: ResolvedPackage['bin']): Record<string, string> {
  if (!bin) return {};
  if (typeof bin === 'string') return { [defaultBinName(name)]: bin };
  const out: Record<string, string> = {};
  for (const [command, target] of Object.entries(bin)) {
    if (command.includes('/') || command === '' || typeof target !== 'string' || target === '') {
      continue;
    }
    out[command] = target;
  }
  return out;
}

function defaultBinName(name: string): string {
  return name.startsWith('@') ? (name.split('/')[1] ?? name) : name;
}

function normalizeBinTarget(target: string): string {
  const normalized = normalizePath(target.replace(/^\.\//, ''));
  if (normalized.startsWith('/') || normalized === '..' || normalized.startsWith('../')) {
    throw new Error(`Invalid package bin target: ${target}`);
  }
  return normalized;
}

/** Lockfile shape — npm-compatible "v3"-ish subset. */
export interface Lockfile {
  name: string;
  version: string;
  lockfileVersion: 3;
  requires: true;
  packages: Record<string, LockfileEntry>;
  /** Stable npm-client-owned applied-recipe trace; never inferred from names. */
  rifty?: Readonly<{
    shadowSubstitutions: ShadowSubstitutionLockfileTrace;
  }>;
}

export interface LockfileEntry {
  version: string;
  resolved?: string;
  integrity?: string;
  dependencies?: Record<string, string>;
  bin?: string | Record<string, string>;
  /**
   * Persisted so the fast path can run the post-install missing-peer warn
   * pass without re-fetching every packument. npm stores `peerDependencies`
   * on lockfile v3 entries since v7, so this stays compatible with their
   * tooling (readers ignore unknown fields).
   */
  peerDependencies?: Record<string, string>;
  /** Exact non-tarball byte provenance; absent means ordinary resolved/integrity replay. */
  rifty?: Readonly<{ readonly materialization: LockfilePackageMaterialization }>;
}

interface BuildLockfileOptions {
  /** Present (including empty) when npm-client owns the exact applied trace. */
  readonly shadowAssetPlan?: ShadowAssetPlan;
}

type LockfileInputPackage = ResolvedPackage & {
  resolved?: string;
  integrity?: string;
  peerDependencies?: Record<string, string>;
  /** Package-private; honored only by the installer-owned builder. */
  materialization?: PackageMaterialization;
};

/**
 * Build a v3 lockfile from the resolved package set. Each non-root entry
 * carries `resolved` (tarball URL) and `integrity` so subsequent installs
 * hit the tarball cache (ADR-0023) without re-resolving. `peerDependencies`
 * is persisted so the lockfile fast path runs the same missing-peer warn
 * pass as the live-resolve path (closes D-F drift, 2026-05-26).
 */
function buildLockfileWithOptions(
  rootName: string,
  rootVersion: string,
  packages: readonly LockfileInputPackage[],
  options: BuildLockfileOptions = {},
): Lockfile {
  // Root entry lists only FLAT (hoisted) deps, matching npm's lockfile
  // shape. A nested copy is reachable only via its parent's entry.
  const flatTopLevel: Record<string, string> = {};
  for (const p of packages) {
    if (!p.installPath || p.installPath === `node_modules/${p.name}`) {
      flatTopLevel[p.name] = p.version;
    }
  }
  const rootEntry: LockfileEntry = { version: rootVersion, dependencies: flatTopLevel };
  const lf: Lockfile = {
    name: rootName,
    version: rootVersion,
    lockfileVersion: 3,
    requires: true,
    packages: {
      '': rootEntry,
    },
  };
  if (options.shadowAssetPlan !== undefined) {
    lf.rifty = Object.freeze({
      shadowSubstitutions: createShadowSubstitutionLockfileTrace(options.shadowAssetPlan),
    });
  }
  for (const p of packages) {
    const entry: LockfileEntry = {
      version: p.version,
      dependencies: p.dependencies,
    };
    const materialization =
      options.shadowAssetPlan === undefined || p.materialization === undefined
        ? undefined
        : lockfilePackageMaterialization(p.materialization);
    if (materialization === undefined) {
      if (p.resolved) entry.resolved = p.resolved;
      if (p.integrity) entry.integrity = p.integrity;
    } else {
      entry.rifty = materialization;
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

/** Public npm-compatible builder; applied provenance can only be minted by install(). */
export function buildLockfile(
  rootName: string,
  rootVersion: string,
  packages: readonly (ResolvedPackage & {
    resolved?: string;
    integrity?: string;
    peerDependencies?: Record<string, string>;
  })[],
): Lockfile {
  return buildLockfileWithOptions(rootName, rootVersion, packages);
}

/** Package-private install result builder; intentionally absent from the public barrel. */
export function buildInstallLockfile(
  rootName: string,
  rootVersion: string,
  packages: readonly LockfileInputPackage[],
  shadowAssetPlan: ShadowAssetPlan,
): Lockfile {
  return buildLockfileWithOptions(rootName, rootVersion, packages, {
    shadowAssetPlan,
  });
}
