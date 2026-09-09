import {
  type InstallResult,
  type Lockfile,
  install,
  serializePackageJson,
} from '@riftydev/npm-client';
import {
  companionInstallPathsForInstallResult,
  lockfileRootMatchesRequest,
  planShadowSubstitutionsFromLockfile,
  readExistingLockfile,
  registryAcquisitionInstallPath,
  registryShadowEmbeddedSourcesFromLockfile,
  shadowSubstitutionPlanForInstallResult,
} from '@riftydev/npm-client/internal';
import { createMemoryFs } from '@riftydev/vfs/internal';
import { finalizePackageInstallFiles } from '../workers/package-install-finalizer.ts';
import { DEFAULT_ASSET_MAX_BYTES, drainByteStreamBounded } from './bounded-asset-fetch.ts';
import {
  buildDepSnapshot,
  serializeDepSnapshotTar,
  sha256Identity,
  verifyDepSnapshotReplayCache,
} from './dep-snapshot.ts';
import { effectiveDepsFromPackageJsonText } from './install-stamp.ts';
import { createProxiedRegistryClient } from './registry-fetch.ts';

export interface ProduceDependencySnapshotOptions {
  readonly packageJsonText: string;
  readonly packageLockText: string;
  readonly registryUrl: string;
  readonly templateId: string;
}

export interface ProducedDependencySnapshot {
  readonly archive: Uint8Array<ArrayBuffer>;
  readonly snapshotId: string;
  readonly installArtifactIdentity: string;
}

const ROOT = '/workspace';

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function dependencyMap(value: unknown, label: string): Record<string, string> {
  if (value === undefined) return {};
  const entries = Object.entries(record(value, label));
  if (entries.some(([, range]) => typeof range !== 'string')) {
    throw new TypeError(`${label} must contain string ranges`);
  }
  return Object.fromEntries(entries) as Record<string, string>;
}

function registryEndpoint(value: string): string {
  const url = new URL(value);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  ) {
    throw new TypeError('registryUrl must be a credential-free HTTP(S) registry path');
  }
  return url.href.replace(/\/$/, '');
}

function assertLockPaths(lockfile: Lockfile): void {
  const packages = record(lockfile.packages, 'lockfile packages');
  for (const [path, entry] of Object.entries(packages)) {
    if (
      path !== '' &&
      (!path.startsWith('node_modules/') ||
        path.includes('\0') ||
        path.split('/').some((part) => part === '' || part === '.' || part === '..'))
    )
      throw new TypeError(`Invalid lockfile package path ${JSON.stringify(path)}`);
    record(entry, `lockfile package ${path}`);
  }
}

/** Admission of output identities, not a second dependency resolver. */
function assertCallerPins(original: Lockfile, result: InstallResult): void {
  const plan = shadowSubstitutionPlanForInstallResult(result);
  planShadowSubstitutionsFromLockfile(result.lockfile);
  const materializations = new Set(
    plan.substitutions.map((item) => item.materialization.installPath),
  );
  const additions = new Set(companionInstallPathsForInstallResult(result));
  for (const item of plan.substitutions) {
    if (item.acquisition.kind === 'registry') additions.add(registryAcquisitionInstallPath(item));
  }
  for (const source of registryShadowEmbeddedSourcesFromLockfile(result.lockfile, plan)) {
    for (const child of source.dependencies) additions.add(child.installPath);
  }
  for (const [path, entry] of Object.entries(result.lockfile.packages)) {
    if (path === '' || materializations.has(path)) continue;
    const before = Object.hasOwn(original.packages, path) ? original.packages[path] : undefined;
    if (before === undefined && additions.has(path)) continue;
    if (
      !before ||
      entry.version !== before.version ||
      entry.resolved !== before.resolved ||
      entry.integrity !== before.integrity
    ) {
      throw new Error(
        `Dependency snapshot requires a caller lockfile pin for ${path}; refusing newly resolved or changed identity`,
      );
    }
  }
}

/** Bake with the installed runtime recipe; caller files are never modified (ADR-0387). */
export async function produceDependencySnapshot(
  options: ProduceDependencySnapshotOptions,
): Promise<ProducedDependencySnapshot> {
  if (
    typeof options.templateId !== 'string' ||
    options.templateId.length === 0 ||
    options.templateId.includes('\0')
  ) {
    throw new TypeError('templateId must be a non-empty NUL-free string');
  }
  const registryUrl = registryEndpoint(options.registryUrl);
  const manifest = record(JSON.parse(options.packageJsonText) as unknown, 'package.json');
  const packageJsonText = serializePackageJson(manifest);
  const deps = effectiveDepsFromPackageJsonText(packageJsonText);
  if (deps === null) throw new TypeError('Invalid dependency snapshot package.json');
  const { vfs, fsSync } = createMemoryFs();
  await vfs.mkdir(ROOT, { recursive: true });
  await vfs.writeFile(`${ROOT}/package.json`, packageJsonText);
  await vfs.writeFile(`${ROOT}/package-lock.json`, options.packageLockText);
  const original = await readExistingLockfile(vfs, ROOT);
  if (!original) throw new TypeError('Dependency snapshot requires an npm v3 lockfile');
  assertLockPaths(original);
  if (
    !lockfileRootMatchesRequest(original, {
      dependencies: dependencyMap(manifest.dependencies, 'dependencies'),
      devDependencies: dependencyMap(manifest.devDependencies, 'devDependencies'),
      optionalDependencies: dependencyMap(manifest.optionalDependencies, 'optionalDependencies'),
    })
  )
    throw new Error('Dependency snapshot manifest does not match lockfile root requests');

  const result = await install({
    vfs,
    cwd: ROOT,
    registry: createProxiedRegistryClient({ proxyPrefix: registryUrl }),
  });
  assertCallerPins(original, result);
  await finalizePackageInstallFiles({ root: ROOT, fs: fsSync });
  const snapshot = buildDepSnapshot(fsSync, ROOT, {
    templateId: options.templateId,
    deps,
    packages: result.packages.length,
  });
  await verifyDepSnapshotReplayCache(snapshot);
  const tar = new Uint8Array(serializeDepSnapshotTar(snapshot));
  if (tar.byteLength > DEFAULT_ASSET_MAX_BYTES)
    throw new Error(`Dependency snapshot exceeds ${DEFAULT_ASSET_MAX_BYTES} decoded bytes`);
  const archive = await drainByteStreamBounded(
    new Blob([tar]).stream().pipeThrough(new CompressionStream('gzip')),
    { label: 'dependency snapshot compression', maxBytes: DEFAULT_ASSET_MAX_BYTES },
  );
  return Object.freeze({
    archive,
    snapshotId: await sha256Identity(tar),
    installArtifactIdentity: snapshot.installArtifactIdentity,
  });
}
