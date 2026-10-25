/**
 * Install bin-claim + link-target assembly (extracted from installer.ts,
 * move-only): the pre-mutation link-target set, current/prior bin-claim
 * sources, and the ADR-0343 companion demand upgrade. A dedicated module —
 * `linker.ts` names the family but is 604 gate-lines at the pin's base, so
 * absorbing this group would breach the 800-line threshold.
 */

import { NotImplementedError } from '@riftydev/io';
import { builtinShadowSubstitutionCatalog } from '@riftydev/shadow-registry/internal';
import { joinPath, normalizePath } from '@riftydev/vfs';
import { lockfilePathBareName, pinnedEntryForParent } from './installer-lockfile-reader.ts';
import type { PinnedPackage } from './installer-walk.ts';
import type { ShadowSubstitutionPlan } from './internal/shadow/planner.ts';
import { registryAcquisitionInstallPath } from './internal/shadow/planner.ts';
import { pinnedShadowSubstitutions } from './internal/shadow/substitution.ts';
import type {
  Lockfile,
  PackageBinClaim,
  PackageBinSource,
  PreparedInstallPackage,
} from './linker.ts';
import { normalizePackageBinSource, normalizePackageBinSources } from './linker.ts';
import { companionRequestsFor } from './shadow-shims.ts';

/** Compute and contain the complete tarball target set before link mutates. */
export function packageLinkTargets(
  root: string,
  packages: readonly PreparedInstallPackage[],
): readonly string[] {
  const canonicalRoot = normalizePath(root);
  const targets = new Set<string>();
  for (const prepared of packages) {
    const pkg = prepared.package;
    const packageRoot = joinPath(canonicalRoot, prepared.relativePath);
    if (!isStrictDescendant(canonicalRoot, packageRoot)) {
      throw invalidPackageLinkPath(prepared.relativePath, `install path for ${pkg.name}`);
    }
    targets.add(packageRoot);
    for (const entryPath of Object.keys(pkg.files)) {
      assertSafePackageRelativePath(entryPath, `tar entry for ${pkg.name}`);
      const target = joinPath(packageRoot, entryPath);
      if (!isStrictDescendant(packageRoot, target)) {
        throw invalidPackageLinkPath(entryPath, `tar entry for ${pkg.name}`);
      }
      targets.add(target);
    }
  }
  return [...targets];
}

export function installPackageBinSources(
  packages: readonly PreparedInstallPackage<PinnedPackage>[],
  shadowPlan: ShadowSubstitutionPlan,
  companionOnlyInstallPaths: ReadonlySet<string>,
): readonly PackageBinSource[] {
  const sources: PackageBinSource[] = packages.map((prepared) => ({
    package:
      companionOnlyInstallPaths.has(prepared.relativePath) ||
      pinnedShadowSubstitutions.has(prepared.package)
        ? { name: prepared.package.name }
        : prepared.package,
    nodeModulesDir: prepared.nodeModulesDir,
  }));
  for (const substitution of shadowPlan.substitutions) {
    const recipe = builtinShadowSubstitutionCatalog.recipes.find(
      (candidate) => candidate.id === substitution.substitutionId,
    );
    if (!recipe) {
      throw new NotImplementedError(
        `shadow-registry.substitutionRecipe.${substitution.substitutionId}`,
      );
    }
    sources.push({
      package: {
        name: substitution.materialization.name,
        bin: { ...recipe.materialization.bin },
      },
      nodeModulesDir: packageNodeModulesDir(
        substitution.materialization.installPath,
        substitution.materialization.name,
      ),
    });
  }
  return sources;
}

export function lockfilePackageBinSources(
  lockfile: Lockfile | null,
  shadowPlan: ShadowSubstitutionPlan | null,
  companionOnlyInstallPaths: ReadonlySet<string>,
  currentSources: readonly PackageBinSource[],
  currentPackages: readonly PreparedInstallPackage<PinnedPackage>[],
): readonly PackageBinSource[] {
  if (!lockfile) return [];
  const excluded = new Set(companionOnlyInstallPaths);
  for (const substitution of shadowPlan?.substitutions ?? []) {
    if (substitution.acquisition.kind === 'registry') {
      excluded.add(registryAcquisitionInstallPath(substitution));
    }
  }
  const upgradedCompanionClaims = companionDemandUpgradePriorClaims(
    lockfile,
    currentSources,
    currentPackages,
    companionOnlyInstallPaths,
  );
  const sources: PackageBinSource[] = [];
  for (const [installPath, entry] of Object.entries(lockfile.packages)) {
    if (installPath === '' || entry.bin === undefined || excluded.has(installPath)) continue;
    const name = lockfilePathBareName(installPath);
    const source: PackageBinSource = {
      package: { name, bin: entry.bin },
      nodeModulesDir: packageNodeModulesDir(installPath, name),
    };
    for (const claim of normalizePackageBinSource(source)) {
      if (upgradedCompanionClaims.has(packageBinClaimKey(claim))) continue;
      sources.push({
        package: { name: claim.owner, bin: { [claim.command]: claim.target } },
        nodeModulesDir: claim.nodeModulesDir,
      });
    }
  }
  return sources;
}

/** ADR-0343: raw lock metadata retains inactive companion bins. A current
 * ordinary edge upgrades that exact companion claim, not a reify owner change. */
function companionDemandUpgradePriorClaims(
  lockfile: Lockfile,
  currentSources: readonly PackageBinSource[],
  currentPackages: readonly PreparedInstallPackage<PinnedPackage>[],
  companionOnlyInstallPaths: ReadonlySet<string>,
): ReadonlySet<string> {
  const currentClaims = new Set(normalizePackageBinSources(currentSources).map(packageBinClaimKey));
  const currentByPath = new Map(
    currentPackages.map((prepared) => [prepared.relativePath, prepared.package]),
  );
  const excluded = new Set<string>();
  for (const [triggerPath, triggerEntry] of Object.entries(lockfile.packages)) {
    if (triggerPath === '' || triggerEntry.bin === undefined || currentByPath.has(triggerPath)) {
      continue;
    }
    const triggerName = lockfilePathBareName(triggerPath);
    const triggerSource: PackageBinSource = {
      package: { name: triggerName, bin: triggerEntry.bin },
      nodeModulesDir: packageNodeModulesDir(triggerPath, triggerName),
    };
    const triggerClaims = normalizePackageBinSource(triggerSource);
    for (const [companionName, companionVersion] of Object.entries(
      companionRequestsFor(triggerName, triggerEntry.version),
    )) {
      const companion = pinnedEntryForParent(lockfile, companionName, triggerPath);
      if (
        !companion ||
        companion.entry.version !== companionVersion ||
        companion.entry.bin === undefined ||
        companionOnlyInstallPaths.has(companion.installPath)
      ) {
        continue;
      }
      const currentCompanion = currentByPath.get(companion.installPath);
      if (
        currentCompanion?.name !== companionName ||
        currentCompanion.version !== companionVersion
      ) {
        continue;
      }
      const companionSource: PackageBinSource = {
        package: { name: companionName, bin: companion.entry.bin },
        nodeModulesDir: packageNodeModulesDir(companion.installPath, companionName),
      };
      for (const companionClaim of normalizePackageBinSource(companionSource)) {
        if (!currentClaims.has(packageBinClaimKey(companionClaim))) continue;
        for (const triggerClaim of triggerClaims) {
          if (
            triggerClaim.nodeModulesDir === companionClaim.nodeModulesDir &&
            triggerClaim.command === companionClaim.command
          ) {
            excluded.add(packageBinClaimKey(triggerClaim));
          }
        }
      }
    }
  }
  return excluded;
}

function packageBinClaimKey(claim: PackageBinClaim): string {
  return `${claim.nodeModulesDir}\0${claim.command}\0${claim.owner}`;
}

function packageNodeModulesDir(installPath: string, packageName: string): string {
  const suffix = `/${packageName}`;
  if (!installPath.endsWith(suffix)) {
    throw new TypeError(`package bin source has invalid install path ${installPath}`);
  }
  return installPath.slice(0, -suffix.length);
}

function isStrictDescendant(root: string, path: string): boolean {
  return path !== root && path.startsWith(root === '/' ? '/' : `${root}/`);
}

function assertSafePackageRelativePath(path: string, label: string): void {
  if (path === '' || path.startsWith('/') || path.split('/').includes('..')) {
    throw invalidPackageLinkPath(path, label);
  }
}

function invalidPackageLinkPath(path: string, label: string): Error {
  return Object.assign(new Error(`Invalid package ${label}: ${path}`), {
    code: 'EINVALIDPACKAGETAR' as const,
    path,
  });
}
