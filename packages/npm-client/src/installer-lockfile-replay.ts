import type { ShadowAssetPlan } from './internal/shadow/planner.ts';
import type { Lockfile, RootLockfileDependencyMaps } from './linker.ts';
import type { VersionManifest } from './registry.ts';

export interface ReplayPin {
  readonly origin: 'lockfile' | 'metadata';
  readonly installPath?: string;
}

export interface LockfileReplayAccounting {
  readonly reachedLockfilePaths: Set<string>;
  readonly skippedLockfilePaths: Set<string>;
}

export function createLockfileReplayAccounting(): LockfileReplayAccounting {
  return { reachedLockfilePaths: new Set(), skippedLockfilePaths: new Set() };
}

export function recordReplayReached(accounting: LockfileReplayAccounting, pin: ReplayPin): void {
  if (pin.origin !== 'lockfile' || pin.installPath === undefined) return;
  accounting.reachedLockfilePaths.add(pin.installPath);
  accounting.skippedLockfilePaths.delete(pin.installPath);
}

export function recordReplaySkippedPin(accounting: LockfileReplayAccounting, pin: ReplayPin): void {
  if (pin.origin === 'lockfile' && pin.installPath !== undefined) {
    accounting.skippedLockfilePaths.add(pin.installPath);
  }
}

export function recordReplaySkippedError(
  accounting: LockfileReplayAccounting,
  error: unknown,
): void {
  const installPath = (error as { installPath?: unknown })?.installPath;
  if (typeof installPath === 'string') accounting.skippedLockfilePaths.add(installPath);
}

export function assertLockfileReplayCoverage(
  lockfile: Lockfile,
  reachedLockfilePaths: ReadonlySet<string>,
  skippedLockfilePaths: ReadonlySet<string>,
  shadowPlan: ShadowAssetPlan,
): void {
  const shadowMaterializationPaths = new Set(
    shadowPlan.substitutions.map((substitution) => substitution.materialization.installPath),
  );
  const unreachedEntries = Object.entries(lockfile.packages)
    .filter(
      ([installPath, entry]) =>
        installPath !== '' &&
        entry.inBundle !== true &&
        !shadowMaterializationPaths.has(installPath) &&
        !reachedLockfilePaths.has(installPath) &&
        !skippedLockfilePaths.has(installPath),
    )
    .map(([installPath]) => installPath);
  if (unreachedEntries.length === 0) return;

  const preview = unreachedEntries.slice(0, 20).join(', ');
  throw Object.assign(
    new Error(
      `EBROKENLOCK: lockfile contains ${unreachedEntries.length} unreached-entries (${preview}${
        unreachedEntries.length > 20 ? ', …' : ''
      }). Delete the lockfile and re-install.`,
    ),
    {
      code: 'EBROKENLOCK' as const,
      reason: 'unreached-entries' as const,
      unreachedEntries,
    },
  );
}

export function lockfileRootMatchesRequest(
  lockfile: Lockfile,
  request: RootLockfileDependencyMaps,
): boolean {
  const root = lockfile.packages[''];
  return (
    root !== undefined &&
    sameStringRecord(root.dependencies, request.dependencies) &&
    sameStringRecord(root.devDependencies, request.devDependencies) &&
    sameStringRecord(root.optionalDependencies, request.optionalDependencies)
  );
}

function sameStringRecord(
  actual: Readonly<Record<string, string>> | undefined,
  expected: Readonly<Record<string, string>>,
): boolean {
  const actualEntries = Object.entries(actual ?? {}).sort(([left], [right]) =>
    left.localeCompare(right),
  );
  const expectedEntries = Object.entries(expected).sort(([left], [right]) =>
    left.localeCompare(right),
  );
  return (
    actualEntries.length === expectedEntries.length &&
    actualEntries.every(
      ([name, range], index) =>
        name === expectedEntries[index]?.[0] && range === expectedEntries[index]?.[1],
    )
  );
}

export function preserveSkippedLockfileEntries(
  lockfile: Lockfile,
  sourceLockfile: Lockfile | null,
  skippedLockfilePaths: ReadonlySet<string>,
): void {
  if (sourceLockfile === null) return;
  for (const installPath of skippedLockfilePaths) {
    const entry = sourceLockfile.packages[installPath];
    if (entry !== undefined && !Object.hasOwn(lockfile.packages, installPath)) {
      lockfile.packages[installPath] = { ...entry };
    }
  }
}

export function malformedLockfileEntry(
  packageName: string,
  installPath: string,
  field: string,
): Error & { code: 'EBROKENLOCK'; packageName: string; reason: 'malformed-entry' } {
  return Object.assign(
    new Error(
      `EBROKENLOCK: lockfile entry for '${packageName}' at '${installPath}' has malformed ${field}. Delete the lockfile and re-install.`,
    ),
    {
      code: 'EBROKENLOCK' as const,
      packageName,
      reason: 'malformed-entry' as const,
    },
  );
}

export function lockfileStringMap(
  value: unknown,
  field: string,
  packageName: string,
  installPath: string,
): Record<string, string> {
  if (value === undefined) return {};
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw malformedLockfileEntry(packageName, installPath, field);
  }
  const result: Record<string, string> = {};
  for (const [name, range] of Object.entries(value as Record<string, unknown>)) {
    if (typeof range !== 'string') throw malformedLockfileEntry(packageName, installPath, field);
    result[name] = range;
  }
  return result;
}

export function lockfileStringArray(
  value: unknown,
  field: string,
  packageName: string,
  installPath: string,
): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw malformedLockfileEntry(packageName, installPath, field);
  }
  return [...value];
}

export function assertNativeSupported(
  name: string,
  version: string,
  platform: Pick<VersionManifest, 'cpu' | 'os'>,
  installPath?: string,
): void {
  const cpu = platform.cpu;
  if (!Array.isArray(cpu) || cpu.length === 0) return;
  if (cpu.includes('wasm') || cpu.includes('wasm32') || cpu.some((c) => c.startsWith('!'))) return;
  throw Object.assign(
    new Error(
      `ENATIVEUNSUPPORTED: '${name}@${version}' ships a native binary (cpu: ${JSON.stringify(cpu)}, os: ${JSON.stringify(platform.os ?? null)}) that cannot run in rifty's JS+WASI runtime, and no shadow-registry substitution is registered for it. See docs/public/compat/incompatible-packages.md.`,
    ),
    {
      code: 'ENATIVEUNSUPPORTED',
      packageName: name,
      version,
      reason: 'cpu-constraint',
      platform: { os: platform.os ?? null, cpu },
      ...(installPath === undefined ? {} : { installPath }),
    },
  );
}

export function warnOptional(
  desc: { depName: string; depRange: string; parentName: string },
  err: unknown,
): void {
  const code = (err as { code?: unknown })?.code;
  const reason = (err as { reason?: unknown })?.reason;
  if (
    (code === 'EBROKENLOCK' && reason !== 'missing-entry') ||
    code === 'EINSTALLPATHCONFLICT' ||
    code === 'EINVALIDPACKAGETAR'
  ) {
    throw err;
  }
  if (code === 'ENATIVEUNSUPPORTED') {
    console.warn(
      `npm: skipped optional native dependency ${desc.depName}@${desc.depRange} (expected — rifty runs JS+WASI only, ADR-0051)`,
    );
    return;
  }
  const message = err instanceof Error ? err.message : String(err);
  console.warn(
    `optional dependency ${desc.depName}@${desc.depRange} of ${desc.parentName} could not be installed: ${message}`,
  );
}
