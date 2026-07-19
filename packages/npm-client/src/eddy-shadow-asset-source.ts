import { builtinShadowAssetCatalog } from '@riftydev/shadow-registry';
import {
  DEFAULT_FETCH_MAX_BYTES,
  DEFAULT_FETCH_STALL_MS,
  drainBodyBounded,
  fetchHeadersBounded,
} from './bounded-fetch.ts';
import { closureHashOf } from './closure-hash.ts';
import { LOCKFILE_FILE, MANIFEST_FILE, unpackEddyBundle } from './eddy-bundle.ts';
import {
  EDDY_STORE_DURABLE_HEADER,
  type EddyRequestBody,
  bundleUrlFor,
  canonicalEddyRequestKey,
} from './eddy-request.ts';
import {
  assertShadowAssetEddySourceCompatibility,
  eddyRequestForShadowAssetSources,
} from './eddy-shadow-asset-request.ts';
import {
  bundleCompletenessGap,
  lockfileCovers,
  lockfilePathBareName,
  lockfileSubgraph,
} from './installer-lockfile-reader.ts';
import type { Lockfile } from './linker.ts';
import type {
  ShadowAssetSource,
  ShadowAssetSourceRequest,
  ShadowAssetSourceResult,
} from './shadow-assets.ts';
import { computeIntegrity, parseIntegrityAlgorithm } from './tarball-cache.ts';

export interface EddyShadowAssetSourceOptions {
  readonly resolverUrl: string;
  readonly bundleBaseUrl?: string;
  /** Full composition-time source set. Collision checks run synchronously here. */
  readonly sourceRequests: readonly ShadowAssetSourceRequest[];
  readonly standardSource: ShadowAssetSource;
  /** Manager-owned state: one source instance and one pin map share a lifetime. */
  readonly learnedPins: Map<string, string>;
  readonly fetchImpl?: typeof fetch;
  readonly stallTimeoutMs?: number;
  readonly maxBundleBytes?: number;
  readonly warn?: (line: string) => void;
}

export type BuiltinEddyShadowAssetSourceOptions = Omit<
  EddyShadowAssetSourceOptions,
  'sourceRequests'
>;

function identityKey(request: Pick<ShadowAssetSourceRequest, 'name' | 'version'>): string {
  return `${request.name}\0${request.version}`;
}

function assertRequest(request: ShadowAssetSourceRequest): void {
  if (request === null || typeof request !== 'object') {
    throw new TypeError('shadow asset source request must be an object');
  }
  if (typeof request.name !== 'string' || request.name.length === 0) {
    throw new TypeError('shadow asset source request name must be a non-empty string');
  }
  if (typeof request.version !== 'string' || request.version.length === 0) {
    throw new TypeError('shadow asset source request version must be a non-empty string');
  }
  if (
    typeof request.integrity !== 'string' ||
    parseIntegrityAlgorithm(request.integrity) === null
  ) {
    throw new TypeError(`shadow asset source integrity is invalid for ${request.name}`);
  }
  if (!Number.isSafeInteger(request.maxTarballBytes) || request.maxTarballBytes <= 0) {
    throw new TypeError(`shadow asset source byte cap is invalid for ${request.name}`);
  }
}

function sameRequest(left: ShadowAssetSourceRequest, right: ShadowAssetSourceRequest): boolean {
  return (
    left.name === right.name &&
    left.version === right.version &&
    left.integrity === right.integrity &&
    left.maxTarballBytes === right.maxTarballBytes
  );
}

const builtinSourceRequests: readonly ShadowAssetSourceRequest[] = (() => {
  const byIdentity = new Map<string, ShadowAssetSourceRequest>();
  for (const descriptor of builtinShadowAssetCatalog.assets) {
    const request = Object.freeze({
      ...descriptor.source,
      maxTarballBytes: descriptor.maxTarballBytes,
    });
    assertRequest(request);
    const key = identityKey(request);
    const prior = byIdentity.get(key);
    if (prior !== undefined && !sameRequest(prior, request)) {
      throw new TypeError(`builtin assets disagree on source ${request.name}@${request.version}`);
    }
    byIdentity.set(key, request);
  }
  return Object.freeze(
    [...byIdentity.values()].sort((left, right) =>
      identityKey(left) < identityKey(right) ? -1 : identityKey(left) > identityKey(right) ? 1 : 0,
    ),
  );
})();

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

function transportError(transport: 'Eddy' | 'standard', cause: unknown): Error {
  const error = asError(cause);
  return new Error(`${transport} shadow asset source failed: ${error.message}`, { cause: error });
}

function abortError(): DOMException {
  return new DOMException('The operation was aborted', 'AbortError');
}

function parseLockfile(text: string): Lockfile {
  const parsed = JSON.parse(text) as unknown;
  if (
    parsed === null ||
    typeof parsed !== 'object' ||
    Array.isArray(parsed) ||
    (parsed as { lockfileVersion?: unknown }).lockfileVersion !== 3 ||
    (parsed as { requires?: unknown }).requires !== true ||
    typeof (parsed as { name?: unknown }).name !== 'string' ||
    typeof (parsed as { version?: unknown }).version !== 'string'
  ) {
    throw new Error('Eddy bundle lockfile is not a valid v3 lockfile');
  }
  const packages = (parsed as { packages?: unknown }).packages;
  if (packages === null || typeof packages !== 'object' || Array.isArray(packages)) {
    throw new Error('Eddy bundle lockfile has no package map');
  }
  return parsed as Lockfile;
}

function validateMemberLayout(
  memberNames: readonly string[],
  tarballFiles: readonly string[],
): void {
  const expected = [MANIFEST_FILE, LOCKFILE_FILE, ...tarballFiles];
  if (
    memberNames.length !== expected.length ||
    memberNames.some((name, index) => name !== expected[index])
  ) {
    throw new Error('Eddy bundle has partial, duplicate, reordered, or extra members');
  }
}

async function verifiedBundleResults(
  bytes: Uint8Array,
  requests: readonly ShadowAssetSourceRequest[],
  body: EddyRequestBody,
  expectedClosureHash?: string,
): Promise<{ readonly closureHash: string; readonly results: readonly ShadowAssetSourceResult[] }> {
  const bundle = unpackEddyBundle(bytes);
  const manifest = bundle.manifest;
  if (!Array.isArray(manifest.tarballs)) {
    throw new Error('Eddy bundle manifest has no tarball list');
  }
  if (
    manifest.asOf === null ||
    typeof manifest.asOf !== 'object' ||
    typeof manifest.asOf.closureHash !== 'string' ||
    manifest.asOf.closureHash.length === 0
  ) {
    throw new Error('Eddy bundle manifest has no closure identity');
  }
  if (expectedClosureHash !== undefined && manifest.asOf.closureHash !== expectedClosureHash) {
    throw new Error(
      `Eddy bundle closure ${manifest.asOf.closureHash} does not match requested ${expectedClosureHash}`,
    );
  }

  const files = new Set<string>();
  const identities = new Set<string>();
  for (const entry of manifest.tarballs) {
    if (
      typeof entry.file !== 'string' ||
      !entry.file.startsWith('tarballs/') ||
      entry.file.split('/').includes('..') ||
      typeof entry.name !== 'string' ||
      entry.name.length === 0 ||
      typeof entry.version !== 'string' ||
      entry.version.length === 0 ||
      typeof entry.integrity !== 'string'
    ) {
      throw new Error('Eddy bundle manifest contains an invalid tarball identity');
    }
    if (files.has(entry.file)) {
      throw new Error(`Eddy bundle manifest has duplicate member ${entry.file}`);
    }
    const identity = identityKey(entry);
    if (identities.has(identity)) {
      throw new Error(`Eddy bundle manifest has duplicate package ${entry.name}@${entry.version}`);
    }
    files.add(entry.file);
    identities.add(identity);
  }
  validateMemberLayout(
    bundle.memberNames,
    manifest.tarballs.map(({ file }) => file),
  );

  const lockfile = parseLockfile(bundle.lockfileText);
  if ((await closureHashOf(lockfile)) !== manifest.asOf.closureHash) {
    throw new Error('Eddy bundle manifest closure does not match its lockfile');
  }
  const effectiveRequest = { ...body.dependencies, ...body.optionalDependencies };
  if (lockfileCovers(lockfile, effectiveRequest) === null) {
    throw new Error('Eddy bundle lockfile does not cover the exact source request');
  }
  const gap = bundleCompletenessGap(lockfile, effectiveRequest, manifest.tarballs);
  if (gap !== null) throw new Error(gap);

  const reachable = lockfileSubgraph(lockfile, Object.keys(effectiveRequest));
  for (const path of Object.keys(lockfile.packages)) {
    if (path !== '' && !reachable.has(lockfilePathBareName(path))) {
      throw new Error(`Eddy bundle lockfile contains unrelated package ${path}`);
    }
  }
  for (const entry of manifest.tarballs) {
    if (!reachable.has(entry.name)) {
      throw new Error(`Eddy bundle contains unrelated tarball ${entry.name}@${entry.version}`);
    }
  }

  const tarballs = new Map<string, Uint8Array>();
  for (const tarball of bundle.tarballs) {
    const algorithm = parseIntegrityAlgorithm(tarball.entry.integrity);
    if (algorithm === null) {
      throw new Error(
        `Eddy bundle has unsupported integrity for ${tarball.entry.name}@${tarball.entry.version}`,
      );
    }
    if ((await computeIntegrity(tarball.bytes, algorithm)) !== tarball.entry.integrity) {
      throw new Error(
        `Eddy bundle integrity mismatch for ${tarball.entry.name}@${tarball.entry.version}`,
      );
    }
    tarballs.set(identityKey(tarball.entry), tarball.bytes);
  }

  const results: ShadowAssetSourceResult[] = [];
  for (const request of requests) {
    const entry = manifest.tarballs.find(
      (candidate) => identityKey(candidate) === identityKey(request),
    );
    if (entry === undefined || entry.integrity !== request.integrity) {
      throw new Error(
        `Eddy bundle omitted exact requested tarball ${request.name}@${request.version}`,
      );
    }
    const tarball = tarballs.get(identityKey(request));
    if (tarball === undefined) {
      throw new Error(`Eddy bundle omitted bytes for ${request.name}@${request.version}`);
    }
    if (tarball.byteLength > request.maxTarballBytes) {
      throw new Error(
        `Eddy tarball for ${request.name}@${request.version} exceeded ${request.maxTarballBytes} bytes`,
      );
    }
    results.push(
      Object.freeze({
        request: Object.freeze({ ...request }),
        bytes: tarball.slice(),
        fillTransport: 'eddy' as const,
        fillCache: 'bundle' as const,
      }),
    );
  }
  return Object.freeze({
    closureHash: manifest.asOf.closureHash,
    results: Object.freeze(results),
  });
}

class EddyShadowAssetSource implements ShadowAssetSource {
  readonly #resolverUrl: string;
  readonly #bundleBaseUrl: string;
  readonly #configured = new Map<string, ShadowAssetSourceRequest>();
  readonly #standardSource: ShadowAssetSource;
  readonly #learnedPins: Map<string, string>;
  readonly #fetchImpl: typeof fetch;
  readonly #stallTimeoutMs: number;
  readonly #maxBundleBytes: number;
  readonly #warn: (line: string) => void;
  #closed = false;
  #closePromise: Promise<void> | null = null;

  constructor(options: EddyShadowAssetSourceOptions) {
    if (options === null || typeof options !== 'object') {
      throw new TypeError('Eddy shadow asset source options must be an object');
    }
    if (typeof options.resolverUrl !== 'string' || options.resolverUrl.length === 0) {
      throw new TypeError('Eddy resolver URL must be a non-empty string');
    }
    if (!Array.isArray(options.sourceRequests)) {
      throw new TypeError('Eddy shadow asset sourceRequests must be an array');
    }
    assertShadowAssetEddySourceCompatibility(options.sourceRequests);
    eddyRequestForShadowAssetSources(options.sourceRequests);
    for (const request of options.sourceRequests) {
      assertRequest(request);
      const key = identityKey(request);
      const prior = this.#configured.get(key);
      if (prior !== undefined && !sameRequest(prior, request)) {
        throw new TypeError(`conflicting descriptors for ${request.name}@${request.version}`);
      }
      this.#configured.set(key, Object.freeze({ ...request }));
    }
    if (
      options.standardSource === null ||
      typeof options.standardSource !== 'object' ||
      typeof options.standardSource.acquire !== 'function' ||
      typeof options.standardSource.close !== 'function'
    ) {
      throw new TypeError('standard shadow asset source is invalid');
    }
    if (!(options.learnedPins instanceof Map)) {
      throw new TypeError('Eddy shadow asset learnedPins must be a Map');
    }
    if (
      options.stallTimeoutMs !== undefined &&
      (!Number.isSafeInteger(options.stallTimeoutMs) || options.stallTimeoutMs <= 0)
    ) {
      throw new TypeError('Eddy shadow asset stallTimeoutMs must be a positive safe integer');
    }
    if (
      options.maxBundleBytes !== undefined &&
      (!Number.isSafeInteger(options.maxBundleBytes) || options.maxBundleBytes <= 0)
    ) {
      throw new TypeError('Eddy shadow asset maxBundleBytes must be a positive safe integer');
    }
    this.#resolverUrl = options.resolverUrl;
    this.#bundleBaseUrl = options.bundleBaseUrl ?? options.resolverUrl;
    this.#standardSource = options.standardSource;
    this.#learnedPins = options.learnedPins;
    this.#fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.#stallTimeoutMs = options.stallTimeoutMs ?? DEFAULT_FETCH_STALL_MS;
    this.#maxBundleBytes = options.maxBundleBytes ?? DEFAULT_FETCH_MAX_BYTES;
    this.#warn = options.warn ?? ((line) => console.warn(line));
  }

  async acquire(
    requests: readonly ShadowAssetSourceRequest[],
    options: Readonly<{ signal: AbortSignal }>,
  ): Promise<readonly ShadowAssetSourceResult[]> {
    if (this.#closed) throw new Error('Eddy shadow asset source is closed');
    if (!Array.isArray(requests)) throw new TypeError('source requests must be an array');
    if (
      options === null ||
      typeof options !== 'object' ||
      !(options.signal instanceof AbortSignal)
    ) {
      throw new TypeError('source signal is invalid');
    }
    if (options.signal.aborted) throw abortError();
    const unique = new Map<string, ShadowAssetSourceRequest>();
    for (const request of requests) {
      assertRequest(request);
      const configured = this.#configured.get(identityKey(request));
      if (configured === undefined || !sameRequest(configured, request)) {
        throw new TypeError(
          `unconfigured Eddy shadow asset source ${request.name}@${request.version}`,
        );
      }
      unique.set(identityKey(request), configured);
    }
    const canonical = [...unique.values()].sort((left, right) =>
      identityKey(left) < identityKey(right) ? -1 : identityKey(left) > identityKey(right) ? 1 : 0,
    );
    if (canonical.length === 0) return Object.freeze([]);
    const body = eddyRequestForShadowAssetSources(canonical);
    if (body === null) return Object.freeze([]);

    try {
      return await this.#acquireEddy(canonical, body, options.signal);
    } catch (eddyCause) {
      if (options.signal.aborted) throw abortError();
      const eddyFailure = transportError('Eddy', eddyCause);
      this.#warn(`shadow asset Eddy unavailable, fallback to standard — ${eddyFailure.message}`);
      try {
        return await this.#standardSource.acquire(canonical, options);
      } catch (standardCause) {
        const standardFailure = transportError('standard', standardCause);
        throw new AggregateError(
          [eddyFailure, standardFailure],
          'shadow asset acquisition failed through Eddy and standard transports',
        );
      }
    }
  }

  async #acquireEddy(
    requests: readonly ShadowAssetSourceRequest[],
    body: EddyRequestBody,
    signal: AbortSignal,
  ): Promise<readonly ShadowAssetSourceResult[]> {
    const requestKey = canonicalEddyRequestKey(body);
    const pin = this.#learnedPins.get(requestKey);
    if (pin !== undefined && (typeof pin !== 'string' || pin.length === 0)) {
      throw new Error('learned Eddy closure pin is invalid');
    }
    const url = pin === undefined ? this.#resolverUrl : bundleUrlFor(this.#bundleBaseUrl, pin);
    const response = await fetchHeadersBounded(
      (boundSignal) =>
        this.#fetchImpl(url, {
          ...(pin === undefined ? { method: 'POST', body: JSON.stringify(body) } : {}),
          signal: AbortSignal.any([boundSignal, signal]),
        }),
      this.#stallTimeoutMs,
      `Eddy shadow asset ${pin === undefined ? 'POST' : 'GET'}`,
    );
    const bytes = await drainBodyBounded(response, {
      stallTimeoutMs: this.#stallTimeoutMs,
      maxBytes: this.#maxBundleBytes,
      label: 'Eddy shadow asset bundle',
    });
    if (signal.aborted) throw abortError();
    if (!response.ok) {
      throw new Error(`resolver returned HTTP ${response.status}`);
    }
    if ((response.headers.get('content-type') ?? '').includes('application/json')) {
      let reason = 'typed decline';
      try {
        const parsed = JSON.parse(new TextDecoder().decode(bytes)) as {
          feature?: unknown;
          error?: unknown;
        };
        const detail = parsed.feature ?? parsed.error;
        if (typeof detail === 'string' && detail.length > 0) reason = detail;
      } catch {
        reason = 'malformed typed decline';
      }
      throw new Error(`resolver declined (${reason})`);
    }
    const verified = await verifiedBundleResults(bytes, requests, body, pin);
    if (pin === undefined && response.headers.get(EDDY_STORE_DURABLE_HEADER) === '1') {
      this.#learnedPins.set(requestKey, verified.closureHash);
    }
    return verified.results;
  }

  close(): Promise<void> {
    if (this.#closePromise !== null) return this.#closePromise;
    this.#closed = true;
    this.#closePromise = Promise.resolve().then(() => this.#standardSource.close());
    return this.#closePromise;
  }
}

export function createEddyShadowAssetSource(
  options: EddyShadowAssetSourceOptions,
): ShadowAssetSource {
  return new EddyShadowAssetSource(options);
}

/** Closed builtin composition; not an external source-set SPI (ADR-0299). */
export function createBuiltinEddyShadowAssetSource(
  options: BuiltinEddyShadowAssetSourceOptions,
): ShadowAssetSource {
  if (options === null || typeof options !== 'object') {
    throw new TypeError('builtin Eddy shadow asset source options must be an object');
  }
  if ('sourceRequests' in options) {
    throw new TypeError('builtin Eddy shadow asset sources are not caller-configurable');
  }
  return createEddyShadowAssetSource({ ...options, sourceRequests: builtinSourceRequests });
}
