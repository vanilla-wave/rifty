const STORAGE_CLASSES = new Set(['opfs-persisted', 'opfs-best-effort', 'memory-session']);
const NON_TERMINAL_PHASES = new Set(['cache-check', 'fetch', 'verify', 'persist']);

function refuse(note) {
  return { ok: false, note };
}

function plainRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonNegativeSafeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function positiveProtocol(value) {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value !== 'unknown' &&
    value !== 'unreachable'
  );
}

function responseOrigin(value) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.origin : null;
  } catch {
    return null;
  }
}

function zeroInspection(value) {
  if (!plainRecord(value)) return false;
  return [
    'entryCount',
    'storedBytes',
    'verifiedObjectCount',
    'verifiedObjectBytes',
    'readySetCount',
  ].every((field) => value[field] === 0);
}

function exactProgressSequence(entries, expected) {
  if (!Array.isArray(entries)) return { error: 'progress evidence must be an array' };
  const phases = entries.map((entry) => (plainRecord(entry?.progress) ? entry.progress.phase : null));
  const withPersist = ['cache-check', 'fetch', 'verify', 'persist', 'ready'];
  const withoutPersist = ['cache-check', 'fetch', 'verify', 'ready'];
  if (
    JSON.stringify(phases) !== JSON.stringify(withPersist) &&
    JSON.stringify(phases) !== JSON.stringify(withoutPersist)
  ) {
    return {
      error: `runtime-asset progress must be cache-check -> fetch -> verify -> persist? -> ready; received ${phases.join(' -> ')}`,
    };
  }

  let previousAt = -Infinity;
  for (const [index, entry] of entries.entries()) {
    if (
      !plainRecord(entry) ||
      typeof entry.atMs !== 'number' ||
      !Number.isFinite(entry.atMs) ||
      entry.atMs < previousAt ||
      !plainRecord(entry.progress)
    ) {
      return { error: `runtime-asset progress ${index + 1} has invalid monotonic evidence` };
    }
    previousAt = entry.atMs;
    const progress = entry.progress;
    if (progress.phase === 'ready') {
      if (
        progress.requiredSetDigest !== expected.requiredSetDigest ||
        progress.assetCount !== 1 ||
        !STORAGE_CLASSES.has(progress.storageClass)
      ) {
        return { error: 'runtime-asset ready progress does not match the canonical one-asset set' };
      }
      continue;
    }
    if (
      !NON_TERMINAL_PHASES.has(progress.phase) ||
      progress.assetId !== expected.assetId ||
      progress.assetIndex !== 0 ||
      progress.assetCount !== 1
    ) {
      return { error: `runtime-asset progress ${index + 1} has wrong/interleaved asset identity` };
    }
  }

  const first = entries[0];
  const terminal = entries.at(-1);
  return {
    value: {
      startedAtMs: first.atMs,
      readyAtMs: terminal.atMs,
      storageClass: terminal.progress.storageClass,
    },
  };
}

function networkEvidence(responses) {
  if (!Array.isArray(responses) || responses.length === 0) {
    return { error: 'standard fill has no CDP asset-source response evidence' };
  }
  let packumentDecoded = 0;
  let tarball = 0;
  let total = 0;
  let packumentResponses = 0;
  let tarballResponses = 0;
  const origins = new Map();
  for (const [index, response] of responses.entries()) {
    const label = `asset-source response ${index + 1}`;
    if (!plainRecord(response)) return { error: `${label} must be an object` };
    if (response.source === 'eddy') {
      return { error: `${label} used Eddy during a standard-only fill` };
    }
    if (response.source !== 'packument' && response.source !== 'tarball') {
      return { error: `${label} has an unknown source classification` };
    }
    if (response.complete !== true) return { error: `${label} body evidence is incomplete` };
    if (response.fromDiskCache === true || response.fromServiceWorker === true) {
      return { error: `${label} was a cache hit instead of network fill` };
    }
    if (!nonNegativeSafeInteger(response.bodyBytes)) {
      return { error: `${label} bodyBytes must be a non-negative safe integer` };
    }
    if (!positiveProtocol(response.protocol)) {
      return { error: `${label} lacks positive CDP protocol evidence` };
    }
    const origin = responseOrigin(response.url);
    if (origin === null) return { error: `${label} URL is not an absolute http(s) source` };
    const prior = origins.get(origin);
    if (prior !== undefined && prior.protocol !== response.protocol) {
      return { error: `${label} observed mixed protocols for ${origin}` };
    }
    origins.set(origin, {
      protocol: response.protocol,
      requests: (prior?.requests ?? 0) + 1,
    });
    total += response.bodyBytes;
    if (!Number.isSafeInteger(total)) return { error: 'asset-source response byte sum is unsafe' };
    if (response.source === 'packument') {
      packumentResponses += 1;
      packumentDecoded += response.bodyBytes;
    } else {
      tarballResponses += 1;
      tarball += response.bodyBytes;
    }
  }
  if (packumentResponses === 0 || packumentDecoded === 0) {
    return { error: 'standard fill lacks a decoded packument response body' };
  }
  if (tarballResponses === 0 || tarball === 0) {
    return { error: 'standard fill lacks a tarball response body' };
  }
  return {
    value: {
      responseBodyBytes: { packumentDecoded, tarball, total },
      transport: {
        mode: 'auto',
        origins: Object.fromEntries([...origins.entries()].sort(([a], [b]) => a.localeCompare(b))),
      },
    },
  };
}

/** Build one measured STD run only from complete page/storage/CDP/cleanup proof. */
export function buildStandardShadowAssetColdRun(input) {
  if (!plainRecord(input) || !plainRecord(input.expected)) {
    return refuse('standard fill evidence must contain canonical expected facts');
  }
  const expected = input.expected;
  if (
    typeof expected.assetId !== 'string' ||
    expected.assetId.length === 0 ||
    typeof expected.requiredSetDigest !== 'string' ||
    !/^[0-9a-f]{64}$/u.test(expected.requiredSetDigest) ||
    !Number.isSafeInteger(expected.memberBytes) ||
    expected.memberBytes <= 0
  ) {
    return refuse('standard fill canonical expected facts are invalid');
  }
  if (!zeroInspection(input.preInspection)) {
    return refuse('standard fill pre-open storage is not semantically empty');
  }

  const progress = exactProgressSequence(input.progress, expected);
  if (progress.error) return refuse(progress.error);
  if (
    typeof input.openResolvedAtMs !== 'number' ||
    !Number.isFinite(input.openResolvedAtMs) ||
    input.openResolvedAtMs < progress.value.readyAtMs
  ) {
    return refuse('standard fill ready progress did not precede project-open settlement');
  }

  const post = input.postInspection;
  if (
    !plainRecord(post) ||
    post.storageClass !== progress.value.storageClass ||
    post.verifiedObjectCount !== 1 ||
    post.verifiedObjectBytes !== expected.memberBytes ||
    post.readySetCount !== 1
  ) {
    return refuse('standard fill post-open storage does not prove one exact ready object/set');
  }
  if (
    !plainRecord(input.preInspection) ||
    input.preInspection.storageClass !== progress.value.storageClass
  ) {
    return refuse('standard fill storage class changed across the measured operation');
  }

  const network = networkEvidence(input.sourceResponses);
  if (network.error) return refuse(network.error);
  if (
    !plainRecord(input.cleanup) ||
    input.cleanup.projectClosed !== true ||
    input.cleanup.workbenchClosed !== true ||
    input.cleanup.lockReacquired !== true
  ) {
    return refuse('standard fill cleanup or origin Web Lock reacquisition failed');
  }

  return {
    ok: true,
    run: {
      durationMs: progress.value.readyAtMs - progress.value.startedAtMs,
      requiredSetDigest: expected.requiredSetDigest,
      storageClass: progress.value.storageClass,
      fillTransport: 'standard',
      fillCache: 'network',
      memberBytes: expected.memberBytes,
      responseBodyBytes: network.value.responseBodyBytes,
      transport: network.value.transport,
    },
  };
}
