import { pinnedEntryForParent } from './installer-lockfile-reader.ts';
import type { ShadowAssetPlan } from './internal/shadow/planner.ts';
import type { Lockfile, RootLockfileDependencyMaps } from './linker.ts';
import type { VersionManifest } from './registry.ts';

export interface LockfilePathTranslation {
  readonly recordedPrefix: string;
  readonly actualPrefix: string;
}

/** Longest-prefix rewrite of a recorded lockfile path into the actual tree
 * path after mixed replay relocated a retained parent. */
export function translateRecordedInstallPath(
  installPath: string,
  translations: readonly LockfilePathTranslation[],
): string {
  let match: LockfilePathTranslation | undefined;
  for (const candidate of translations) {
    if (
      (installPath === candidate.recordedPrefix ||
        installPath.startsWith(`${candidate.recordedPrefix}/node_modules/`)) &&
      (match === undefined || candidate.recordedPrefix.length > match.recordedPrefix.length)
    ) {
      match = candidate;
    }
  }
  return match === undefined
    ? installPath
    : `${match.actualPrefix}${installPath.slice(match.recordedPrefix.length)}`;
}

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

/** A skipped optional's subtree is never walked, but its entries stay
 * lock-recorded (npm keeps them; sharp: `@img/sharp-<platform>` →
 * `@img/sharp-libvips-<platform>`). They are reachable through the skipped
 * boundary, so they are recorded skips for the coverage gate and the lock
 * rewrite — never unreached orphans. Same walk-up lookup as `resolve`/
 * `hasLockEntry` (`pinnedEntryForParent`) — no second copy. */
export function expandReplaySkipClosure(
  lockfile: Lockfile,
  accounting: LockfileReplayAccounting,
): void {
  const { reachedLockfilePaths, skippedLockfilePaths } = accounting;
  const queue = [...skippedLockfilePaths];
  while (queue.length > 0) {
    const parentPath = queue.pop();
    if (parentPath === undefined) break;
    const entry = lockfile.packages[parentPath];
    if (entry === undefined) continue;
    const edges = {
      ...entry.dependencies,
      ...entry.optionalDependencies,
      ...entry.peerDependencies,
    };
    for (const name of Object.keys(edges)) {
      const hit = pinnedEntryForParent(lockfile, name, parentPath);
      if (hit === undefined) continue;
      if (reachedLockfilePaths.has(hit.installPath)) continue;
      if (skippedLockfilePaths.has(hit.installPath)) continue;
      skippedLockfilePaths.add(hit.installPath);
      queue.push(hit.installPath);
    }
  }
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

/**
 * Native-dependency gate (ADR-0051, D-005 source #6). rifty runs JS + WASI WASM
 * only — never `.node` addons or native binaries. `cpu` (not `os`) is the
 * signal: pure-JS rarely pins it, every real native does; `os`-only is a soft
 * warning many JS packages use. One predicate, two call sites: lockfile-entry
 * resolve (fail-before-fetch) and the live tarball-manifest backstop.
 */
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

/** Optional-dependency warn messages, verbatim across sources. A platform-native
 * optional sibling is EXPECTED to skip (ADR-0051) and is phrased as such so a
 * pack of bindings does not read as a wall of install errors. `EBROKENLOCK
 * missing-entry` on an optional edge = npm dropped a failed optional at write
 * time → warn-and-skip (npm parity); other EBROKENLOCK reasons, path conflicts,
 * and tar corruption stay loud. */
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
