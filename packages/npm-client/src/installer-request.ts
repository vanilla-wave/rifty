/**
 * Install-request normalization + validation (extracted from installer.ts,
 * move-only): overload argument normalization, root package.json reading,
 * override merging, registry-spec/lifecycle gates. Pure input validation, no
 * install state.
 */

import { NotImplementedError } from '@riftydev/io';
import { type Vfs, joinPath } from '@riftydev/vfs';
import type { InstallOptions } from './installer.ts';
import type { RootLockfileDependencyMaps } from './linker.ts';
import type { OverrideMap } from './overrides.ts';

export interface NormalizedInstallRequest {
  readonly rootName: string;
  readonly rootVersion: string;
  readonly dependencies: Record<string, string>;
  readonly optionalDependencies: Record<string, string>;
  readonly rootLockfileDependencyMaps: RootLockfileDependencyMaps;
  readonly opts: InstallOptions;
}

export async function normalizeInstallArgs(
  rootNameOrOpts: string | InstallOptions,
  rootVersion: string | undefined,
  dependenciesOrOpts: Record<string, string> | InstallOptions | undefined,
  maybeOpts: InstallOptions | undefined,
): Promise<NormalizedInstallRequest> {
  let rootName: string | undefined;
  let normalizedRootVersion: string | undefined;
  let dependencies: Record<string, string> | undefined;
  let optionalDependencies: Record<string, string> = {};
  let rootLockfileDependencyMaps: RootLockfileDependencyMaps | undefined;
  let opts: InstallOptions | undefined;
  let shouldReadPackageJson = false;

  if (isInstallOptions(rootNameOrOpts)) {
    opts = rootNameOrOpts;
    shouldReadPackageJson = true;
  } else {
    rootName = rootNameOrOpts;
    normalizedRootVersion = rootVersion;
    if (isInstallOptions(dependenciesOrOpts)) {
      opts = dependenciesOrOpts;
      shouldReadPackageJson = true;
    } else {
      dependencies = dependenciesOrOpts;
      opts = maybeOpts;
    }
  }

  if (!opts) throw new TypeError('install() missing InstallOptions');

  if (shouldReadPackageJson) {
    const manifest = await readRootPackageJson(opts.vfs, opts.cwd);
    rootName = rootName ?? manifest.name ?? 'root';
    normalizedRootVersion = normalizedRootVersion ?? manifest.version ?? '0.0.0';
    rootLockfileDependencyMaps = {
      dependencies: { ...manifest.dependencies },
      devDependencies: { ...manifest.devDependencies },
      optionalDependencies: { ...manifest.optionalDependencies },
    };
    dependencies = { ...manifest.devDependencies, ...manifest.dependencies };
    optionalDependencies = { ...manifest.optionalDependencies };
    for (const name of Object.keys(optionalDependencies)) {
      delete dependencies[name];
    }
    opts = {
      ...opts,
      overrides: mergeOverrides(manifest.overrides, opts.overrides),
    };
  }

  dependencies ??= {};
  rootLockfileDependencyMaps ??= {
    dependencies: { ...dependencies },
    devDependencies: {},
    optionalDependencies: { ...optionalDependencies },
  };
  rootName ??= 'root';
  normalizedRootVersion ??= '0.0.0';
  assertRegistryDependencySpecs(dependencies, optionalDependencies);
  assertRegistryOverrideTargets(opts.overrides);
  return {
    rootName,
    rootVersion: normalizedRootVersion,
    dependencies,
    optionalDependencies,
    rootLockfileDependencyMaps,
    opts,
  };
}

function isInstallOptions(value: unknown): value is InstallOptions {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<InstallOptions>;
  return !!candidate.vfs && typeof candidate.cwd === 'string' && !!candidate.registry;
}

interface RootPackageJson {
  readonly name?: string;
  readonly version?: string;
  readonly dependencies: Record<string, string>;
  readonly devDependencies: Record<string, string>;
  readonly optionalDependencies: Record<string, string>;
  readonly overrides: OverrideMap;
}

async function readRootPackageJson(vfs: Vfs, cwd: string): Promise<RootPackageJson> {
  const text = await vfs.readFileText(joinPath(cwd, 'package.json'));
  const parsed = JSON.parse(text) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`package.json at ${joinPath(cwd, 'package.json')} must be a JSON object`);
  }
  const raw = parsed as Record<string, unknown>;
  assertNoLifecycleScripts(readStringRecord(raw, 'scripts'));
  return {
    name: typeof raw.name === 'string' ? raw.name : undefined,
    version: typeof raw.version === 'string' ? raw.version : undefined,
    dependencies: readStringRecord(raw, 'dependencies'),
    devDependencies: readStringRecord(raw, 'devDependencies'),
    optionalDependencies: readStringRecord(raw, 'optionalDependencies'),
    overrides: readStringRecord(raw, 'overrides'),
  };
}

function readStringRecord(source: Record<string, unknown>, field: string): Record<string, string> {
  const value = source[field];
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`package.json#${field} must be an object of string values`);
  }
  const out: Record<string, string> = {};
  for (const [name, range] of Object.entries(value as Record<string, unknown>)) {
    if (typeof range !== 'string') {
      // TODO(backlog: npm-client/tar-symlink-and-nonregistry-dep-tracking)
      throw new NotImplementedError(
        `npm-client.package-json.${field}`,
        'nested/non-string entries',
      );
    }
    out[name] = range;
  }
  return out;
}

function mergeOverrides(
  fromPackageJson: OverrideMap,
  fromOptions: OverrideMap | undefined,
): OverrideMap | undefined {
  const merged = { ...fromPackageJson, ...(fromOptions ?? {}) };
  return Object.keys(merged).length > 0 ? merged : undefined;
}

function assertRegistryDependencySpecs(
  dependencies: Record<string, string>,
  optionalDependencies: Record<string, string>,
): void {
  for (const [name, range] of Object.entries({ ...dependencies, ...optionalDependencies })) {
    const feature = unsupportedDependencyName(name) ?? unsupportedDependencySpec(range);
    if (feature) {
      // TODO(backlog: npm-client/tar-symlink-and-nonregistry-dep-tracking)
      throw new NotImplementedError(
        `npm-client.dependency-spec.${feature}`,
        `${name}@${range} is outside registry semver/tag installs`,
      );
    }
  }
}

function assertRegistryOverrideTargets(overrides: OverrideMap | undefined): void {
  if (!overrides) return;
  for (const [name, target] of Object.entries(overrides)) {
    const feature = unsupportedOverrideTargetSpec(target);
    if (!feature) continue;
    // TODO(backlog: npm-client/tar-symlink-and-nonregistry-dep-tracking)
    throw new NotImplementedError(
      `npm-client.dependency-spec.${feature}`,
      `override ${name} -> ${target} is outside registry semver/tag installs`,
    );
  }
}

function unsupportedDependencySpec(range: string): string | null {
  const spec = range.trim();
  if (spec === '.' || spec === '..') return 'file';
  if (/^(?:\.{0,2}\/|\/)/.test(spec)) return 'file';
  if (/^(file|link):/.test(spec)) return 'file';
  if (spec.startsWith('workspace:')) return 'workspace';
  if (/^(git\+|git:|github:|gitlab:|bitbucket:)/.test(spec) || /\.git(?:#|$)/.test(spec)) {
    return 'git';
  }
  if (/^https?:/.test(spec)) return 'http-tarball';
  if (spec.startsWith('npm:')) return 'npm-alias';
  if (isGithubShorthand(spec)) return 'git';
  return null;
}

function unsupportedDependencyName(name: string): string | null {
  return name.includes('/') && !name.startsWith('@') ? 'git' : null;
}

function isGithubShorthand(spec: string): boolean {
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:[#@].+)?$/.test(spec);
}

function unsupportedOverrideTargetSpec(target: string): string | null {
  const raw = target.trim();
  const withoutAlias = raw.startsWith('npm:') ? raw.slice(4) : raw;
  const direct = unsupportedDependencySpec(withoutAlias);
  if (direct) return direct;
  const at = withoutAlias.lastIndexOf('@');
  if (at <= 0) return null;
  return unsupportedDependencySpec(withoutAlias.slice(at + 1));
}

const ROOT_LIFECYCLE_SCRIPTS = ['preinstall', 'install', 'postinstall', 'prepare'] as const;
export const REGISTRY_TARBALL_LIFECYCLE_SCRIPTS = ['preinstall', 'install', 'postinstall'] as const;

export function assertNoLifecycleScripts(
  scripts: Record<string, string> | undefined,
  lifecycleScripts: readonly string[] = ROOT_LIFECYCLE_SCRIPTS,
): void {
  if (!scripts) return;
  for (const name of lifecycleScripts) {
    if (scripts[name] === undefined) continue;
    throw new NotImplementedError(`npm-client.lifecycle.${name}`);
  }
}
