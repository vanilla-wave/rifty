/**
 * Leaf install diagnostics (extracted from installer.ts, move-only): peer-dep
 * warn pass + collision/override predicates. No install state.
 */

import type { PinnedPackage } from './installer-walk.ts';
import type { OverrideMap } from './overrides.ts';
import { resolveEffectivePackageRequest } from './shadow-shims.ts';

/**
 * Warn once per missing peer dependency. Intentionally checks presence only,
 * not whether the installed version satisfies the range — range-level
 * peer-resolution is its own milestone.
 */
export function warnUnsatisfiedPeers(packages: readonly PinnedPackage[]): void {
  const installed = new Set(packages.map((p) => p.name));
  for (const pkg of packages) {
    if (!pkg.peerDependencies) continue;
    for (const [peerName, peerRange] of Object.entries(pkg.peerDependencies)) {
      if (installed.has(peerName)) continue;
      console.warn(
        `peer dependency ${peerName}@${peerRange} required by ${pkg.name} but not installed`,
      );
    }
  }
}

/** Whether distinct direct requests project onto one effective package name. */
export function hasEffectiveTopLevelNameCollision(
  dependencies: Record<string, string>,
  optionalDependencies: Record<string, string>,
  rootName: string,
  overrides: OverrideMap | undefined,
): boolean {
  const seen = new Set<string>();
  for (const request of [dependencies, optionalDependencies]) {
    for (const [name, range] of Object.entries(request)) {
      const { effectiveName } = resolveEffectivePackageRequest(name, range, rootName, overrides);
      if (seen.has(effectiveName)) return true;
      seen.add(effectiveName);
    }
  }
  return false;
}

export function hasParentScopedOverride(overrides: OverrideMap | undefined): boolean {
  return Object.keys(overrides ?? {}).some((key) => key.includes('>'));
}
