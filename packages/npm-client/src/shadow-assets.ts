import { MemoryVfs } from '@riftydev/vfs';
import { canonicalShadowDigest, canonicalShadowJson, sha256Hex } from './canonical-shadow-json.ts';
import { fetchAndUnpackToCache } from './fetch-and-unpack.ts';
import type { InstallTreeResult } from './installer.ts';
import type { RegistryClient } from './registry.ts';
import { shadowAssetPlanFromLockfileFacts } from './shadow-asset-lockfile-facts.ts';
import {
  createShadowSubstitutionLockfileTrace,
  planBuiltinShadowAssetsFromLockfileTrace,
} from './shadow-asset-lockfile-trace.ts';
import type { ShadowAssetDescriptor, ShadowAssetPlan } from './shadow-asset-plan.ts';
import { type TarballCache, computeIntegrity, parseIntegrityAlgorithm } from './tarball-cache.ts';

export type { AppliedShadowSubstitution, ShadowAssetPlan } from './shadow-asset-plan.ts';

export const SHADOW_ASSET_MAX_READ_DEADLINE_MS = 30_000;

export type ShadowAssetStorageClass = 'opfs-persisted' | 'opfs-best-effort' | 'memory-session';

export type ShadowAssetStorageEntry =
  | Readonly<{ kind: 'temp'; id: string }>
  | Readonly<{ kind: 'object'; sha256: string }>
  | Readonly<{ kind: 'receipt'; sha256: string }>
  | Readonly<{ kind: 'ready'; requiredSetDigest: string }>;

export interface ShadowAssetStorageSnapshot {
  readonly entryCount: number;
  readonly storedBytes: number;
  readonly entries: readonly Readonly<{
    entry: ShadowAssetStorageEntry;
    byteLength: number;
  }>[];
}

export interface ShadowAssetStorage {
  readonly storageClass: ShadowAssetStorageClass;
  read(entry: ShadowAssetStorageEntry): Promise<Uint8Array | null>;
  write(entry: ShadowAssetStorageEntry, bytes: Uint8Array): Promise<void>;
  remove(entry: ShadowAssetStorageEntry): Promise<void>;
  inspect(): Promise<ShadowAssetStorageSnapshot>;
  clear(): Promise<void>;
  close(): Promise<void>;
}

export interface ShadowAssetSourceRequest {
  readonly name: string;
  readonly version: string;
  readonly integrity: string;
  readonly maxTarballBytes: number;
}

export interface ShadowAssetSourceResult {
  readonly request: ShadowAssetSourceRequest;
  readonly bytes: Uint8Array;
  readonly fillTransport: 'standard' | 'eddy';
  readonly fillCache: 'tarball' | 'network' | 'bundle';
}

export interface ShadowAssetSource {
  acquire(
    requests: readonly ShadowAssetSourceRequest[],
    options: Readonly<{ signal: AbortSignal }>,
  ): Promise<readonly ShadowAssetSourceResult[]>;
  close(): Promise<void>;
}

export type ShadowAssetProgress =
  | Readonly<{
      phase: 'cache-check' | 'fetch' | 'verify' | 'persist';
      assetId: string;
      assetIndex: number;
      assetCount: number;
    }>
  | Readonly<{
      phase: 'ready';
      requiredSetDigest: string;
      assetCount: number;
      storageClass: ShadowAssetStorageClass;
    }>;

export interface ShadowAssetEnsureOptions {
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: ShadowAssetProgress) => void;
}

export interface ShadowAssetReadOptions extends ShadowAssetEnsureOptions {
  readonly deadlineMs?: number;
}

export type ShadowAssetFailurePhase = 'cache-check' | 'fetch' | 'verify' | 'persist' | 'ready';

export interface ShadowAssetTransportFailure {
  readonly transport: 'standard' | 'eddy';
  readonly message: string;
}

export interface ShadowAssetFailure {
  readonly message: string;
  readonly requiredSetDigest: string;
  readonly assetId?: string;
  readonly phase: ShadowAssetFailurePhase;
  readonly transports: readonly ShadowAssetTransportFailure[];
  readonly recovery: 'retry' | 'clear-and-retry' | 'none';
  readonly usedBytes?: number;
  readonly requiredBytes?: number;
  readonly cause?: unknown;
}

export type ShadowAssetReadFailureReason = 'unknown-asset' | 'deadline';

export interface ShadowAssetReadFailure {
  readonly message: string;
  readonly assetId: string;
  readonly reason: ShadowAssetReadFailureReason;
  readonly deadlineMs?: number;
  readonly cause?: unknown;
}

export interface ShadowAssetStoreFailure {
  readonly message: string;
  readonly phase: 'inspect' | 'clear' | 'close';
  readonly recovery: 'retry' | 'clear-and-retry' | 'none';
  readonly usedBytes?: number;
  readonly requiredBytes?: number;
  readonly cause?: unknown;
}

function exactFailureObject<T>(
  value: T,
  required: readonly string[],
  optional: readonly string[],
  label: string,
): asserts value is T & Record<string, unknown> {
  if (
    value === null ||
    typeof value !== 'object' ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new TypeError(`${label} must be a plain object`);
  }
  if (Object.getOwnPropertySymbols(value).length !== 0) throw new TypeError(`${label} has symbols`);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Object.keys(descriptors);
  for (const key of required) {
    if (!keys.includes(key)) throw new TypeError(`${label} is missing ${key}`);
  }
  for (const key of keys) {
    if (!required.includes(key) && !optional.includes(key)) {
      throw new TypeError(`${label} has unexpected ${key}`);
    }
    if (!('value' in (descriptors[key] ?? {}))) throw new TypeError(`${label} has accessors`);
  }
}

function assertMessage(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || value.length === 0) throw new TypeError(`${label} is invalid`);
}

function assertOptionalBytes(value: unknown, label: string): asserts value is number | undefined {
  if (value !== undefined && (!Number.isSafeInteger(value) || (value as number) < 0)) {
    throw new TypeError(`${label} must be a non-negative safe integer`);
  }
}

function snapshotTransportFailures(
  value: readonly ShadowAssetTransportFailure[],
): readonly ShadowAssetTransportFailure[] {
  if (!Array.isArray(value)) throw new TypeError('transports must be an array');
  return Object.freeze(
    value.map((entry) => {
      exactFailureObject(entry, ['message', 'transport'], [], 'transport failure');
      if (entry.transport !== 'standard' && entry.transport !== 'eddy') {
        throw new TypeError('transport failure has invalid transport');
      }
      assertMessage(entry.message, 'transport failure message');
      return Object.freeze({ transport: entry.transport, message: entry.message });
    }),
  );
}

function snapshotStringRecord(value: unknown, label: string): Readonly<Record<string, string>> {
  if (value === null || typeof value !== 'object')
    throw new TypeError(`${label} must be an object`);
  const keys = Object.keys(Object.getOwnPropertyDescriptors(value));
  exactFailureObject(value, [], keys, label);
  const output: Record<string, string> = {};
  for (const key of keys) {
    const entry = (value as Record<string, unknown>)[key];
    if (typeof entry !== 'string') throw new TypeError(`${label}.${key} must be a string`);
    output[key] = entry;
  }
  return Object.freeze(output);
}

function snapshotBin(
  value: unknown,
  label: string,
): string | Readonly<Record<string, string>> | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'string') return value;
  return snapshotStringRecord(value, label);
}

function snapshotLockfileRifty(value: unknown): InstallTreeResult['lockfile']['rifty'] {
  exactFailureObject(value, ['shadowSubstitutions'], [], 'InstallTreeResult.lockfile.rifty');
  const plan = planBuiltinShadowAssetsFromLockfileTrace(value.shadowSubstitutions);
  return Object.freeze({
    shadowSubstitutions: createShadowSubstitutionLockfileTrace(plan),
  });
}

function snapshotInstallTreeResult(value: InstallTreeResult): InstallTreeResult {
  exactFailureObject(
    value,
    ['conflicts', 'lockfile', 'packages', 'provenance'],
    ['closureHash', 'resolvedAt', 'resolvedVia', 'source'],
    'InstallTreeResult',
  );
  if (!Array.isArray(value.packages))
    throw new TypeError('InstallTreeResult.packages must be an array');
  const packages = value.packages.map((pkg, index) => {
    exactFailureObject(
      pkg,
      ['dependencies', 'files', 'name', 'version'],
      ['bin', 'installPath', 'integrity', 'peerDependencies', 'resolved'],
      `InstallTreeResult.packages[${index}]`,
    );
    assertMessage(pkg.name, `InstallTreeResult.packages[${index}].name`);
    assertMessage(pkg.version, `InstallTreeResult.packages[${index}].version`);
    const fileValue = pkg.files as unknown;
    if (fileValue === null || typeof fileValue !== 'object') {
      throw new TypeError(`InstallTreeResult.packages[${index}].files must be an object`);
    }
    const fileKeys = Object.keys(Object.getOwnPropertyDescriptors(fileValue));
    exactFailureObject(fileValue, [], fileKeys, `InstallTreeResult.packages[${index}].files`);
    const files: Record<string, Uint8Array> = {};
    for (const path of fileKeys) {
      const bytes = (fileValue as Record<string, unknown>)[path];
      if (path.length === 0 || !(bytes instanceof Uint8Array)) {
        throw new TypeError(`InstallTreeResult.packages[${index}].files is invalid`);
      }
      files[path] = bytes.slice();
    }
    const output: Record<string, unknown> = {
      name: pkg.name,
      version: pkg.version,
      files: Object.freeze(files),
      dependencies: snapshotStringRecord(
        pkg.dependencies,
        `InstallTreeResult.packages[${index}].dependencies`,
      ),
    };
    for (const field of ['installPath', 'integrity', 'resolved'] as const) {
      if (field in pkg) {
        const entry = pkg[field];
        if (entry !== undefined && typeof entry !== 'string') {
          throw new TypeError(`InstallTreeResult.packages[${index}].${field} must be a string`);
        }
        output[field] = entry;
      }
    }
    if ('bin' in pkg) {
      output.bin = snapshotBin(pkg.bin, `InstallTreeResult.packages[${index}].bin`);
    }
    if ('peerDependencies' in pkg) {
      output.peerDependencies =
        pkg.peerDependencies === undefined
          ? undefined
          : snapshotStringRecord(
              pkg.peerDependencies,
              `InstallTreeResult.packages[${index}].peerDependencies`,
            );
    }
    return Object.freeze(output) as unknown as InstallTreeResult['packages'][number];
  });

  exactFailureObject(
    value.lockfile,
    ['lockfileVersion', 'name', 'packages', 'requires', 'version'],
    ['rifty'],
    'InstallTreeResult.lockfile',
  );
  assertMessage(value.lockfile.name, 'InstallTreeResult.lockfile.name');
  assertMessage(value.lockfile.version, 'InstallTreeResult.lockfile.version');
  if (value.lockfile.lockfileVersion !== 3 || value.lockfile.requires !== true) {
    throw new TypeError('InstallTreeResult.lockfile has invalid schema');
  }
  const lockPackagesValue = value.lockfile.packages as unknown;
  if (lockPackagesValue === null || typeof lockPackagesValue !== 'object') {
    throw new TypeError('InstallTreeResult.lockfile.packages must be an object');
  }
  const lockKeys = Object.keys(Object.getOwnPropertyDescriptors(lockPackagesValue));
  exactFailureObject(lockPackagesValue, [], lockKeys, 'InstallTreeResult.lockfile.packages');
  const lockPackages: Record<string, Record<string, unknown>> = {};
  for (const path of lockKeys) {
    const entry: unknown = (lockPackagesValue as Record<string, unknown>)[path];
    exactFailureObject(
      entry,
      ['version'],
      ['bin', 'dependencies', 'integrity', 'peerDependencies', 'resolved'],
      `InstallTreeResult.lockfile.packages.${path}`,
    );
    assertMessage(entry.version, `InstallTreeResult.lockfile.packages.${path}.version`);
    const cloned: Record<string, unknown> = { version: entry.version };
    for (const field of ['integrity', 'resolved'] as const) {
      if (field in entry) {
        const fieldValue = entry[field];
        if (fieldValue !== undefined && typeof fieldValue !== 'string') {
          throw new TypeError(`InstallTreeResult.lockfile.packages.${path}.${field} is invalid`);
        }
        cloned[field] = fieldValue;
      }
    }
    if ('dependencies' in entry) {
      cloned.dependencies =
        entry.dependencies === undefined
          ? undefined
          : snapshotStringRecord(
              entry.dependencies,
              `InstallTreeResult.lockfile.packages.${path}.dependencies`,
            );
    }
    if ('peerDependencies' in entry) {
      cloned.peerDependencies =
        entry.peerDependencies === undefined
          ? undefined
          : snapshotStringRecord(
              entry.peerDependencies,
              `InstallTreeResult.lockfile.packages.${path}.peerDependencies`,
            );
    }
    if ('bin' in entry) {
      cloned.bin = snapshotBin(entry.bin, `InstallTreeResult.lockfile.packages.${path}.bin`);
    }
    lockPackages[path] = Object.freeze(cloned);
  }
  const lockfile = Object.freeze({
    name: value.lockfile.name,
    version: value.lockfile.version,
    lockfileVersion: 3 as const,
    requires: true as const,
    packages: Object.freeze(lockPackages),
    ...('rifty' in value.lockfile
      ? {
          rifty:
            value.lockfile.rifty === undefined
              ? undefined
              : snapshotLockfileRifty(value.lockfile.rifty),
        }
      : {}),
  });

  if (!Array.isArray(value.conflicts))
    throw new TypeError('InstallTreeResult.conflicts must be an array');
  const conflicts = value.conflicts.map((conflict, index) => {
    exactFailureObject(
      conflict,
      ['firstVersion', 'name', 'secondVersion'],
      [],
      `InstallTreeResult.conflicts[${index}]`,
    );
    assertMessage(conflict.name, `InstallTreeResult.conflicts[${index}].name`);
    assertMessage(conflict.firstVersion, `InstallTreeResult.conflicts[${index}].firstVersion`);
    assertMessage(conflict.secondVersion, `InstallTreeResult.conflicts[${index}].secondVersion`);
    return Object.freeze({ ...conflict });
  });

  exactFailureObject(
    value.provenance,
    ['packages', 'resolution'],
    ['eddyFallback'],
    'InstallTreeResult.provenance',
  );
  if (value.provenance.resolution !== 'metadata' && value.provenance.resolution !== 'lockfile') {
    throw new TypeError('InstallTreeResult.provenance.resolution is invalid');
  }
  if (!Array.isArray(value.provenance.packages)) {
    throw new TypeError('InstallTreeResult.provenance.packages must be an array');
  }
  const provenancePackages = value.provenance.packages.map((entry, index) => {
    exactFailureObject(
      entry,
      ['name', 'transport', 'version'],
      [],
      `InstallTreeResult.provenance.packages[${index}]`,
    );
    assertMessage(entry.name, `InstallTreeResult.provenance.packages[${index}].name`);
    assertMessage(entry.version, `InstallTreeResult.provenance.packages[${index}].version`);
    if (
      entry.transport !== 'cache' &&
      entry.transport !== 'eddy' &&
      entry.transport !== 'registry'
    ) {
      throw new TypeError(`InstallTreeResult.provenance.packages[${index}].transport is invalid`);
    }
    return Object.freeze({ ...entry });
  });
  let eddyFallback: Readonly<{ reason: string }> | undefined;
  if (value.provenance.eddyFallback !== undefined) {
    exactFailureObject(
      value.provenance.eddyFallback,
      ['reason'],
      [],
      'InstallTreeResult.provenance.eddyFallback',
    );
    assertMessage(
      value.provenance.eddyFallback.reason,
      'InstallTreeResult.provenance.eddyFallback.reason',
    );
    eddyFallback = Object.freeze({ reason: value.provenance.eddyFallback.reason });
  }
  const provenance = Object.freeze({
    resolution: value.provenance.resolution,
    packages: Object.freeze(provenancePackages),
    ...(eddyFallback === undefined ? {} : { eddyFallback }),
  });

  if (value.source !== undefined && value.source !== 'eddy' && value.source !== 'standard') {
    throw new TypeError('InstallTreeResult.source is invalid');
  }
  if (
    value.resolvedVia !== undefined &&
    value.resolvedVia !== 'get' &&
    value.resolvedVia !== 'post'
  ) {
    throw new TypeError('InstallTreeResult.resolvedVia is invalid');
  }
  for (const [field, entry] of [
    ['closureHash', value.closureHash],
    ['resolvedAt', value.resolvedAt],
  ] as const) {
    if (entry !== undefined && typeof entry !== 'string') {
      throw new TypeError(`InstallTreeResult.${field} must be a string`);
    }
  }
  return Object.freeze({
    packages: Object.freeze(packages),
    lockfile,
    conflicts: Object.freeze(conflicts),
    provenance,
    ...(value.source === undefined ? {} : { source: value.source }),
    ...(value.closureHash === undefined ? {} : { closureHash: value.closureHash }),
    ...(value.resolvedAt === undefined ? {} : { resolvedAt: value.resolvedAt }),
    ...(value.resolvedVia === undefined ? {} : { resolvedVia: value.resolvedVia }),
  }) as unknown as InstallTreeResult;
}

export class ShadowAssetError extends Error {
  readonly code = 'ESHADOWASSET' as const;
  readonly requiredSetDigest: string;
  readonly assetId?: string;
  readonly phase: ShadowAssetFailurePhase;
  readonly transports: readonly ShadowAssetTransportFailure[];
  readonly recovery: 'retry' | 'clear-and-retry' | 'none';
  readonly usedBytes?: number;
  readonly requiredBytes?: number;
  override readonly cause?: unknown;

  constructor(failure: ShadowAssetFailure) {
    exactFailureObject(
      failure,
      ['message', 'phase', 'recovery', 'requiredSetDigest', 'transports'],
      ['assetId', 'cause', 'requiredBytes', 'usedBytes'],
      'ShadowAssetFailure',
    );
    assertMessage(failure.message, 'ShadowAssetFailure.message');
    if (!SHA256.test(failure.requiredSetDigest)) throw new TypeError('invalid requiredSetDigest');
    if (!FAILURE_PHASES.has(failure.phase)) throw new TypeError('invalid shadow asset phase');
    if (!RECOVERIES.has(failure.recovery)) throw new TypeError('invalid shadow asset recovery');
    if (failure.assetId !== undefined) assertMessage(failure.assetId, 'assetId');
    assertOptionalBytes(failure.usedBytes, 'usedBytes');
    assertOptionalBytes(failure.requiredBytes, 'requiredBytes');
    super(failure.message);
    this.name = 'ShadowAssetError';
    this.requiredSetDigest = failure.requiredSetDigest;
    this.assetId = failure.assetId;
    this.phase = failure.phase;
    this.transports = snapshotTransportFailures(failure.transports);
    this.recovery = failure.recovery;
    this.usedBytes = failure.usedBytes;
    this.requiredBytes = failure.requiredBytes;
    this.cause = failure.cause;
  }
}

export class ShadowAssetInstallError extends ShadowAssetError {
  readonly treeResult: InstallTreeResult;
  readonly plan: ShadowAssetPlan;

  constructor(treeResult: InstallTreeResult, plan: ShadowAssetPlan, failure: ShadowAssetFailure) {
    const treeSnapshot = snapshotInstallTreeResult(treeResult);
    const planSnapshot = snapshotShadowAssetPlan(plan);
    const lockfilePlan = shadowAssetPlanFromLockfileFacts(treeSnapshot.lockfile);
    if (canonicalShadowJson(lockfilePlan) !== canonicalShadowJson(planSnapshot)) {
      throw new TypeError('ShadowAssetInstallError lockfile trace does not match its plan');
    }
    exactFailureObject(
      failure,
      ['message', 'phase', 'recovery', 'requiredSetDigest', 'transports'],
      ['assetId', 'cause', 'requiredBytes', 'usedBytes'],
      'ShadowAssetFailure',
    );
    if (failure.requiredSetDigest !== planSnapshot.requiredSetDigest) {
      throw new TypeError('ShadowAssetInstallError failure digest does not match its plan');
    }
    if (
      failure.assetId !== undefined &&
      !planSnapshot.assets.some((asset) => asset.id === failure.assetId)
    ) {
      throw new TypeError('ShadowAssetInstallError failure asset does not belong to its plan');
    }
    super(failure);
    this.name = 'ShadowAssetInstallError';
    this.treeResult = treeSnapshot;
    this.plan = planSnapshot;
  }
}

export class ShadowAssetReadError extends Error {
  readonly code = 'ESHADOWASSETREAD' as const;
  readonly assetId: string;
  readonly reason: ShadowAssetReadFailureReason;
  readonly deadlineMs?: number;
  override readonly cause?: unknown;

  constructor(failure: ShadowAssetReadFailure) {
    exactFailureObject(
      failure,
      ['assetId', 'message', 'reason'],
      ['cause', 'deadlineMs'],
      'ShadowAssetReadFailure',
    );
    assertMessage(failure.message, 'ShadowAssetReadFailure.message');
    assertMessage(failure.assetId, 'ShadowAssetReadFailure.assetId');
    if (failure.reason !== 'unknown-asset' && failure.reason !== 'deadline') {
      throw new TypeError('invalid shadow asset read reason');
    }
    if (failure.reason === 'deadline') {
      assertDeadline(failure.deadlineMs);
    } else if (failure.deadlineMs !== undefined) {
      throw new TypeError('unknown-asset failure forbids deadlineMs');
    }
    super(failure.message);
    this.name = 'ShadowAssetReadError';
    this.assetId = failure.assetId;
    this.reason = failure.reason;
    this.deadlineMs = failure.deadlineMs;
    this.cause = failure.cause;
  }
}

export class ShadowAssetStoreError extends Error {
  readonly code = 'ESHADOWASSETSTORE' as const;
  readonly phase: 'inspect' | 'clear' | 'close';
  readonly recovery: 'retry' | 'clear-and-retry' | 'none';
  readonly usedBytes?: number;
  readonly requiredBytes?: number;
  override readonly cause?: unknown;

  constructor(failure: ShadowAssetStoreFailure) {
    exactFailureObject(
      failure,
      ['message', 'phase', 'recovery'],
      ['cause', 'requiredBytes', 'usedBytes'],
      'ShadowAssetStoreFailure',
    );
    assertMessage(failure.message, 'ShadowAssetStoreFailure.message');
    if (!STORE_PHASES.has(failure.phase)) throw new TypeError('invalid shadow asset store phase');
    if (!RECOVERIES.has(failure.recovery)) throw new TypeError('invalid shadow asset recovery');
    assertOptionalBytes(failure.usedBytes, 'usedBytes');
    assertOptionalBytes(failure.requiredBytes, 'requiredBytes');
    super(failure.message);
    this.name = 'ShadowAssetStoreError';
    this.phase = failure.phase;
    this.recovery = failure.recovery;
    this.usedBytes = failure.usedBytes;
    this.requiredBytes = failure.requiredBytes;
    this.cause = failure.cause;
  }
}

const SHA256 = /^[0-9a-f]{64}$/;
const FAILURE_PHASES = new Set<ShadowAssetFailurePhase>([
  'cache-check',
  'fetch',
  'verify',
  'persist',
  'ready',
]);
const STORE_PHASES = new Set<ShadowAssetStoreFailure['phase']>(['inspect', 'clear', 'close']);
const RECOVERIES = new Set<ShadowAssetFailure['recovery']>(['retry', 'clear-and-retry', 'none']);

export interface ShadowAssetReadyReceipt {
  readonly schema: 1;
  readonly receiptSha256: string;
  readonly requiredSetDigest: string;
  readonly catalog: Readonly<{ id: string; digest: string }>;
  readonly storageClass: ShadowAssetStorageClass;
  readonly substitutions: ShadowAssetPlan['substitutions'];
  readonly assets: readonly Readonly<{
    id: string;
    source: Readonly<{ name: string; version: string; integrity: string }>;
    member: string;
    memberSha256: string;
    memberSize: number;
    fillTransport: 'standard' | 'eddy';
    fillCache: 'tarball' | 'network' | 'bundle';
  }>[];
}

export type ShadowAssetEnsureResult =
  | Readonly<{ kind: 'not-required'; plan: ShadowAssetPlan }>
  | Readonly<{ kind: 'ready'; plan: ShadowAssetPlan; receipt: ShadowAssetReadyReceipt }>;

export interface ShadowAssetInstaller {
  ensure(
    plan: ShadowAssetPlan,
    options?: ShadowAssetEnsureOptions,
  ): Promise<ShadowAssetEnsureResult>;
  inspectReceipt(requiredSetDigest: string): Promise<ShadowAssetReadyReceipt | null>;
}

export interface ShadowAssetRuntimeReader {
  readVerified(assetId: string, options?: ShadowAssetReadOptions): Promise<Uint8Array>;
}

export interface ShadowAssetUsage {
  readonly storageClass: ShadowAssetStorageClass;
  readonly entryCount: number;
  readonly storedBytes: number;
  readonly verifiedObjectCount: number;
  readonly verifiedObjectBytes: number;
  readonly readySetCount: number;
}

export interface ShadowAssetAdmin {
  inspectUsage(): Promise<ShadowAssetUsage>;
  clearCache(): Promise<ShadowAssetUsage>;
}

export interface ShadowAssetManager {
  readonly installer: ShadowAssetInstaller;
  readonly admin: ShadowAssetAdmin;
  runtimeReader(plan: ShadowAssetPlan): ShadowAssetRuntimeReader;
  close(): Promise<void>;
}

function assertDeadline(value: unknown): asserts value is number {
  if (
    !Number.isSafeInteger(value) ||
    (value as number) <= 0 ||
    (value as number) > SHADOW_ASSET_MAX_READ_DEADLINE_MS
  ) {
    throw new TypeError(
      `deadlineMs must be a positive safe integer <= ${SHADOW_ASSET_MAX_READ_DEADLINE_MS}`,
    );
  }
}

const MEMORY_STORE_ROOT = '/.rifty/shadow-assets/v1';

function assertStorageEntry(entry: ShadowAssetStorageEntry): void {
  if (
    entry === null ||
    typeof entry !== 'object' ||
    Object.getPrototypeOf(entry) !== Object.prototype
  ) {
    throw new TypeError('shadow asset storage entry must be a plain object');
  }
  if (entry.kind === 'temp') {
    exactFailureObject(entry, ['id', 'kind'], [], 'temp storage entry');
    assertMessage(entry.id, 'temp id');
    return;
  }
  if (entry.kind === 'object' || entry.kind === 'receipt') {
    exactFailureObject(entry, ['kind', 'sha256'], [], `${entry.kind} storage entry`);
    if (!SHA256.test(entry.sha256)) throw new TypeError(`invalid ${entry.kind} sha256`);
    return;
  }
  if (entry.kind === 'ready') {
    exactFailureObject(entry, ['kind', 'requiredSetDigest'], [], 'ready storage entry');
    if (!SHA256.test(entry.requiredSetDigest)) throw new TypeError('invalid ready set digest');
    return;
  }
  throw new TypeError('unknown shadow asset storage entry kind');
}

function encodeTempId(id: string): string {
  let encoded = '';
  for (let index = 0; index < id.length; index += 1) {
    encoded += id.charCodeAt(index).toString(16).padStart(4, '0');
  }
  return encoded;
}

function decodeTempId(encoded: string): string | null {
  if (encoded.length === 0 || encoded.length % 4 !== 0 || !/^[0-9a-f]+$/.test(encoded)) {
    return null;
  }
  let id = '';
  for (let index = 0; index < encoded.length; index += 4) {
    id += String.fromCharCode(Number.parseInt(encoded.slice(index, index + 4), 16));
  }
  return encodeTempId(id) === encoded ? id : null;
}

function storagePath(entry: ShadowAssetStorageEntry): string {
  assertStorageEntry(entry);
  switch (entry.kind) {
    case 'temp':
      return `${MEMORY_STORE_ROOT}/tmp/${encodeTempId(entry.id)}`;
    case 'object':
      return `${MEMORY_STORE_ROOT}/objects/${entry.sha256}`;
    case 'receipt':
      return `${MEMORY_STORE_ROOT}/receipts/${entry.sha256}`;
    case 'ready':
      return `${MEMORY_STORE_ROOT}/ready/${entry.requiredSetDigest}`;
  }
}

function decodeStoragePath(path: string): ShadowAssetStorageEntry | null {
  const relative = path.slice(MEMORY_STORE_ROOT.length + 1);
  const slash = relative.indexOf('/');
  if (slash <= 0 || relative.indexOf('/', slash + 1) !== -1) return null;
  const group = relative.slice(0, slash);
  const key = relative.slice(slash + 1);
  if (group === 'objects' && SHA256.test(key)) return { kind: 'object', sha256: key };
  if (group === 'receipts' && SHA256.test(key)) return { kind: 'receipt', sha256: key };
  if (group === 'ready' && SHA256.test(key)) return { kind: 'ready', requiredSetDigest: key };
  if (group === 'tmp') {
    const id = decodeTempId(key);
    if (id !== null) return { kind: 'temp', id };
  }
  return null;
}

class MemoryShadowAssetStorage implements ShadowAssetStorage {
  readonly storageClass = 'memory-session' as const;
  readonly #vfs = new MemoryVfs();
  #closed = false;

  #assertOpen(): void {
    if (this.#closed) throw new Error('shadow asset memory storage is closed');
  }

  async read(entry: ShadowAssetStorageEntry): Promise<Uint8Array | null> {
    this.#assertOpen();
    const path = storagePath(entry);
    if (!(await this.#vfs.exists(path))) return null;
    return (await this.#vfs.readFile(path)).slice();
  }

  async write(entry: ShadowAssetStorageEntry, bytes: Uint8Array): Promise<void> {
    this.#assertOpen();
    if (!(bytes instanceof Uint8Array)) throw new TypeError('storage bytes must be Uint8Array');
    const path = storagePath(entry);
    await this.#vfs.mkdir(path.slice(0, path.lastIndexOf('/')), { recursive: true });
    await this.#vfs.writeFile(path, bytes.slice());
  }

  async remove(entry: ShadowAssetStorageEntry): Promise<void> {
    this.#assertOpen();
    await this.#vfs.rm(storagePath(entry), { force: true });
  }

  async inspect(): Promise<ShadowAssetStorageSnapshot> {
    this.#assertOpen();
    const files: Array<{ path: string; byteLength: number }> = [];
    if (await this.#vfs.exists(MEMORY_STORE_ROOT)) {
      await this.#walk(MEMORY_STORE_ROOT, files);
    }
    const entries: Array<{ entry: ShadowAssetStorageEntry; byteLength: number }> = [];
    for (const file of files) {
      const entry = decodeStoragePath(file.path);
      if (entry) entries.push({ entry, byteLength: file.byteLength });
    }
    entries.sort((left, right) => {
      const a = storagePath(left.entry);
      const b = storagePath(right.entry);
      return a < b ? -1 : a > b ? 1 : 0;
    });
    return Object.freeze({
      entryCount: files.length,
      storedBytes: files.reduce((sum, file) => sum + file.byteLength, 0),
      entries: Object.freeze(entries.map((entry) => Object.freeze(entry))),
    });
  }

  async #walk(
    directory: string,
    files: Array<{ path: string; byteLength: number }>,
  ): Promise<void> {
    for (const entry of await this.#vfs.readdir(directory)) {
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory) await this.#walk(path, files);
      else if (entry.isFile) files.push({ path, byteLength: (await this.#vfs.stat(path)).size });
    }
  }

  async clear(): Promise<void> {
    this.#assertOpen();
    await this.#vfs.rm(MEMORY_STORE_ROOT, { recursive: true, force: true });
  }

  async close(): Promise<void> {
    this.#closed = true;
  }
}

export function createMemoryShadowAssetStorage(): ShadowAssetStorage {
  return new MemoryShadowAssetStorage();
}

const fatalDecoder = new TextDecoder('utf-8', { fatal: true });
const jsonEncoder = new TextEncoder();

const SHADOW_INTEGRITY_DIGEST_BYTES = {
  sha256: 32,
  sha384: 48,
  sha512: 64,
} as const;

function parseCanonicalShadowIntegrity(
  integrity: string,
): ReturnType<typeof parseIntegrityAlgorithm> {
  const algorithm = parseIntegrityAlgorithm(integrity);
  if (algorithm === null) return null;
  const encoded = integrity.slice(algorithm.length + 1);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) return null;
  try {
    const decoded = atob(encoded);
    return decoded.length === SHADOW_INTEGRITY_DIGEST_BYTES[algorithm] && btoa(decoded) === encoded
      ? algorithm
      : null;
  } catch {
    return null;
  }
}

function assertNormalizedMember(member: string): void {
  if (member.length === 0 || member.startsWith('/') || member.includes('\\')) {
    throw new TypeError(`invalid shadow asset member ${JSON.stringify(member)}`);
  }
  const parts = member.split('/');
  if (parts.some((part) => part === '' || part === '.' || part === '..')) {
    throw new TypeError(`non-normal shadow asset member ${JSON.stringify(member)}`);
  }
}

function assertDescriptor(descriptor: ShadowAssetDescriptor): void {
  exactFailureObject(
    descriptor,
    ['id', 'maxTarballBytes', 'maxUnpackedBytes', 'member', 'memberSha256', 'memberSize', 'source'],
    [],
    'ShadowAssetDescriptor',
  );
  exactFailureObject(descriptor.source, ['integrity', 'name', 'version'], [], 'asset source');
  assertMessage(descriptor.id, 'asset id');
  assertMessage(descriptor.source.name, 'asset source name');
  assertMessage(descriptor.source.version, 'asset source version');
  if (parseCanonicalShadowIntegrity(descriptor.source.integrity) === null) {
    throw new TypeError(`invalid source integrity for ${descriptor.id}`);
  }
  assertNormalizedMember(descriptor.member);
  if (!SHA256.test(descriptor.memberSha256)) throw new TypeError('invalid member sha256');
  for (const [label, value] of [
    ['memberSize', descriptor.memberSize],
    ['maxTarballBytes', descriptor.maxTarballBytes],
    ['maxUnpackedBytes', descriptor.maxUnpackedBytes],
  ] as const) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new TypeError(`${descriptor.id}.${label} must be a positive safe integer`);
    }
  }
  if (descriptor.maxUnpackedBytes < descriptor.memberSize) {
    throw new TypeError(`${descriptor.id}.maxUnpackedBytes is below memberSize`);
  }
}

export function snapshotShadowAssetPlan(plan: ShadowAssetPlan): ShadowAssetPlan {
  exactFailureObject(plan, ['assets', 'requiredSetDigest', 'substitutions'], [], 'ShadowAssetPlan');
  if (!SHA256.test(plan.requiredSetDigest)) throw new TypeError('invalid requiredSetDigest');
  if (!Array.isArray(plan.assets) || !Array.isArray(plan.substitutions)) {
    throw new TypeError('shadow asset plan arrays are invalid');
  }
  if (plan.assets.length > 0 && plan.substitutions.length === 0) {
    throw new TypeError('non-empty shadow asset plan requires substitution provenance');
  }
  const substitutionValues = new Set<string>();
  let priorSubstitution = '';
  for (const substitution of plan.substitutions) {
    exactFailureObject(
      substitution,
      [
        'builtin',
        'catalog',
        'publicName',
        'requestedRange',
        'resolvedPublicVersion',
        'runtimeAdapterId',
        'substitutionId',
      ],
      [],
      'AppliedShadowSubstitution',
    );
    exactFailureObject(substitution.catalog, ['digest', 'id'], [], 'substitution catalog');
    assertMessage(substitution.catalog.id, 'substitution catalog id');
    if (!SHA256.test(substitution.catalog.digest)) throw new TypeError('invalid catalog digest');
    if (substitution.builtin !== true)
      throw new TypeError('manager v0 requires builtin provenance');
    assertMessage(substitution.publicName, 'substitution publicName');
    assertMessage(substitution.resolvedPublicVersion, 'substitution resolvedPublicVersion');
    assertMessage(substitution.substitutionId, 'substitution id');
    assertMessage(substitution.runtimeAdapterId, 'runtime adapter id');
    if (substitution.requestedRange !== null && typeof substitution.requestedRange !== 'string') {
      throw new TypeError('invalid requestedRange');
    }
    const value = canonicalShadowJson(substitution);
    if (substitutionValues.has(value)) throw new TypeError('duplicate applied substitution');
    if (priorSubstitution !== '' && priorSubstitution > value) {
      throw new TypeError('applied substitutions are not canonically sorted');
    }
    substitutionValues.add(value);
    priorSubstitution = value;
  }
  const ids = new Set<string>();
  const hashes = new Map<string, { memberSize: number; source: string }>();
  let priorAssetId = '';
  for (const descriptor of plan.assets) {
    assertDescriptor(descriptor);
    if (ids.has(descriptor.id)) throw new TypeError(`duplicate shadow asset id ${descriptor.id}`);
    if (priorAssetId !== '' && priorAssetId > descriptor.id) {
      throw new TypeError('shadow assets are not sorted by id');
    }
    ids.add(descriptor.id);
    priorAssetId = descriptor.id;
    const source = canonicalShadowJson(descriptor.source);
    const prior = hashes.get(descriptor.memberSha256);
    if (prior && (prior.memberSize !== descriptor.memberSize || prior.source !== source)) {
      throw new TypeError(`conflicting descriptor for object ${descriptor.memberSha256}`);
    }
    hashes.set(descriptor.memberSha256, { memberSize: descriptor.memberSize, source });
  }
  const expectedDigest = canonicalShadowDigest({
    schema: 1,
    substitutions: plan.substitutions,
    assets: plan.assets,
  });
  if (plan.requiredSetDigest !== expectedDigest) {
    throw new TypeError('shadow asset required-set digest is not canonical');
  }
  const parsed = JSON.parse(canonicalShadowJson(plan)) as ShadowAssetPlan;
  return freezeDeep(parsed) as ShadowAssetPlan;
}

function freezeDeep<T extends object>(value: T): Readonly<T> {
  for (const child of Object.values(value)) {
    if (child !== null && typeof child === 'object' && !Object.isFrozen(child)) {
      freezeDeep(child as object);
    }
  }
  return Object.freeze(value);
}

async function gunzipBounded(bytes: Uint8Array, maxUnpackedBytes: number): Promise<Uint8Array> {
  if (typeof DecompressionStream !== 'function') {
    throw new Error('No gzip support in this environment (need DecompressionStream)');
  }
  const reader = new Blob([bytes as unknown as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream('gzip'))
    .getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > maxUnpackedBytes) {
        throw new Error(`decompressed archive exceeded ${maxUnpackedBytes} bytes`);
      }
      chunks.push(next.value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function readTarString(bytes: Uint8Array, offset: number, length: number): string {
  const field = bytes.subarray(offset, offset + length);
  const nul = field.indexOf(0);
  return fatalDecoder.decode(nul === -1 ? field : field.subarray(0, nul));
}

function readTarSize(header: Uint8Array): number {
  const raw = readTarString(header, 124, 12).trim();
  if (raw === '') return 0;
  if (!/^[0-7]+$/.test(raw)) throw new Error(`invalid tar member size ${JSON.stringify(raw)}`);
  const value = Number.parseInt(raw, 8);
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('tar member size is unsafe');
  return value;
}

function tarHeaderIsZero(header: Uint8Array): boolean {
  return header.every((byte) => byte === 0);
}

function validateArchivePath(path: string, type: string): string {
  const candidate = type === '5' && path.endsWith('/') ? path.slice(0, -1) : path;
  assertNormalizedMember(candidate);
  return candidate;
}

function extractExactTarMember(tar: Uint8Array, member: string): Uint8Array {
  let offset = 0;
  let match: Uint8Array | null = null;
  let pendingLongName: string | null = null;
  let sawTrailer = false;
  while (offset + 512 <= tar.byteLength) {
    const header = tar.subarray(offset, offset + 512);
    if (tarHeaderIsZero(header)) {
      if (
        offset + 1024 > tar.byteLength ||
        !tarHeaderIsZero(tar.subarray(offset + 512, offset + 1024))
      ) {
        throw new Error('truncated tar trailer');
      }
      for (let index = offset + 1024; index < tar.byteLength; index += 1) {
        if (tar[index] !== 0) throw new Error('non-zero bytes after tar trailer');
      }
      sawTrailer = true;
      break;
    }
    const type = String.fromCharCode(header[156] ?? 0);
    const size = readTarSize(header);
    const bodyStart = offset + 512;
    const paddedSize = Math.ceil(size / 512) * 512;
    const next = bodyStart + paddedSize;
    if (bodyStart + size > tar.byteLength || next > tar.byteLength) {
      throw new Error('truncated tar member body');
    }
    const parsed = `${readTarString(header, 345, 155)}${
      readTarString(header, 345, 155) ? '/' : ''
    }${readTarString(header, 0, 100)}`;
    const body = tar.subarray(bodyStart, bodyStart + size);
    if (type === 'x' || type === 'g') {
      throw new Error('PAX extended tar headers are unsupported');
    }
    if (type === 'L') {
      const nul = body.indexOf(0);
      pendingLongName = fatalDecoder.decode(nul === -1 ? body : body.subarray(0, nul));
      validateArchivePath(pendingLongName, '0');
      offset = next;
      continue;
    }
    const name = validateArchivePath(pendingLongName ?? parsed, type);
    pendingLongName = null;
    if (type === '1' || type === '2' || type === 'K') {
      throw new Error(`tar links are forbidden: ${name}`);
    }
    const regular = type === '0' || type === '\u0000';
    if (name === member) {
      if (!regular) throw new Error(`shadow asset member is not a regular file: ${member}`);
      if (match !== null) throw new Error(`duplicate shadow asset member: ${member}`);
      match = body.slice();
    }
    offset = next;
  }
  if (!sawTrailer) throw new Error('truncated tar archive');
  if (pendingLongName !== null) throw new Error('truncated GNU long-name entry');
  if (match === null) throw new Error(`missing shadow asset member: ${member}`);
  return match;
}

async function extractVerifiedMember(
  descriptor: ShadowAssetDescriptor,
  tarball: Uint8Array,
): Promise<Uint8Array> {
  if (tarball.byteLength > descriptor.maxTarballBytes) {
    throw new Error(`tarball exceeded ${descriptor.maxTarballBytes} bytes`);
  }
  const algorithm = parseCanonicalShadowIntegrity(descriptor.source.integrity);
  if (!algorithm) throw new Error(`unsupported integrity ${descriptor.source.integrity}`);
  const actualIntegrity = await computeIntegrity(tarball, algorithm);
  if (actualIntegrity !== descriptor.source.integrity) {
    throw Object.assign(
      new Error(
        `Integrity mismatch for ${descriptor.source.name}@${descriptor.source.version}: expected ${descriptor.source.integrity}, got ${actualIntegrity}`,
      ),
      {
        code: 'EINTEGRITY' as const,
        packageName: descriptor.source.name,
        version: descriptor.source.version,
        expected: descriptor.source.integrity,
        actual: actualIntegrity,
      },
    );
  }
  const unpacked = await gunzipBounded(tarball, descriptor.maxUnpackedBytes);
  const bytes = extractExactTarMember(unpacked, descriptor.member);
  if (bytes.byteLength !== descriptor.memberSize) {
    throw new Error(
      `shadow asset member size mismatch for ${descriptor.id}: expected ${descriptor.memberSize}, got ${bytes.byteLength}`,
    );
  }
  const actual = sha256Hex(bytes);
  if (actual !== descriptor.memberSha256) {
    throw new Error(
      `shadow asset member hash mismatch for ${descriptor.id}: expected ${descriptor.memberSha256}, got ${actual}`,
    );
  }
  return bytes;
}

interface StoredReadyPointer {
  readonly schema: 1;
  readonly requiredSetDigest: string;
  readonly receiptSha256: string;
}

function decodeCanonicalJson(bytes: Uint8Array, label: string): unknown {
  let text: string;
  try {
    text = fatalDecoder.decode(bytes);
  } catch (error) {
    throw new Error(`${label}: invalid UTF-8`, { cause: error });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch (error) {
    throw new Error(`${label}: invalid JSON`, { cause: error });
  }
  if (canonicalShadowJson(parsed) !== text) throw new Error(`${label}: bytes are not canonical`);
  return parsed;
}

function decodeReadyPointer(bytes: Uint8Array): StoredReadyPointer {
  const parsed = decodeCanonicalJson(bytes, 'shadow asset ready pointer');
  exactFailureObject(
    parsed,
    ['receiptSha256', 'requiredSetDigest', 'schema'],
    [],
    'shadow asset ready pointer',
  );
  if (
    parsed.schema !== 1 ||
    typeof parsed.requiredSetDigest !== 'string' ||
    !SHA256.test(parsed.requiredSetDigest)
  ) {
    throw new Error('shadow asset ready pointer has invalid schema/set digest');
  }
  if (typeof parsed.receiptSha256 !== 'string' || !SHA256.test(parsed.receiptSha256)) {
    throw new Error('shadow asset ready pointer has invalid receipt digest');
  }
  return parsed as unknown as StoredReadyPointer;
}

function decodeReceipt(bytes: Uint8Array, receiptSha256: string): ShadowAssetReadyReceipt {
  if (!SHA256.test(receiptSha256)) throw new Error('shadow asset receipt has invalid digest');
  const parsed = decodeCanonicalJson(bytes, 'shadow asset receipt');
  exactFailureObject(
    parsed,
    ['assets', 'catalog', 'requiredSetDigest', 'schema', 'storageClass', 'substitutions'],
    [],
    'shadow asset receipt',
  );
  if (parsed.schema !== 1) throw new Error('shadow asset receipt has invalid schema');
  if (sha256Hex(bytes) !== receiptSha256) {
    throw new Error('shadow asset receipt digest mismatch');
  }
  const receipt = {
    ...(parsed as Omit<ShadowAssetReadyReceipt, 'receiptSha256'>),
    receiptSha256,
  };
  if (!SHA256.test(receipt.requiredSetDigest)) throw new Error('receipt has invalid set digest');
  if (!STORAGE_CLASSES.has(receipt.storageClass))
    throw new Error('receipt has invalid storage class');
  exactFailureObject(receipt.catalog, ['digest', 'id'], [], 'receipt catalog');
  assertMessage(receipt.catalog.id, 'receipt catalog id');
  if (!SHA256.test(receipt.catalog.digest)) throw new Error('receipt has invalid catalog digest');
  if (!Array.isArray(receipt.substitutions) || !Array.isArray(receipt.assets)) {
    throw new Error('receipt arrays are invalid');
  }
  const substitutionValues = new Set<string>();
  for (const substitution of receipt.substitutions) {
    exactFailureObject(
      substitution,
      [
        'builtin',
        'catalog',
        'publicName',
        'requestedRange',
        'resolvedPublicVersion',
        'runtimeAdapterId',
        'substitutionId',
      ],
      [],
      'receipt substitution',
    );
    exactFailureObject(substitution.catalog, ['digest', 'id'], [], 'receipt substitution catalog');
    if (
      substitution.builtin !== true ||
      typeof substitution.catalog.id !== 'string' ||
      !SHA256.test(substitution.catalog.digest) ||
      typeof substitution.publicName !== 'string' ||
      typeof substitution.resolvedPublicVersion !== 'string' ||
      typeof substitution.substitutionId !== 'string' ||
      typeof substitution.runtimeAdapterId !== 'string' ||
      (substitution.requestedRange !== null && typeof substitution.requestedRange !== 'string')
    ) {
      throw new Error('receipt substitution is invalid');
    }
    const semantic = canonicalShadowJson(substitution);
    if (substitutionValues.has(semantic)) throw new Error('receipt has duplicate substitution');
    substitutionValues.add(semantic);
  }
  const ids = new Set<string>();
  for (const asset of receipt.assets) {
    exactFailureObject(
      asset,
      ['fillCache', 'fillTransport', 'id', 'member', 'memberSha256', 'memberSize', 'source'],
      [],
      'receipt asset',
    );
    if (ids.has(asset.id)) throw new Error(`receipt has duplicate asset id ${asset.id}`);
    ids.add(asset.id);
    exactFailureObject(asset.source, ['integrity', 'name', 'version'], [], 'receipt asset source');
    if (
      typeof asset.id !== 'string' ||
      typeof asset.member !== 'string' ||
      typeof asset.source.name !== 'string' ||
      typeof asset.source.version !== 'string' ||
      parseCanonicalShadowIntegrity(asset.source.integrity) === null ||
      !SHA256.test(asset.memberSha256) ||
      !Number.isSafeInteger(asset.memberSize) ||
      asset.memberSize <= 0 ||
      (asset.fillTransport !== 'standard' && asset.fillTransport !== 'eddy') ||
      !['tarball', 'network', 'bundle'].includes(asset.fillCache) ||
      (asset.fillTransport === 'standard' && asset.fillCache === 'bundle') ||
      (asset.fillTransport === 'eddy' && asset.fillCache !== 'bundle')
    ) {
      throw new Error(`receipt has invalid member facts for ${asset.id}`);
    }
    assertNormalizedMember(asset.member);
  }
  return freezeDeep(receipt) as ShadowAssetReadyReceipt;
}

const STORAGE_CLASSES = new Set<ShadowAssetStorageClass>([
  'opfs-persisted',
  'opfs-best-effort',
  'memory-session',
]);

interface ObjectProvenance {
  readonly descriptor: ShadowAssetDescriptor;
  readonly fillTransport: 'standard' | 'eddy';
  readonly fillCache: 'tarball' | 'network' | 'bundle';
}

type ObjectProgressPhase = 'fetch' | 'verify' | 'persist';

class ObjectAcquisitionFailure extends Error {
  readonly phase: ObjectProgressPhase;
  override readonly cause: unknown;

  constructor(phase: ObjectProgressPhase, cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
    this.name = 'ObjectAcquisitionFailure';
    this.phase = phase;
    this.cause = cause;
  }
}

interface ObjectBatch {
  readonly controller: AbortController;
  readonly flights: ReadonlySet<ObjectFlight>;
}

interface ObjectFlight {
  readonly descriptor: ShadowAssetDescriptor;
  readonly gate: Deferred<ObjectProvenance>;
  readonly promise: Promise<ObjectProvenance>;
  readonly observers: Set<(phase: ObjectProgressPhase) => void>;
  readonly history: ObjectProgressPhase[];
  readonly consumers: Set<symbol>;
  batch: ObjectBatch | null;
  settled: boolean;
}

interface EnsureFlight {
  readonly promise: Promise<ShadowAssetEnsureResult>;
  readonly observers: Set<(progress: ShadowAssetProgress) => void>;
  readonly controller: AbortController;
  waiters: number;
  settled: boolean;
}

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  void promise.catch(() => undefined);
  return { promise, resolve, reject };
}

function requestKey(request: ShadowAssetSourceRequest): string {
  return canonicalShadowJson(request);
}

function descriptorRequest(descriptor: ShadowAssetDescriptor): ShadowAssetSourceRequest {
  return {
    name: descriptor.source.name,
    version: descriptor.source.version,
    integrity: descriptor.source.integrity,
    maxTarballBytes: descriptor.maxTarballBytes,
  };
}

function objectFlightKey(descriptor: ShadowAssetDescriptor): string {
  return canonicalShadowJson({
    source: descriptor.source,
    member: descriptor.member,
    memberSha256: descriptor.memberSha256,
    memberSize: descriptor.memberSize,
    maxTarballBytes: descriptor.maxTarballBytes,
    maxUnpackedBytes: descriptor.maxUnpackedBytes,
  });
}

function sameRequest(left: ShadowAssetSourceRequest, right: ShadowAssetSourceRequest): boolean {
  return requestKey(left) === requestKey(right);
}

function assertSourceResult(
  result: ShadowAssetSourceResult,
  expected: ShadowAssetSourceRequest,
): void {
  exactFailureObject(
    result,
    ['bytes', 'fillCache', 'fillTransport', 'request'],
    [],
    'ShadowAssetSourceResult',
  );
  exactFailureObject(
    result.request,
    ['integrity', 'maxTarballBytes', 'name', 'version'],
    [],
    'ShadowAssetSourceResult.request',
  );
  if (!sameRequest(result.request, expected))
    throw new Error('shadow asset source result mismatch');
  if (!(result.bytes instanceof Uint8Array))
    throw new TypeError('source result bytes must be Uint8Array');
  if (result.bytes.byteLength > expected.maxTarballBytes) {
    throw new Error(`shadow asset source result exceeded ${expected.maxTarballBytes} bytes`);
  }
  if (result.fillTransport !== 'standard' && result.fillTransport !== 'eddy') {
    throw new TypeError('invalid shadow asset source transport');
  }
  if (!['tarball', 'network', 'bundle'].includes(result.fillCache)) {
    throw new TypeError('invalid shadow asset source cache fact');
  }
  if (result.fillTransport === 'standard' && result.fillCache === 'bundle') {
    throw new TypeError('standard source cannot claim bundle fill');
  }
  if (result.fillTransport === 'eddy' && result.fillCache !== 'bundle') {
    throw new TypeError('eddy source must claim bundle fill');
  }
}

const managerShadowFailures = new WeakSet<ShadowAssetError>();

function managerShadowError(failure: ShadowAssetFailure): ShadowAssetError {
  const error = new ShadowAssetError(failure);
  managerShadowFailures.add(error);
  return error;
}

function shadowFailure(
  plan: ShadowAssetPlan,
  phase: ShadowAssetFailurePhase,
  cause: unknown,
  assetId?: string,
): ShadowAssetError {
  if (cause instanceof ShadowAssetError && managerShadowFailures.has(cause)) {
    if (cause.requiredSetDigest === plan.requiredSetDigest) return cause;
    return managerShadowError({
      message: cause.message,
      requiredSetDigest: plan.requiredSetDigest,
      ...(cause.assetId === undefined ? {} : { assetId: cause.assetId }),
      phase: cause.phase,
      transports: cause.transports,
      recovery: cause.recovery,
      ...(cause.usedBytes === undefined ? {} : { usedBytes: cause.usedBytes }),
      ...(cause.requiredBytes === undefined ? {} : { requiredBytes: cause.requiredBytes }),
      cause: cause.cause,
    });
  }
  const message = cause instanceof Error ? cause.message : String(cause);
  const quota =
    cause !== null && typeof cause === 'object'
      ? (cause as { code?: unknown; usedBytes?: unknown; requiredBytes?: unknown })
      : {};
  const isQuota = quota.code === 'EDQUOT';
  const usedBytes = Number.isSafeInteger(quota.usedBytes) ? (quota.usedBytes as number) : undefined;
  const requiredBytes = Number.isSafeInteger(quota.requiredBytes)
    ? (quota.requiredBytes as number)
    : undefined;
  return managerShadowError({
    message,
    requiredSetDigest: plan.requiredSetDigest,
    ...(assetId === undefined ? {} : { assetId }),
    phase,
    transports: phase === 'fetch' ? [{ transport: 'standard' as const, message }] : [],
    recovery: isQuota || phase === 'persist' ? 'clear-and-retry' : 'retry',
    ...(usedBytes === undefined ? {} : { usedBytes }),
    ...(requiredBytes === undefined ? {} : { requiredBytes }),
    cause,
  });
}

function storeFailure(
  phase: ShadowAssetStoreFailure['phase'],
  cause: unknown,
): ShadowAssetStoreError {
  if (cause instanceof ShadowAssetStoreError && cause.phase === phase) return cause;
  const message = cause instanceof Error ? cause.message : String(cause);
  const details =
    cause !== null && typeof cause === 'object'
      ? (cause as { code?: unknown; usedBytes?: unknown; requiredBytes?: unknown })
      : {};
  const usedBytes = Number.isSafeInteger(details.usedBytes)
    ? (details.usedBytes as number)
    : undefined;
  const requiredBytes = Number.isSafeInteger(details.requiredBytes)
    ? (details.requiredBytes as number)
    : undefined;
  return new ShadowAssetStoreError({
    message,
    phase,
    recovery: details.code === 'EDQUOT' || phase === 'clear' ? 'clear-and-retry' : 'retry',
    ...(usedBytes === undefined ? {} : { usedBytes }),
    ...(requiredBytes === undefined ? {} : { requiredBytes }),
    cause,
  });
}

function abortError(): Error {
  return new DOMException('The operation was aborted', 'AbortError');
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortError();
}

async function waitWithSignal<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return await promise;
  if (signal.aborted) throw abortError();
  let onAbort!: () => void;
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(abortError());
    signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    return await Promise.race([promise, aborted]);
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}

class ShadowAssetManagerImpl implements ShadowAssetManager {
  readonly installer: ShadowAssetInstaller;
  readonly admin: ShadowAssetAdmin;
  readonly #storage: ShadowAssetStorage;
  readonly #source: ShadowAssetSource;
  readonly #setFlights = new Map<string, EnsureFlight>();
  readonly #objectFlights = new Map<string, ObjectFlight>();
  readonly #activeObjectBatches = new Set<Promise<void>>();
  readonly #objectPublications = new Map<string, Promise<void>>();
  readonly #unacknowledgedReadySets = new Set<string>();
  readonly #activeReads = new Set<Promise<unknown>>();
  readonly #activeInspects = new Set<Promise<unknown>>();
  #state: 'open' | 'clearing' | 'closing' | 'closed' = 'open';
  #tempSequence = 0;
  #clearPromise: Promise<ShadowAssetUsage> | null = null;
  #closePromise: Promise<void> | null = null;

  constructor(options: Readonly<{ storage: ShadowAssetStorage; source: ShadowAssetSource }>) {
    exactFailureObject(options, ['source', 'storage'], [], 'createShadowAssetManager options');
    if (!STORAGE_CLASSES.has(options.storage.storageClass)) {
      throw new TypeError('shadow asset storage has invalid storageClass');
    }
    this.#storage = options.storage;
    this.#source = options.source;
    this.installer = Object.freeze({
      ensure: (plan: ShadowAssetPlan, ensureOptions?: ShadowAssetEnsureOptions) =>
        this.#ensure(plan, ensureOptions),
      inspectReceipt: (requiredSetDigest: string) => this.#inspectReceiptPublic(requiredSetDigest),
    });
    this.admin = Object.freeze({
      inspectUsage: () => this.#inspectUsagePublic(),
      clearCache: () => this.#clearCache(),
    });
  }

  #assertOpen(phase: ShadowAssetStoreFailure['phase'] = 'inspect'): void {
    if (this.#state === 'open') return;
    throw new ShadowAssetStoreError({
      message: `shadow asset manager is ${this.#state}`,
      phase,
      recovery: this.#state === 'clearing' ? 'retry' : 'none',
    });
  }

  #emitProgress(
    observers: ReadonlySet<(progress: ShadowAssetProgress) => void>,
    progress: ShadowAssetProgress,
  ): void {
    for (const sink of observers) {
      try {
        sink(progress);
      } catch (error) {
        console.warn(
          `shadow asset progress observer threw: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  #retainSetFlight(flight: EnsureFlight): void {
    flight.waiters += 1;
  }

  #releaseSetFlight(flight: EnsureFlight): void {
    flight.waiters -= 1;
    if (flight.waiters === 0 && !flight.settled) flight.controller.abort();
  }

  #createObjectFlight(descriptor: ShadowAssetDescriptor): ObjectFlight {
    const gate = deferred<ObjectProvenance>();
    const flight: ObjectFlight = {
      descriptor,
      gate,
      promise: gate.promise,
      observers: new Set(),
      history: [],
      consumers: new Set(),
      batch: null,
      settled: false,
    };
    this.#objectFlights.set(objectFlightKey(descriptor), flight);
    return flight;
  }

  #emitObjectProgress(flight: ObjectFlight, phase: ObjectProgressPhase): void {
    if (flight.history.at(-1) === phase) return;
    flight.history.push(phase);
    for (const observer of flight.observers) observer(phase);
  }

  #observeObjectFlight(
    flight: ObjectFlight,
    observer: (phase: ObjectProgressPhase) => void,
  ): () => void {
    for (const phase of flight.history) observer(phase);
    if (!flight.settled) flight.observers.add(observer);
    return () => flight.observers.delete(observer);
  }

  #retainObjectFlight(flight: ObjectFlight, consumer: symbol): void {
    flight.consumers.add(consumer);
  }

  #releaseObjectFlight(flight: ObjectFlight, consumer: symbol): void {
    flight.consumers.delete(consumer);
    const batch = flight.batch;
    if (!batch && !flight.settled) {
      if (flight.consumers.size > 0) this.#startObjectBatch([flight]);
      else {
        this.#settleObjectFlight(flight, {
          kind: 'failure',
          failure: new ObjectAcquisitionFailure('fetch', abortError()),
        });
      }
      return;
    }
    if (
      batch &&
      !batch.controller.signal.aborted &&
      [...batch.flights].every((candidate) => candidate.consumers.size === 0)
    ) {
      for (const candidate of batch.flights) {
        const key = objectFlightKey(candidate.descriptor);
        if (this.#objectFlights.get(key) === candidate) this.#objectFlights.delete(key);
      }
      batch.controller.abort();
    }
    const key = objectFlightKey(flight.descriptor);
    if (flight.settled && flight.consumers.size === 0 && this.#objectFlights.get(key) === flight) {
      this.#objectFlights.delete(key);
    }
  }

  #settleObjectFlight(
    flight: ObjectFlight,
    result:
      | Readonly<{ kind: 'ready'; value: ObjectProvenance }>
      | Readonly<{ kind: 'failure'; failure: ObjectAcquisitionFailure }>,
  ): void {
    if (flight.settled) return;
    flight.settled = true;
    flight.observers.clear();
    if (result.kind === 'ready') flight.gate.resolve(result.value);
    else flight.gate.reject(result.failure);
    if (
      flight.consumers.size === 0 &&
      this.#objectFlights.get(objectFlightKey(flight.descriptor)) === flight
    ) {
      this.#objectFlights.delete(objectFlightKey(flight.descriptor));
    }
  }

  #trackOperation<T>(active: Set<Promise<unknown>>, operation: Promise<T>): Promise<T> {
    const tracked = operation.finally(() => {
      active.delete(tracked);
    });
    void tracked.catch(() => undefined);
    active.add(tracked);
    return tracked;
  }

  async #ensure(
    inputPlan: ShadowAssetPlan,
    options: ShadowAssetEnsureOptions = {},
  ): Promise<ShadowAssetEnsureResult> {
    this.#assertOpen();
    exactFailureObject(options, [], ['onProgress', 'signal'], 'ShadowAssetEnsureOptions');
    if (options.signal !== undefined && !(options.signal instanceof AbortSignal)) {
      throw new TypeError('ShadowAssetEnsureOptions.signal must be AbortSignal');
    }
    if (options.onProgress !== undefined && typeof options.onProgress !== 'function') {
      throw new TypeError('ShadowAssetEnsureOptions.onProgress must be a function');
    }
    const plan = snapshotShadowAssetPlan(inputPlan);
    if (options.signal?.aborted) throw abortError();
    if (plan.assets.length === 0) return Object.freeze({ kind: 'not-required', plan });

    let flight = this.#setFlights.get(plan.requiredSetDigest);
    const observer = options.onProgress;
    if (!flight) {
      const observers = new Set<(progress: ShadowAssetProgress) => void>();
      if (observer) observers.add(observer);
      const controller = new AbortController();
      const createdRef: { value?: EnsureFlight } = {};
      const promise = this.#ensureSet(
        plan,
        (progress) => this.#emitProgress(observers, progress),
        controller.signal,
      ).finally(() => {
        const created = createdRef.value;
        if (!created) return;
        created.settled = true;
        if (this.#setFlights.get(plan.requiredSetDigest) === created) {
          this.#setFlights.delete(plan.requiredSetDigest);
        }
        observers.clear();
      });
      void promise.catch(() => undefined);
      const created: EnsureFlight = {
        promise,
        observers,
        controller,
        waiters: 0,
        settled: false,
      };
      createdRef.value = created;
      flight = created;
      this.#setFlights.set(plan.requiredSetDigest, flight);
    } else if (observer) {
      flight.observers.add(observer);
    }
    this.#retainSetFlight(flight);
    try {
      return await waitWithSignal(flight.promise, options.signal);
    } finally {
      if (observer) flight.observers.delete(observer);
      this.#releaseSetFlight(flight);
    }
  }

  async #ensureSet(
    plan: ShadowAssetPlan,
    emit: (progress: ShadowAssetProgress) => void,
    signal: AbortSignal,
  ): Promise<ShadowAssetEnsureResult> {
    throwIfAborted(signal);
    for (let index = 0; index < plan.assets.length; index += 1) {
      throwIfAborted(signal);
      const asset = plan.assets[index]!;
      emit({
        phase: 'cache-check',
        assetId: asset.id,
        assetIndex: index,
        assetCount: plan.assets.length,
      });
    }
    const verifiedReceiptAssets = new Set<number>();
    const hit = await waitWithSignal(
      this.#lookupReceipt(plan.requiredSetDigest, plan, (asset, index) => {
        throwIfAborted(signal);
        verifiedReceiptAssets.add(index);
        if (asset.id !== plan.assets[index]?.id) {
          throw new Error('verified receipt asset order does not match its exact plan');
        }
      }).catch(() => null),
      signal,
    );
    if (hit) {
      for (let index = 0; index < plan.assets.length; index += 1) {
        const asset = plan.assets[index]!;
        if (!verifiedReceiptAssets.has(index)) {
          throw shadowFailure(
            plan,
            'verify',
            new Error(`ready receipt omitted object verification for ${asset.id}`),
            asset.id,
          );
        }
        emit({
          phase: 'verify',
          assetId: asset.id,
          assetIndex: index,
          assetCount: plan.assets.length,
        });
      }
      emit({
        phase: 'ready',
        requiredSetDigest: plan.requiredSetDigest,
        assetCount: plan.assets.length,
        storageClass: this.#storage.storageClass,
      });
      return freezeDeep({ kind: 'ready', plan, receipt: hit }) as ShadowAssetEnsureResult;
    }

    const provenance = new Map<string, ObjectProvenance>();
    const joins: Promise<void>[] = [];
    const newFlights: ObjectFlight[] = [];
    const retained = new Set<ObjectFlight>();
    const unsubscribe: Array<() => void> = [];
    const consumer = Symbol(plan.requiredSetDigest);
    let released = false;
    const releaseRetained = (): void => {
      if (released) return;
      released = true;
      for (const stop of unsubscribe) stop();
      for (const objectFlight of retained) this.#releaseObjectFlight(objectFlight, consumer);
    };
    signal.addEventListener('abort', releaseRetained, { once: true });
    try {
      for (let index = 0; index < plan.assets.length; index += 1) {
        throwIfAborted(signal);
        const descriptor = plan.assets[index]!;
        const existingObject = await waitWithSignal(
          this.#readVerifiedObject(descriptor).catch(() => null),
          signal,
        );
        if (existingObject) {
          const prior = await waitWithSignal(
            this.#findObjectProvenance(descriptor).catch(() => null),
            signal,
          );
          if (prior) {
            provenance.set(descriptor.id, prior);
            emit({
              phase: 'verify',
              assetId: descriptor.id,
              assetIndex: index,
              assetCount: plan.assets.length,
            });
            continue;
          }
        }
        let objectFlight = this.#objectFlights.get(objectFlightKey(descriptor));
        if (!objectFlight) {
          objectFlight = this.#createObjectFlight(descriptor);
          newFlights.push(objectFlight);
        }
        if (!retained.has(objectFlight)) {
          retained.add(objectFlight);
          this.#retainObjectFlight(objectFlight, consumer);
        }
        unsubscribe.push(
          this.#observeObjectFlight(objectFlight, (phase) => {
            emit({
              phase,
              assetId: descriptor.id,
              assetIndex: index,
              assetCount: plan.assets.length,
            });
          }),
        );
        joins.push(
          objectFlight.promise
            .then((value) => {
              if (objectFlightKey(descriptor) !== objectFlightKey(objectFlight.descriptor)) {
                throw new ObjectAcquisitionFailure(
                  'verify',
                  new Error(`shared object extraction contract drifted for ${descriptor.id}`),
                );
              }
              provenance.set(descriptor.id, {
                descriptor,
                fillTransport: value.fillTransport,
                fillCache: value.fillCache,
              });
            })
            .catch((error) => {
              if (error instanceof ObjectAcquisitionFailure) {
                throw shadowFailure(plan, error.phase, error.cause, descriptor.id);
              }
              throw shadowFailure(plan, 'fetch', error, descriptor.id);
            }),
        );
      }

      if (newFlights.length > 0) this.#startObjectBatch(newFlights);
      try {
        await waitWithSignal(Promise.all(joins), signal);
      } catch (error) {
        if (signal.aborted) throw abortError();
        throw shadowFailure(plan, 'fetch', error);
      }
      throwIfAborted(signal);
      const receipt = await this.#publishReceipt(plan, provenance, signal).catch((error) => {
        if (signal.aborted && error instanceof DOMException && error.name === 'AbortError') {
          throw error;
        }
        throw shadowFailure(plan, 'persist', error);
      });
      emit({
        phase: 'ready',
        requiredSetDigest: plan.requiredSetDigest,
        assetCount: plan.assets.length,
        storageClass: this.#storage.storageClass,
      });
      return freezeDeep({ kind: 'ready', plan, receipt }) as ShadowAssetEnsureResult;
    } finally {
      signal.removeEventListener('abort', releaseRetained);
      releaseRetained();
    }
  }

  #startObjectBatch(flights: readonly ObjectFlight[]): void {
    const pending = flights.filter((flight) => flight.batch === null && !flight.settled);
    if (pending.length === 0) return;
    const batch: ObjectBatch = {
      controller: new AbortController(),
      flights: new Set(pending),
    };
    for (const flight of pending) flight.batch = batch;
    const operation = this.#runObjectBatch(batch)
      .catch((error) => {
        for (const flight of batch.flights) {
          this.#settleObjectFlight(flight, {
            kind: 'failure',
            failure: new ObjectAcquisitionFailure('fetch', error),
          });
        }
      })
      .finally(() => {
        this.#activeObjectBatches.delete(operation);
      });
    void operation.catch(() => undefined);
    this.#activeObjectBatches.add(operation);
  }

  async #runObjectBatch(batch: ObjectBatch): Promise<void> {
    const requestMap = new Map<string, ShadowAssetSourceRequest>();
    for (const flight of batch.flights) {
      const request = descriptorRequest(flight.descriptor);
      requestMap.set(requestKey(request), request);
      this.#emitObjectProgress(flight, 'fetch');
    }
    const requests = [...requestMap.entries()]
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([, request]) => Object.freeze(request));
    try {
      throwIfAborted(batch.controller.signal);
      const results = await this.#source.acquire(requests, {
        signal: batch.controller.signal,
      });
      throwIfAborted(batch.controller.signal);
      if (!Array.isArray(results)) throw new TypeError('shadow asset source must return an array');
      const resultsByRequest = new Map<string, ShadowAssetSourceResult>();
      for (const result of results) {
        const key = requestKey(result.request);
        const expected = requestMap.get(key);
        if (!expected) throw new Error('shadow asset source returned an extra result');
        if (resultsByRequest.has(key)) {
          throw new Error('shadow asset source returned a duplicate result');
        }
        assertSourceResult(result, expected);
        resultsByRequest.set(key, result);
      }
      if (resultsByRequest.size !== requests.length) {
        throw new Error('shadow asset source omitted a required result');
      }

      for (const flight of batch.flights) {
        if (flight.settled) continue;
        let phase: ObjectProgressPhase = 'fetch';
        try {
          throwIfAborted(batch.controller.signal);
          const descriptor = flight.descriptor;
          const sourceResult = resultsByRequest.get(requestKey(descriptorRequest(descriptor)));
          if (!sourceResult) throw new Error('shadow asset source result disappeared');
          phase = 'verify';
          this.#emitObjectProgress(flight, phase);
          const bytes = await extractVerifiedMember(descriptor, sourceResult.bytes.slice());
          throwIfAborted(batch.controller.signal);
          phase = 'persist';
          this.#emitObjectProgress(flight, phase);
          await this.#publishObject(descriptor, bytes);
          throwIfAborted(batch.controller.signal);
          this.#settleObjectFlight(flight, {
            kind: 'ready',
            value: Object.freeze({
              descriptor,
              fillTransport: sourceResult.fillTransport,
              fillCache: sourceResult.fillCache,
            }),
          });
        } catch (error) {
          this.#settleObjectFlight(flight, {
            kind: 'failure',
            failure: new ObjectAcquisitionFailure(phase, error),
          });
        }
      }
    } catch (error) {
      for (const flight of batch.flights) {
        this.#settleObjectFlight(flight, {
          kind: 'failure',
          failure: new ObjectAcquisitionFailure('fetch', error),
        });
      }
    }
  }

  async #publishObject(descriptor: ShadowAssetDescriptor, bytes: Uint8Array): Promise<void> {
    const key = descriptor.memberSha256;
    const existing = this.#objectPublications.get(key);
    if (existing) {
      await existing;
      const readBack = await this.#readVerifiedObject(descriptor);
      if (!readBack) {
        throw new Error(`shadow asset object read-back failed for ${descriptor.id}`);
      }
      return;
    }
    const publication = this.#publishObjectOnce(descriptor, bytes).finally(() => {
      if (this.#objectPublications.get(key) === publication) {
        this.#objectPublications.delete(key);
      }
    });
    void publication.catch(() => undefined);
    this.#objectPublications.set(key, publication);
    await publication;
  }

  async #publishObjectOnce(descriptor: ShadowAssetDescriptor, bytes: Uint8Array): Promise<void> {
    const existing = await this.#readVerifiedObject(descriptor);
    if (existing) return;
    const id = `${descriptor.memberSha256}.${this.#tempSequence++}`;
    const temp = { kind: 'temp' as const, id };
    const object = { kind: 'object' as const, sha256: descriptor.memberSha256 };
    await this.#storage.write(temp, bytes);
    await this.#storage.write(object, bytes);
    const readBack = await this.#storage.read(object);
    if (
      readBack === null ||
      readBack.byteLength !== descriptor.memberSize ||
      sha256Hex(readBack) !== descriptor.memberSha256
    ) {
      throw new Error(`shadow asset object read-back failed for ${descriptor.id}`);
    }
    await this.#storage.remove(temp);
  }

  async #publishReceipt(
    plan: ShadowAssetPlan,
    provenance: ReadonlyMap<string, ObjectProvenance>,
    signal: AbortSignal,
  ): Promise<ShadowAssetReadyReceipt> {
    throwIfAborted(signal);
    const firstSubstitution = plan.substitutions[0];
    if (!firstSubstitution) throw new Error('non-empty shadow asset plan has no substitution');
    for (const substitution of plan.substitutions) {
      if (
        substitution.catalog.id !== firstSubstitution.catalog.id ||
        substitution.catalog.digest !== firstSubstitution.catalog.digest
      ) {
        throw new Error('shadow asset plan spans multiple catalogs');
      }
    }
    const payload = {
      schema: 1 as const,
      requiredSetDigest: plan.requiredSetDigest,
      catalog: { ...firstSubstitution.catalog },
      storageClass: this.#storage.storageClass,
      substitutions: plan.substitutions,
      assets: plan.assets.map((descriptor) => {
        const fact = provenance.get(descriptor.id);
        if (!fact) throw new Error(`missing fill provenance for ${descriptor.id}`);
        return {
          id: descriptor.id,
          source: { ...descriptor.source },
          member: descriptor.member,
          memberSha256: descriptor.memberSha256,
          memberSize: descriptor.memberSize,
          fillTransport: fact.fillTransport,
          fillCache: fact.fillCache,
        };
      }),
    };
    const receipt: ShadowAssetReadyReceipt = {
      ...payload,
      receiptSha256: canonicalShadowDigest(payload),
    };
    const receiptBytes = jsonEncoder.encode(canonicalShadowJson(payload));
    await this.#storage.write({ kind: 'receipt', sha256: receipt.receiptSha256 }, receiptBytes);
    throwIfAborted(signal);
    const pointer: StoredReadyPointer = {
      schema: 1,
      requiredSetDigest: plan.requiredSetDigest,
      receiptSha256: receipt.receiptSha256,
    };
    const readyEntry = { kind: 'ready' as const, requiredSetDigest: plan.requiredSetDigest };
    this.#unacknowledgedReadySets.add(plan.requiredSetDigest);
    try {
      await this.#storage.write(readyEntry, jsonEncoder.encode(canonicalShadowJson(pointer)));
      throwIfAborted(signal);
    } catch (error) {
      try {
        await this.#storage.remove(readyEntry);
        this.#unacknowledgedReadySets.delete(plan.requiredSetDigest);
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          'shadow asset ready publication and quarantine cleanup failed',
        );
      }
      throw error;
    }
    this.#unacknowledgedReadySets.delete(plan.requiredSetDigest);
    return freezeDeep(receipt) as ShadowAssetReadyReceipt;
  }

  async #readVerifiedObject(
    descriptor: Pick<ShadowAssetDescriptor, 'id' | 'memberSha256' | 'memberSize'>,
  ): Promise<Uint8Array | null> {
    const bytes = await this.#storage.read({ kind: 'object', sha256: descriptor.memberSha256 });
    if (bytes === null) return null;
    if (
      bytes.byteLength !== descriptor.memberSize ||
      sha256Hex(bytes) !== descriptor.memberSha256
    ) {
      return null;
    }
    return bytes.slice();
  }

  async #findObjectProvenance(descriptor: ShadowAssetDescriptor): Promise<ObjectProvenance | null> {
    const snapshot = await this.#storage.inspect();
    for (const item of snapshot.entries) {
      if (item.entry.kind !== 'receipt') continue;
      const bytes = await this.#storage.read(item.entry);
      if (!bytes) continue;
      let receipt: ShadowAssetReadyReceipt;
      try {
        receipt = decodeReceipt(bytes, item.entry.sha256);
      } catch {
        continue;
      }
      const asset = receipt.assets.find(
        (candidate) =>
          candidate.id === descriptor.id &&
          candidate.member === descriptor.member &&
          candidate.memberSha256 === descriptor.memberSha256 &&
          candidate.memberSize === descriptor.memberSize &&
          canonicalShadowJson(candidate.source) === canonicalShadowJson(descriptor.source),
      );
      if (asset) {
        return Object.freeze({
          descriptor,
          fillTransport: asset.fillTransport,
          fillCache: asset.fillCache,
        });
      }
    }
    return null;
  }

  async #lookupReceipt(
    requiredSetDigest: string,
    expectedPlan?: ShadowAssetPlan,
    onVerifiedAsset?: (asset: ShadowAssetReadyReceipt['assets'][number], index: number) => void,
  ): Promise<ShadowAssetReadyReceipt | null> {
    if (!SHA256.test(requiredSetDigest)) throw new TypeError('invalid requiredSetDigest');
    if (this.#unacknowledgedReadySets.has(requiredSetDigest)) return null;
    const pointerBytes = await this.#storage.read({ kind: 'ready', requiredSetDigest });
    if (!pointerBytes) return null;
    const pointer = decodeReadyPointer(pointerBytes);
    if (pointer.requiredSetDigest !== requiredSetDigest) return null;
    const receiptBytes = await this.#storage.read({
      kind: 'receipt',
      sha256: pointer.receiptSha256,
    });
    if (!receiptBytes) return null;
    const receipt = decodeReceipt(receiptBytes, pointer.receiptSha256);
    if (
      receipt.receiptSha256 !== pointer.receiptSha256 ||
      receipt.requiredSetDigest !== requiredSetDigest ||
      receipt.storageClass !== this.#storage.storageClass
    ) {
      return null;
    }
    if (expectedPlan && !receiptMatchesPlan(receipt, expectedPlan)) return null;
    for (let index = 0; index < receipt.assets.length; index += 1) {
      const asset = receipt.assets[index]!;
      if ((await this.#readVerifiedObject(asset)) === null) return null;
      onVerifiedAsset?.(asset, index);
    }
    return receipt;
  }

  async #inspectReceiptPublic(requiredSetDigest: string): Promise<ShadowAssetReadyReceipt | null> {
    this.#assertOpen();
    if (!SHA256.test(requiredSetDigest)) throw new TypeError('invalid requiredSetDigest');
    return await this.#trackOperation(
      this.#activeInspects,
      this.#lookupReceipt(requiredSetDigest).catch(() => null),
    );
  }

  runtimeReader(inputPlan: ShadowAssetPlan): ShadowAssetRuntimeReader {
    this.#assertOpen();
    const plan = snapshotShadowAssetPlan(inputPlan);
    const byId = new Map(plan.assets.map((asset) => [asset.id, asset]));
    return Object.freeze({
      readVerified: (assetId: string, options?: ShadowAssetReadOptions) =>
        this.#trackOperation(this.#activeReads, this.#readRuntime(plan, byId, assetId, options)),
    });
  }

  async #readRuntime(
    plan: ShadowAssetPlan,
    byId: ReadonlyMap<string, ShadowAssetDescriptor>,
    assetId: string,
    options: ShadowAssetReadOptions = {},
  ): Promise<Uint8Array> {
    this.#assertOpen();
    exactFailureObject(
      options,
      [],
      ['deadlineMs', 'onProgress', 'signal'],
      'ShadowAssetReadOptions',
    );
    if (options.signal !== undefined && !(options.signal instanceof AbortSignal)) {
      throw new TypeError('ShadowAssetReadOptions.signal must be AbortSignal');
    }
    if (options.onProgress !== undefined && typeof options.onProgress !== 'function') {
      throw new TypeError('ShadowAssetReadOptions.onProgress must be a function');
    }
    const deadlineMs = options.deadlineMs ?? SHADOW_ASSET_MAX_READ_DEADLINE_MS;
    assertDeadline(deadlineMs);
    const descriptor = byId.get(assetId);
    if (!descriptor) {
      throw new ShadowAssetReadError({
        message: `unknown shadow asset ${assetId}`,
        assetId,
        reason: 'unknown-asset',
      });
    }
    const admission: {
      set: EnsureFlight | null;
      object: ObjectFlight | null;
      objectConsumer: symbol | null;
      stopObjectObserver: (() => void) | null;
    } = { set: null, object: null, objectConsumer: null, stopObjectObserver: null };
    const retainCurrentSet = (): EnsureFlight | null => {
      const flight = this.#setFlights.get(plan.requiredSetDigest) ?? null;
      if (flight && admission.set !== flight) {
        this.#retainSetFlight(flight);
        if (options.onProgress) flight.observers.add(options.onProgress);
        admission.set = flight;
      }
      return flight;
    };
    retainCurrentSet();
    try {
      const operation = (async (): Promise<Uint8Array> => {
        const local = await this.#readVerifiedObject(descriptor);
        if (local) return local;
        const setFlight = retainCurrentSet();
        if (setFlight) {
          try {
            await setFlight.promise;
          } catch (error) {
            throw shadowFailure(plan, 'fetch', error, assetId);
          }
        } else {
          const objectFlight = this.#objectFlights.get(objectFlightKey(descriptor));
          if (!objectFlight) {
            throw managerShadowError({
              message: `verified shadow asset ${assetId} is unavailable; retry ensure`,
              requiredSetDigest: plan.requiredSetDigest,
              assetId,
              phase: 'cache-check',
              transports: [],
              recovery: 'retry',
            });
          }
          admission.object = objectFlight;
          admission.objectConsumer = Symbol(`runtime:${plan.requiredSetDigest}:${assetId}`);
          this.#retainObjectFlight(objectFlight, admission.objectConsumer);
          if (options.onProgress) {
            const index = plan.assets.findIndex((asset) => asset.id === assetId);
            admission.stopObjectObserver = this.#observeObjectFlight(objectFlight, (phase) => {
              this.#emitProgress(new Set([options.onProgress!]), {
                phase,
                assetId,
                assetIndex: index,
                assetCount: plan.assets.length,
              });
            });
          }
          try {
            await objectFlight.promise;
          } catch (error) {
            if (error instanceof ObjectAcquisitionFailure) {
              throw shadowFailure(plan, error.phase, error.cause, assetId);
            }
            throw shadowFailure(plan, 'fetch', error, assetId);
          }
        }
        const ready = await this.#readVerifiedObject(descriptor);
        if (!ready) {
          throw managerShadowError({
            message: `verified shadow asset ${assetId} is unavailable after acquisition`,
            requiredSetDigest: plan.requiredSetDigest,
            assetId,
            phase: 'verify',
            transports: [],
            recovery: 'clear-and-retry',
          });
        }
        return ready;
      })();
      void operation.catch(() => undefined);
      return await this.#readWithinDeadline(operation, assetId, deadlineMs, options.signal);
    } finally {
      if (admission.set) {
        if (options.onProgress) admission.set.observers.delete(options.onProgress);
        this.#releaseSetFlight(admission.set);
      }
      admission.stopObjectObserver?.();
      if (admission.object && admission.objectConsumer) {
        this.#releaseObjectFlight(admission.object, admission.objectConsumer);
      }
    }
  }

  async #readWithinDeadline(
    operation: Promise<Uint8Array>,
    assetId: string,
    deadlineMs: number,
    signal: AbortSignal | undefined,
  ): Promise<Uint8Array> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () =>
          reject(
            new ShadowAssetReadError({
              message: `shadow asset read deadline expired after ${deadlineMs}ms`,
              assetId,
              reason: 'deadline',
              deadlineMs,
            }),
          ),
        deadlineMs,
      );
    });
    try {
      return (await waitWithSignal(Promise.race([operation, deadline]), signal)).slice();
    } finally {
      clearTimeout(timer);
    }
  }

  async #inspectUsageNow(): Promise<ShadowAssetUsage> {
    const snapshot = await this.#storage.inspect();
    let verifiedObjectCount = 0;
    let verifiedObjectBytes = 0;
    let readySetCount = 0;
    for (const item of snapshot.entries) {
      if (item.entry.kind === 'object') {
        const bytes = await this.#storage.read(item.entry);
        if (bytes && sha256Hex(bytes) === item.entry.sha256) {
          verifiedObjectCount += 1;
          verifiedObjectBytes += bytes.byteLength;
        }
      } else if (item.entry.kind === 'ready') {
        const receipt = await this.#lookupReceipt(item.entry.requiredSetDigest).catch(() => null);
        if (receipt) readySetCount += 1;
      }
    }
    return Object.freeze({
      storageClass: this.#storage.storageClass,
      entryCount: snapshot.entryCount,
      storedBytes: snapshot.storedBytes,
      verifiedObjectCount,
      verifiedObjectBytes,
      readySetCount,
    });
  }

  #inspectUsagePublic(): Promise<ShadowAssetUsage> {
    if (this.#state === 'clearing' && this.#clearPromise) {
      return this.#trackOperation(
        this.#activeInspects,
        this.#clearPromise
          .catch(() => undefined)
          .then(() => this.#inspectUsageNow())
          .catch((error) => {
            throw storeFailure('inspect', error);
          }),
      );
    }
    this.#assertOpen('inspect');
    return this.#trackOperation(
      this.#activeInspects,
      this.#inspectUsageNow().catch((error) => {
        throw storeFailure('inspect', error);
      }),
    );
  }

  #clearCache(): Promise<ShadowAssetUsage> {
    if (this.#state !== 'open') {
      return Promise.reject(
        new ShadowAssetStoreError({
          message: `shadow asset manager cannot clear while ${this.#state}`,
          phase: 'clear',
          recovery: this.#state === 'clearing' ? 'retry' : 'none',
        }),
      );
    }
    this.#state = 'clearing';
    const promise = this.#runClear();
    this.#clearPromise = promise;
    return promise;
  }

  async #runClear(): Promise<ShadowAssetUsage> {
    try {
      await Promise.allSettled([
        ...[...this.#setFlights.values()].map((flight) => flight.promise),
        ...[...this.#objectFlights.values()].map((flight) => flight.promise),
        ...this.#activeObjectBatches,
        ...this.#objectPublications.values(),
        ...this.#activeReads,
        ...this.#activeInspects,
      ]);
      await this.#storage.clear();
      const usage = await this.#inspectUsageNow();
      if (usage.entryCount !== 0 || usage.storedBytes !== 0) {
        throw new Error('shadow asset storage clear acknowledgement was not empty');
      }
      this.#unacknowledgedReadySets.clear();
      return usage;
    } catch (error) {
      throw storeFailure('clear', error);
    } finally {
      if (this.#state === 'clearing') this.#state = 'open';
      this.#clearPromise = null;
    }
  }

  close(): Promise<void> {
    if (this.#closePromise) return this.#closePromise;
    const pendingClear = this.#clearPromise;
    this.#state = 'closing';
    const promise = this.#runClose(pendingClear);
    this.#closePromise = promise;
    return promise;
  }

  async #runClose(pendingClear: Promise<ShadowAssetUsage> | null): Promise<void> {
    if (pendingClear) await pendingClear.catch(() => undefined);
    await Promise.allSettled([
      ...[...this.#setFlights.values()].map((flight) => flight.promise),
      ...[...this.#objectFlights.values()].map((flight) => flight.promise),
      ...this.#activeObjectBatches,
      ...this.#objectPublications.values(),
      ...this.#activeReads,
      ...this.#activeInspects,
    ]);
    const failures: ShadowAssetStoreError[] = [];
    try {
      await this.#source.close();
    } catch (error) {
      failures.push(storeFailure('close', error));
    }
    try {
      await this.#storage.close();
    } catch (error) {
      failures.push(storeFailure('close', error));
    }
    this.#state = 'closed';
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1)
      throw new AggregateError(failures, 'shadow asset manager close failed');
  }
}

function receiptMatchesPlan(receipt: ShadowAssetReadyReceipt, plan: ShadowAssetPlan): boolean {
  if (receipt.requiredSetDigest !== plan.requiredSetDigest) return false;
  const first = plan.substitutions[0];
  if (
    !first ||
    receipt.catalog.id !== first.catalog.id ||
    receipt.catalog.digest !== first.catalog.digest ||
    canonicalShadowJson(receipt.substitutions) !== canonicalShadowJson(plan.substitutions)
  ) {
    return false;
  }
  const expectedAssets = plan.assets.map((asset) => ({
    id: asset.id,
    source: asset.source,
    member: asset.member,
    memberSha256: asset.memberSha256,
    memberSize: asset.memberSize,
  }));
  const actualAssets = receipt.assets.map((asset) => ({
    id: asset.id,
    source: asset.source,
    member: asset.member,
    memberSha256: asset.memberSha256,
    memberSize: asset.memberSize,
  }));
  return canonicalShadowJson(actualAssets) === canonicalShadowJson(expectedAssets);
}

/** Package-private authority check for a third-party installer result. */
export function validateShadowAssetReadyResult(
  expectedPlan: ShadowAssetPlan,
  value: ShadowAssetEnsureResult,
): Extract<ShadowAssetEnsureResult, { kind: 'ready' }> {
  const expected = snapshotShadowAssetPlan(expectedPlan);
  exactFailureObject(value, ['kind', 'plan', 'receipt'], [], 'ShadowAssetEnsureResult');
  if (value.kind !== 'ready') throw new TypeError('shadow asset installer did not return ready');
  const returned = snapshotShadowAssetPlan(value.plan);
  if (canonicalShadowJson(returned) !== canonicalShadowJson(expected)) {
    throw new TypeError('shadow asset installer returned a drifted plan');
  }
  exactFailureObject(
    value.receipt,
    [
      'assets',
      'catalog',
      'receiptSha256',
      'requiredSetDigest',
      'schema',
      'storageClass',
      'substitutions',
    ],
    [],
    'ShadowAssetReadyReceipt',
  );
  const { receiptSha256, ...payload } = value.receipt;
  if (typeof receiptSha256 !== 'string' || !SHA256.test(receiptSha256)) {
    throw new TypeError('shadow asset installer returned an invalid receipt digest');
  }
  let receipt: ShadowAssetReadyReceipt;
  try {
    receipt = decodeReceipt(jsonEncoder.encode(canonicalShadowJson(payload)), receiptSha256);
  } catch (error) {
    throw new TypeError('shadow asset installer returned an invalid receipt', { cause: error });
  }
  if (!receiptMatchesPlan(receipt, expected)) {
    throw new TypeError('shadow asset installer returned drifted receipt evidence');
  }
  return freezeDeep({ kind: 'ready', plan: expected, receipt }) as Extract<
    ShadowAssetEnsureResult,
    { kind: 'ready' }
  >;
}

export function createShadowAssetManager(
  options: Readonly<{
    storage: ShadowAssetStorage;
    source: ShadowAssetSource;
  }>,
): ShadowAssetManager {
  return new ShadowAssetManagerImpl(options);
}

class StandardShadowAssetSource implements ShadowAssetSource {
  readonly #registry: RegistryClient;
  readonly #tarballCache: TarballCache;
  #closed = false;

  constructor(options: Readonly<{ registry: RegistryClient; tarballCache: TarballCache }>) {
    exactFailureObject(options, ['registry', 'tarballCache'], [], 'standard shadow asset source');
    this.#registry = options.registry;
    this.#tarballCache = options.tarballCache;
  }

  async acquire(
    requests: readonly ShadowAssetSourceRequest[],
    options: Readonly<{ signal: AbortSignal }>,
  ): Promise<readonly ShadowAssetSourceResult[]> {
    if (this.#closed) throw new Error('standard shadow asset source is closed');
    if (!Array.isArray(requests)) throw new TypeError('source requests must be an array');
    exactFailureObject(options, ['signal'], [], 'standard source acquire options');
    if (!(options.signal instanceof AbortSignal)) throw new TypeError('source signal is invalid');
    if (options.signal.aborted) throw abortError();
    const seen = new Set<string>();
    let previous = '';
    for (const request of requests) {
      exactFailureObject(
        request,
        ['integrity', 'maxTarballBytes', 'name', 'version'],
        [],
        'ShadowAssetSourceRequest',
      );
      assertMessage(request.name, 'source request name');
      assertMessage(request.version, 'source request version');
      if (parseCanonicalShadowIntegrity(request.integrity) === null) {
        throw new TypeError('source request integrity is invalid');
      }
      if (!Number.isSafeInteger(request.maxTarballBytes) || request.maxTarballBytes <= 0) {
        throw new TypeError('source request maxTarballBytes is invalid');
      }
      const key = requestKey(request);
      if (seen.has(key)) throw new TypeError('source requests contain a duplicate');
      if (previous !== '' && previous > key) throw new TypeError('source requests are not sorted');
      seen.add(key);
      previous = key;
    }
    const results: ShadowAssetSourceResult[] = [];
    for (const request of requests) {
      if (options.signal.aborted) throw abortError();
      const cached = await this.#tarballCache.get(request.name, request.version, request.integrity);
      if (cached) {
        if (cached.byteLength > request.maxTarballBytes) {
          throw new Error(
            `Cached tarball for ${request.name}@${request.version} exceeded ${request.maxTarballBytes} bytes`,
          );
        }
        results.push(
          Object.freeze({
            request: Object.freeze({ ...request }),
            bytes: cached.slice(),
            fillTransport: 'standard' as const,
            fillCache: 'tarball' as const,
          }),
        );
        continue;
      }
      const packument = await this.#registry.getPackument(request.name);
      if (packument.name !== request.name) {
        throw new Error(
          `Registry packument name mismatch: expected ${request.name}, got ${packument.name}`,
        );
      }
      const manifest = packument.versions[request.version];
      if (!manifest) throw new Error(`Registry omitted ${request.name}@${request.version}`);
      if (manifest.name !== request.name || manifest.version !== request.version) {
        throw new Error(
          `Registry manifest identity mismatch for ${request.name}@${request.version}`,
        );
      }
      if (manifest.dist.integrity !== request.integrity) {
        throw new Error(
          `Registry integrity drift for ${request.name}@${request.version}: expected ${request.integrity}, got ${manifest.dist.integrity ?? '<missing>'}`,
        );
      }
      const fetched = await fetchAndUnpackToCache(
        {
          name: request.name,
          version: request.version,
          resolved: manifest.dist.tarball,
          integrity: request.integrity,
          maxBytes: request.maxTarballBytes,
        },
        {
          cache: this.#tarballCache,
          getTarball: (url, maxBytes) => this.#registry.getTarball(url, maxBytes),
        },
      );
      if (options.signal.aborted) throw abortError();
      results.push(
        Object.freeze({
          request: Object.freeze({ ...request }),
          bytes: fetched.bytes.slice(),
          fillTransport: 'standard' as const,
          fillCache: fetched.cacheHit ? ('tarball' as const) : ('network' as const),
        }),
      );
    }
    return Object.freeze(results);
  }

  async close(): Promise<void> {
    this.#closed = true;
  }
}

export function createStandardShadowAssetSource(
  options: Readonly<{
    registry: RegistryClient;
    tarballCache: TarballCache;
  }>,
): ShadowAssetSource {
  return new StandardShadowAssetSource(options);
}
