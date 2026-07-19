import { createHash } from 'node:crypto';

const SHA256 = /^[0-9a-f]{64}$/u;
const TRACE_PROTOCOL = 'rifty.lockfile-shadow-substitutions/v1';
const EXPECTED_ASSET_ID = 'esbuild-wasm@0.28.0/package/esbuild.wasm';
const EXPECTED_MEMBER_BYTES = 13_918_738;

function plainRecord(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function canonicalJson(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0 || Object.is(value, -0)) {
      throw new TypeError('shadow-asset cold canonical JSON received an invalid number');
    }
    return String(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (!plainRecord(value)) {
    throw new TypeError('shadow-asset cold canonical JSON accepts plain data only');
  }
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(',')}}`;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function exactKeys(value, expected, label) {
  if (!plainRecord(value)) throw new TypeError(`shadow-asset cold ${label} must be an object`);
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  if (
    actual.length !== sortedExpected.length ||
    actual.some((key, index) => key !== sortedExpected[index])
  ) {
    throw new TypeError(`shadow-asset cold ${label} has extra or missing fields`);
  }
}

function validatedCatalog(value) {
  if (!plainRecord(value)) throw new TypeError('shadow-asset cold catalog must be an object');
  const { digest, ...payload } = value;
  if (typeof digest !== 'string' || !SHA256.test(digest) || sha256(canonicalJson(payload)) !== digest) {
    throw new TypeError('shadow-asset cold catalog digest does not match its content');
  }
  if (
    payload.schema !== 1 ||
    typeof payload.id !== 'string' ||
    !Array.isArray(payload.substitutions) ||
    !Array.isArray(payload.assets)
  ) {
    throw new TypeError('shadow-asset cold catalog shape is invalid');
  }
  return { ...payload, digest };
}

function parsedLockfile(text) {
  if (typeof text !== 'string') throw new TypeError('shadow-asset cold lockfile must be text');
  let value;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new TypeError('shadow-asset cold lockfile is not valid JSON', { cause: error });
  }
  if (
    !plainRecord(value) ||
    value.lockfileVersion !== 3 ||
    value.requires !== true ||
    !plainRecord(value.packages) ||
    !plainRecord(value.rifty) ||
    !plainRecord(value.rifty.shadowSubstitutions)
  ) {
    throw new TypeError('shadow-asset cold lockfile lacks exact v3 substitution facts');
  }
  return value;
}

function exactApplied(lockfile) {
  const trace = lockfile.rifty.shadowSubstitutions;
  exactKeys(trace, ['applied', 'protocol'], 'lockfile substitution trace');
  if (trace.protocol !== TRACE_PROTOCOL || !Array.isArray(trace.applied)) {
    throw new TypeError('shadow-asset cold lockfile substitution trace protocol is unsupported');
  }
  if (trace.applied.length !== 1) {
    throw new TypeError('shadow-asset cold benchmark requires exactly one applied substitution');
  }
  const applied = trace.applied[0];
  exactKeys(
    applied,
    [
      'publicName',
      'requestedRange',
      'resolvedPublicVersion',
      'runtimeAdapterId',
      'substitutionId',
    ],
    'lockfile applied substitution',
  );
  if (
    typeof applied.publicName !== 'string' ||
    (applied.requestedRange !== null && typeof applied.requestedRange !== 'string') ||
    typeof applied.resolvedPublicVersion !== 'string' ||
    typeof applied.runtimeAdapterId !== 'string' ||
    typeof applied.substitutionId !== 'string'
  ) {
    throw new TypeError('shadow-asset cold lockfile applied substitution is invalid');
  }
  return applied;
}

function exactCatalogJoin(catalog, trace) {
  const substitution = catalog.substitutions.find(
    (candidate) =>
      plainRecord(candidate) &&
      candidate.id === trace.substitutionId &&
      candidate.publicName === trace.publicName,
  );
  if (
    !plainRecord(substitution) ||
    substitution.builtin !== true ||
    substitution.runtimeAdapterId !== trace.runtimeAdapterId ||
    !plainRecord(substitution.versions)
  ) {
    throw new TypeError('shadow-asset cold lockfile recipe drifted from the canonical catalog');
  }
  const assetIds = substitution.versions[trace.resolvedPublicVersion];
  if (!Array.isArray(assetIds) || assetIds.length !== 1 || assetIds[0] !== EXPECTED_ASSET_ID) {
    throw new TypeError('shadow-asset cold resolved version does not name the exact one-asset set');
  }
  const asset = catalog.assets.find(
    (candidate) => plainRecord(candidate) && candidate.id === EXPECTED_ASSET_ID,
  );
  if (
    !plainRecord(asset) ||
    !plainRecord(asset.source) ||
    asset.memberSize !== EXPECTED_MEMBER_BYTES ||
    asset.source.name !== 'esbuild-wasm' ||
    asset.source.version !== '0.28.0' ||
    typeof asset.source.integrity !== 'string'
  ) {
    throw new TypeError('shadow-asset cold catalog lacks the exact esbuild-wasm member/source');
  }
  return { substitution, asset };
}

/** Independent benchmark proof of the manager's catalog+trace plan facts. */
export function canonicalShadowAssetColdExpectation({ catalog: inputCatalog, lockfileText }) {
  const catalog = validatedCatalog(inputCatalog);
  const lockfile = parsedLockfile(lockfileText);
  const trace = exactApplied(lockfile);
  const { asset } = exactCatalogJoin(catalog, trace);
  const applied = {
    catalog: { id: catalog.id, digest: catalog.digest },
    publicName: trace.publicName,
    requestedRange: trace.requestedRange,
    resolvedPublicVersion: trace.resolvedPublicVersion,
    substitutionId: trace.substitutionId,
    runtimeAdapterId: trace.runtimeAdapterId,
    builtin: true,
  };
  const requiredSetDigest = sha256(
    canonicalJson({ schema: 1, substitutions: [applied], assets: [asset] }),
  );
  return {
    assetId: asset.id,
    requiredSetDigest,
    memberBytes: asset.memberSize,
    source: {
      name: asset.source.name,
      version: asset.source.version,
      integrity: asset.source.integrity,
    },
  };
}
