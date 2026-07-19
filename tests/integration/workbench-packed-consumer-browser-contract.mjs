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
const RESPONSE_FIELDS = Object.freeze([
  'bodyBytes',
  'kind',
  'method',
  'packageName',
  'path',
  'status',
]);

function record(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value;
}

/** True only when a baked snapshot row represents registry-backed package bytes. */
export function snapshotPackageNeedsRegistryTarball(value) {
  const entry = record(value, 'snapshot package lockfile entry');
  if (entry.rifty === undefined) return true;
  const rifty = record(entry.rifty, 'snapshot package rifty metadata');
  if (rifty.materialization === undefined) return true;
  const marker = record(rifty.materialization, 'snapshot package materialization');
  const fields = Object.keys(marker).sort();
  if (
    fields.length !== 4 ||
    fields[0] !== 'kind' ||
    fields[1] !== 'protocol' ||
    fields[2] !== 'recipeSha256' ||
    fields[3] !== 'substitutionId' ||
    marker.protocol !== 'rifty.lockfile-package-materialization/v1' ||
    marker.kind !== 'synthesized-shadow-delegate' ||
    typeof marker.substitutionId !== 'string' ||
    marker.substitutionId.length === 0 ||
    typeof marker.recipeSha256 !== 'string' ||
    !/^[0-9a-f]{64}$/.test(marker.recipeSha256)
  ) {
    throw new Error('unsupported packed snapshot package materialization');
  }
  return false;
}

function ledgerResponse(value, index, registryOrigin) {
  const response = record(value, `packed alias response ${index + 1}`);
  const fields = Object.keys(response).sort();
  if (
    fields.length !== RESPONSE_FIELDS.length ||
    fields.some((field, fieldIndex) => field !== RESPONSE_FIELDS[fieldIndex]) ||
    response.method !== 'GET' ||
    typeof response.path !== 'string' ||
    !response.path.startsWith('/') ||
    new URL(response.path, registryOrigin).origin !== registryOrigin ||
    typeof response.packageName !== 'string' ||
    response.packageName.length === 0 ||
    (response.kind !== 'packument' && response.kind !== 'tarball') ||
    response.status !== 200 ||
    !Number.isSafeInteger(response.bodyBytes) ||
    response.bodyBytes <= 0
  ) {
    throw new Error(`packed alias response ${index + 1} lacks complete successful GET body proof`);
  }
  return Object.freeze({
    method: response.method,
    path: response.path,
    packageName: response.packageName,
    kind: response.kind,
    status: response.status,
    bodyBytes: response.bodyBytes,
  });
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
  const responses = Object.freeze(
    options.responses.map((response, index) => ledgerResponse(response, index, origin.origin)),
  );
  let totalResponseBodyBytes = 0;
  for (const response of responses) {
    totalResponseBodyBytes += response.bodyBytes;
    if (!Number.isSafeInteger(totalResponseBodyBytes)) {
      throw new Error('packed alias response-body total must be a safe integer');
    }
  }
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
    schema: 2,
    registryOrigin: origin.origin,
    responses,
    totalResponseBodyBytes,
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

function stableJson(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value))
      throw new TypeError('packed alias proof contains a non-finite number');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  const object = record(value, 'packed alias proof value');
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(object[key])}`)
    .join(',')}}`;
}

function canonicalAliasProof(value) {
  const proof = record(value, 'packed alias proof');
  if (!Array.isArray(proof.responses)) {
    throw new TypeError('packed alias proof responses must be an array');
  }
  const rebuilt = packedAliasBoundaryProof({
    registryOrigin: proof.registryOrigin,
    responses: proof.responses,
  });
  const byResponse = (left, right) => stableJson(left).localeCompare(stableJson(right));
  const declared = { ...proof, responses: [...proof.responses].sort(byResponse) };
  const canonical = { ...rebuilt, responses: [...rebuilt.responses].sort(byResponse) };
  if (stableJson(declared) !== stableJson(canonical)) {
    throw new Error('packed alias proof summary does not match its complete response ledger');
  }
  return stableJson(canonical);
}

/** Compare exact response multisets; parallel completion order is not evidence. */
export function packedAliasProofMatches(expected, actual) {
  return canonicalAliasProof(expected) === canonicalAliasProof(actual);
}
