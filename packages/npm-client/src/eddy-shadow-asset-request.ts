import {
  bakedOverrides,
  builtinShadowAssetCatalog,
  internalsShims,
} from '@riftydev/shadow-registry';
import type { EddyRequestBody } from './eddy-request.ts';
import type { ShadowAssetSourceRequest } from './shadow-assets.ts';

const unsafeSourceNames = new Set<string>([
  ...Object.keys(bakedOverrides),
  ...Object.keys(internalsShims),
  ...builtinShadowAssetCatalog.substitutions.map(({ publicName }) => publicName),
]);

export class ShadowAssetSourceCollisionError extends Error {
  override readonly name = 'ShadowAssetSourceCollisionError';
  readonly code = 'ESHADOWASSETSOURCE' as const;
  readonly sourceName: string;
  readonly sourceVersion: string;

  constructor(sourceName: string, sourceVersion: string, detail: string) {
    super(`ESHADOWASSETSOURCE: ${sourceName}@${sourceVersion} ${detail}`);
    this.sourceName = sourceName;
    this.sourceVersion = sourceVersion;
  }
}

function assertSourceIdentity(
  request: ShadowAssetSourceRequest,
): asserts request is ShadowAssetSourceRequest {
  if (request === null || typeof request !== 'object') {
    throw new TypeError('shadow asset Eddy source request must be an object');
  }
  if (typeof request.name !== 'string' || request.name.length === 0) {
    throw new TypeError('shadow asset Eddy source name must be a non-empty string');
  }
  if (typeof request.version !== 'string' || request.version.length === 0) {
    throw new TypeError('shadow asset Eddy source version must be a non-empty string');
  }
}

/** Construction-time invariant: ordinary Eddy install must never transform a source package. */
export function assertShadowAssetEddySourceCompatibility(
  requests: readonly ShadowAssetSourceRequest[],
): void {
  if (!Array.isArray(requests)) {
    throw new TypeError('shadow asset Eddy sources must be an array');
  }
  for (const request of requests) {
    assertSourceIdentity(request);
    if (unsafeSourceNames.has(request.name)) {
      throw new ShadowAssetSourceCollisionError(
        request.name,
        request.version,
        'matches a builtin override or shadow trigger',
      );
    }
  }
}

/** Exact misses -> ordinary Eddy request body; no misses means no wire request. */
export function eddyRequestForShadowAssetSources(
  requests: readonly ShadowAssetSourceRequest[],
): EddyRequestBody | null {
  assertShadowAssetEddySourceCompatibility(requests);
  if (requests.length === 0) return null;

  const byName = new Map<string, string>();
  for (const request of requests) {
    const existing = byName.get(request.name);
    if (existing !== undefined && existing !== request.version) {
      throw new ShadowAssetSourceCollisionError(
        request.name,
        request.version,
        `conflicts with source version ${existing} in the same missing set`,
      );
    }
    byName.set(request.name, request.version);
  }
  const dependencies: Record<string, string> = {};
  for (const [name, version] of [...byName.entries()].sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0,
  )) {
    dependencies[name] = version;
  }
  return Object.freeze({
    dependencies: Object.freeze(dependencies),
    optionalDependencies: Object.freeze({}),
  });
}
