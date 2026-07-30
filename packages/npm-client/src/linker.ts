/**
 * Linker — writes a resolved set of packages into `node_modules/`.
 *
 * Flat top level (npm v3+), first-seen-wins hoisting, nested placement for
 * conflicting versions (M11, 2026-05-27). Each `ResolvedPackage` carries its
 * `installPath` (hoisted `node_modules/<name>` or nested
 * `<parent>/.../node_modules/<name>`); the linker just writes the tarball
 * there. Placement is decided in `installer.ts` (`walkAndPin`), not here.
 */

import { NotImplementedError } from '@riftydev/io';
import { type Vfs, joinPath, normalizePath } from '@riftydev/vfs';
import {
  type ShadowAssetPlan,
  type ShadowSubstitutionLockfileTrace,
  createShadowSubstitutionLockfileTrace,
} from './internal/shadow/planner.ts';

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

export interface PreparedInstallPackage<TPackage extends ResolvedPackage = ResolvedPackage> {
  readonly package: TPackage;
  readonly relativePath: string;
  readonly nodeModulesDir: string;
}

export interface PackageBinSource {
  readonly package: Readonly<Pick<ResolvedPackage, 'name' | 'bin'>>;
  readonly nodeModulesDir: string;
}

export interface PackageBinClaim {
  readonly nodeModulesDir: string;
  readonly command: string;
  readonly owner: string;
  readonly target: string;
}

export function normalizePackageBinSource(source: PackageBinSource): readonly PackageBinClaim[] {
  const pkg = source.package;
  const claims: PackageBinClaim[] = [];
  for (const [command, target] of Object.entries(normalizeBin(pkg.name, pkg.bin))) {
    claims.push({
      nodeModulesDir: source.nodeModulesDir,
      command,
      owner: pkg.name,
      target: normalizeBinTarget(target),
    });
  }
  return claims;
}

export function normalizePackageBinSources(
  sources: readonly PackageBinSource[],
): readonly PackageBinClaim[] {
  const claims: PackageBinClaim[] = [];
  for (const source of sources) {
    for (const claim of normalizePackageBinSource(source)) claims.push(claim);
  }
  return claims;
}

export function preflightPackageBins(
  currentSources: readonly PackageBinSource[],
  priorSources: readonly PackageBinSource[] = [],
): readonly PackageBinClaim[] {
  const current = normalizePackageBinSources(currentSources);
  const prior = normalizePackageBinSources(priorSources);
  const currentByScope = indexPackageBinClaims(current);
  const priorByScope = indexPackageBinClaims(prior);

  for (const [nodeModulesDir, priorCommands] of priorByScope) {
    const currentCommands = currentByScope.get(nodeModulesDir);
    for (const [command, priorClaim] of priorCommands) {
      const currentClaim = currentCommands?.get(command);
      if (!currentClaim || currentClaim.owner !== priorClaim.owner) {
        throw new NotImplementedError('npm-client.bin-collision-reify');
      }
    }
  }
  return current;
}

function indexPackageBinClaims(
  claims: readonly PackageBinClaim[],
): Map<string, Map<string, PackageBinClaim>> {
  const byScope = new Map<string, Map<string, PackageBinClaim>>();
  for (const claim of claims) {
    let byCommand = byScope.get(claim.nodeModulesDir);
    if (!byCommand) {
      byCommand = new Map();
      byScope.set(claim.nodeModulesDir, byCommand);
    }
    if (byCommand.has(claim.command)) {
      throw new NotImplementedError('npm-client.bin-collision-reify');
    }
    byCommand.set(claim.command, claim);
  }
  return byScope;
}

export function preflightPackageInstallPaths<TPackage extends ResolvedPackage>(
  packages: readonly TPackage[],
): readonly PreparedInstallPackage<TPackage>[] {
  const prepared: PreparedInstallPackage<TPackage>[] = [];
  for (const pkg of packages) {
    const rawPath = pkg.installPath;
    const relativePath = rawPath ?? `node_modules/${pkg.name}`;
    const suffix = `node_modules/${pkg.name}`;
    if (
      !relativePath.startsWith('node_modules/') ||
      normalizePath(relativePath) !== relativePath ||
      (relativePath !== suffix && !relativePath.endsWith(`/${suffix}`))
    ) {
      throw invalidPackageInstallPath(relativePath, pkg.name);
    }
    prepared.push({
      package: pkg,
      relativePath,
      nodeModulesDir: relativePath.slice(0, relativePath.length - pkg.name.length - 1),
    });
  }
  return prepared;
}

function invalidPackageInstallPath(path: string, packageName: string): Error {
  return Object.assign(new Error(`Invalid package installPath for ${packageName}: ${path}`), {
    code: 'EINVALIDPACKAGETAR' as const,
    path,
  });
}

export async function link(
  vfs: Vfs,
  root: string,
  packages: readonly ResolvedPackage[],
): Promise<void> {
  const prepared = preflightPackageInstallPaths(packages);
  await linkPreparedInstallTree(vfs, root, prepared, () => {});
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
    checkpoint();
    const prepared = preflightPackageInstallPaths(packages);
    await linkPreparedInstallTree(vfs, root, prepared, checkpoint);
  } catch (error) {
    checkpoint();
    throw error;
  }
}

export async function linkPreparedInstallTree(
  vfs: Vfs,
  root: string,
  packages: readonly PreparedInstallPackage[],
  checkpoint: () => void,
): Promise<void> {
  checkpoint();
  const nodeModules = joinPath(root, 'node_modules');
  await vfs.mkdir(nodeModules, { recursive: true });
  checkpoint();
  for (const prepared of packages) {
    checkpoint();
    const pkg = prepared.package;
    const target = joinPath(root, prepared.relativePath);
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
    await linkBins(vfs, root, target, prepared, checkpoint);
    checkpoint();
  }
}

const shimEncoder = new TextEncoder();

async function linkBins(
  vfs: Vfs,
  root: string,
  packageRoot: string,
  prepared: PreparedInstallPackage,
  checkpoint: () => void,
): Promise<void> {
  const pkg = prepared.package;
  const bins = normalizeBin(pkg.name, pkg.bin);
  const entries = Object.entries(bins);
  if (entries.length === 0) return;

  const binDir = joinPath(root, prepared.nodeModulesDir, '.bin');
  await vfs.mkdir(binDir, { recursive: true });
  checkpoint();
  for (const [command, target] of entries) {
    checkpoint();
    const relTarget = normalizeBinTarget(target);
    // Existence check: a manifest pointing at a file the tarball lacks fails
    // loudly here rather than at first exec.
    await vfs.readFile(joinPath(packageRoot, relTarget));
    checkpoint();
    // Launcher shim, NOT a byte copy (ADR-0050: no symlinks). A copy breaks the
    // moment the bin does a relative require/import (vite's bin/vite.js loads
    // '../dist/...'): relative resolution must happen at the REAL file's path.
    // Dynamic import() loads both CJS and ESM targets.
    const shim = `#!/usr/bin/env node\nimport('../${pkg.name}/${relTarget}');\n`;
    await vfs.writeFile(joinPath(binDir, command), shimEncoder.encode(shim));
    checkpoint();
  }
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
  readonly rifty?: Readonly<{
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
  /** Exact built-in recipe attested by `lockfile.rifty.shadowSubstitutions`. */
  riftyShadowRecipe?: string;
}

type LockfilePackage = ResolvedPackage & {
  resolved?: string;
  integrity?: string;
  peerDependencies?: Record<string, string>;
};

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
  return buildPreparedLockfile(rootName, rootVersion, preflightPackageInstallPaths(packages));
}

function buildPreparedLockfile(
  rootName: string,
  rootVersion: string,
  packages: readonly PreparedInstallPackage<LockfilePackage>[],
): Lockfile {
  // Root entry lists only FLAT (hoisted) deps, matching npm's lockfile
  // shape. A nested copy is reachable only via its parent's entry.
  const flatTopLevel: Record<string, string> = {};
  for (const { package: p, relativePath } of packages) {
    if (relativePath === `node_modules/${p.name}`) {
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
  for (const { package: p, relativePath } of packages) {
    const entry: LockfileEntry = {
      version: p.version,
      dependencies: p.dependencies,
    };
    if (p.resolved) entry.resolved = p.resolved;
    if (p.integrity) entry.integrity = p.integrity;
    if (p.bin) entry.bin = p.bin;
    if (p.peerDependencies && Object.keys(p.peerDependencies).length > 0) {
      entry.peerDependencies = p.peerDependencies;
    }
    // Key by installPath so npm's resolver (and the lockfile fast-path)
    // can distinguish a nested copy from its flat counterpart.
    lf.packages[relativePath] = entry;
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
  const prepared = preflightPackageInstallPaths(packages);
  return buildPreparedInstallLockfile(rootName, rootVersion, prepared, planValue);
}

export function buildPreparedInstallLockfile(
  rootName: string,
  rootVersion: string,
  packages: readonly PreparedInstallPackage<LockfilePackage>[],
  planValue: ShadowAssetPlan,
): Lockfile {
  const plan = planValue;
  if (!Object.isFrozen(plan) || !Object.isFrozen(plan.substitutions)) {
    throw new TypeError('trusted installer shadow plan invariant failed');
  }
  const lockfile = buildPreparedLockfile(rootName, rootVersion, packages);
  if (plan.substitutions.length === 0) return lockfile;
  for (const substitution of plan.substitutions) {
    let entry = lockfile.packages[substitution.materialization.installPath];
    if (!entry) {
      entry = { version: substitution.materialization.version };
      lockfile.packages[substitution.materialization.installPath] = entry;
    } else if (entry.version !== substitution.materialization.version) {
      throw new TypeError(`shadow substitution ${substitution.substitutionId} entry drifted`);
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
