export const PACKED_WORKBENCH_EXPORTS = Object.freeze([
  '@riftydev/workbench',
  '@riftydev/workbench/playground',
  '@riftydev/workbench/owner-worker',
  '@riftydev/workbench/kernel-worker',
  '@riftydev/workbench/node-worker',
  '@riftydev/workbench/dev-server-worker',
  '@riftydev/workbench/typescript-worker',
]);

export const PACKED_VITE_JOURNEYS = Object.freeze([
  Object.freeze({ version: '7.3.6', runtimeAssetCount: 1, hmr: true }),
  Object.freeze({ version: '8.0.16', runtimeAssetCount: 0, hmr: false }),
]);

const ALIAS = '@esbuild/wasi-preview1';
const TRACKED_PACKAGES = new Set([ALIAS, 'esbuild', 'esbuild-wasm']);

function record(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value;
}

function trackedResponse(value, index) {
  const response = record(value, `packed alias response ${index + 1}`);
  if (!TRACKED_PACKAGES.has(response.packageName)) return null;
  if (
    response.method !== 'GET' ||
    (response.kind !== 'packument' && response.kind !== 'tarball') ||
    response.status !== 200 ||
    !Number.isSafeInteger(response.bodyBytes) ||
    response.bodyBytes <= 0
  ) {
    throw new Error(`packed alias response ${index + 1} lacks complete successful GET body proof`);
  }
  return response;
}

function summary(responses, packageName, kind) {
  const matching = responses.filter(
    (response) => response.packageName === packageName && response.kind === kind,
  );
  return Object.freeze({
    responses: matching.length,
    bodyBytes: matching.reduce((sum, response) => sum + response.bodyBytes, 0),
  });
}

function requireExactOne(value, label) {
  if (value.responses !== 1 || value.bodyBytes <= 0) {
    throw new Error(`${label} requires one complete response body`);
  }
}

/** Exact fixed-origin response-body proof for ADR-0298 alias retirement. */
export function packedAliasBoundaryProof(input) {
  const options = record(input, 'packed alias boundary input');
  let origin;
  try {
    origin = new URL(options.registryOrigin);
  } catch {
    throw new TypeError('packed alias boundary registryOrigin must be an http(s) origin');
  }
  if (
    (origin.protocol !== 'http:' && origin.protocol !== 'https:') ||
    origin.origin !== options.registryOrigin
  ) {
    throw new TypeError('packed alias boundary registryOrigin must be an http(s) origin');
  }
  if (!Array.isArray(options.responses)) {
    throw new TypeError('packed alias boundary responses must be an array');
  }
  const responses = options.responses.flatMap((response, index) => {
    const tracked = trackedResponse(response, index);
    return tracked === null ? [] : [tracked];
  });
  const publicPackument = summary(responses, 'esbuild', 'packument');
  const publicTarball = summary(responses, 'esbuild', 'tarball');
  const aliasPackument = summary(responses, ALIAS, 'packument');
  const aliasTarball = summary(responses, ALIAS, 'tarball');
  const assetPackument = summary(responses, 'esbuild-wasm', 'packument');
  const assetTarball = summary(responses, 'esbuild-wasm', 'tarball');
  if (
    aliasPackument.responses !== 0 ||
    aliasTarball.responses !== 0 ||
    publicTarball.responses !== 0
  ) {
    throw new Error('packed consumer observed a forbidden retired alias or public esbuild tarball');
  }
  requireExactOne(publicPackument, 'public esbuild packument proof');
  requireExactOne(assetPackument, 'runtime asset packument proof');
  requireExactOne(assetTarball, 'runtime asset tarball proof');
  return Object.freeze({
    schema: 1,
    registryOrigin: origin.origin,
    publicEsbuild: Object.freeze({ packument: publicPackument, tarball: publicTarball }),
    retiredAlias: Object.freeze({
      packument: aliasPackument,
      tarball: aliasTarball,
      totalBodyBytes: aliasPackument.bodyBytes + aliasTarball.bodyBytes,
    }),
    runtimeAssetSource: Object.freeze({
      packument: assetPackument,
      tarball: assetTarball,
    }),
  });
}
