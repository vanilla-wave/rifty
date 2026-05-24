/**
 * Top-level installer: resolve a name+range, walk transitive deps, fetch
 * tarballs, unpack into the VFS.
 *
 * For M9 we stay flat: every package lives directly under
 * `node_modules/<name>/`. Conflicting versions throw `EVERSIONCONFLICT`
 * (A-031) — nested install lands in M11 per ADR 0023.
 */

import { type Vfs, joinPath } from '@rifty/vfs';
import { type ResolvedPackage, buildLockfile, link } from './linker.ts';
import { type OverrideMap, resolveOverride } from './overrides.ts';
import type { Packument, RegistryClient } from './registry.ts';
import { pickBestVersion } from './semver.ts';
import { extractTarGz } from './unpacker.ts';

export interface InstallOptions {
  vfs: Vfs;
  cwd: string;
  registry: RegistryClient;
  overrides?: OverrideMap;
  /** Cache of already-loaded packuments (lets multiple installs share). */
  packumentCache?: Map<string, Packument>;
}

export interface InstallResult {
  packages: ResolvedPackage[];
  lockfile: ReturnType<typeof buildLockfile>;
  // Retained for shape compatibility; always empty since A-031 made conflicts
  // throw EVERSIONCONFLICT instead of being collected (nested install lands in M11; see ADR 0023).
  conflicts: { name: string; firstVersion: string; secondVersion: string }[];
}

export async function install(
  rootName: string,
  rootVersion: string,
  dependencies: Record<string, string>,
  opts: InstallOptions,
): Promise<InstallResult> {
  const packumentCache = opts.packumentCache ?? new Map<string, Packument>();
  const resolved = new Map<string, ResolvedPackage>();
  const conflicts: InstallResult['conflicts'] = [];

  async function resolveDep(
    name: string,
    range: string | null,
    parent: string | undefined,
  ): Promise<void> {
    const override = resolveOverride(name, parent, opts.overrides);
    const effectiveName = override?.name ?? name;
    const effectiveRange = override?.range ?? range;

    let packument = packumentCache.get(effectiveName);
    if (!packument) {
      packument = await opts.registry.getPackument(effectiveName);
      packumentCache.set(effectiveName, packument);
    }
    const versions = Object.keys(packument.versions);
    let pick = pickBestVersion(versions, effectiveRange);
    if (!pick) {
      const tag = packument['dist-tags']?.latest;
      if (tag) pick = tag;
    }
    if (!pick) throw new Error(`No matching version for ${effectiveName}@${effectiveRange ?? '*'}`);

    if (resolved.has(effectiveName)) {
      const existing = resolved.get(effectiveName)!;
      if (existing.version !== pick) {
        throw Object.assign(
          new Error(
            `Conflicting versions of ${effectiveName}: ${existing.version} vs ${pick} — nested install not implemented yet (deferred to M11; see ADR 0023)`,
          ),
          {
            code: 'EVERSIONCONFLICT',
            packageName: effectiveName,
            firstVersion: existing.version,
            secondVersion: pick,
          },
        );
      }
      return;
    }

    const manifest = packument.versions[pick];
    if (!manifest) throw new Error(`Packument missing version manifest ${effectiveName}@${pick}`);

    const tarball = await opts.registry.getTarball(manifest.dist.tarball);
    const files = await extractTarGz(tarball);
    const pkg: ResolvedPackage = {
      name: effectiveName,
      version: pick,
      files,
      dependencies: manifest.dependencies ?? {},
    };
    resolved.set(effectiveName, pkg);

    for (const [depName, depRange] of Object.entries(manifest.dependencies ?? {})) {
      await resolveDep(depName, depRange, effectiveName);
    }
  }

  for (const [depName, depRange] of Object.entries(dependencies)) {
    await resolveDep(depName, depRange, rootName);
  }

  const packages = [...resolved.values()];
  await link(opts.vfs, opts.cwd, packages);
  const lockfile = buildLockfile(rootName, rootVersion, packages);
  await opts.vfs.writeFile(
    joinPath(opts.cwd, 'package-lock.json'),
    JSON.stringify(lockfile, null, 2),
  );
  return { packages, lockfile, conflicts };
}
