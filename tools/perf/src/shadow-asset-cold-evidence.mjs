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
    typeof value === 'string' && value.length > 0 && value !== 'unknown' && value !== 'unreachable'
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

function absoluteHttpEndpoint(value) {
  if (typeof value !== 'string' || value.length === 0) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
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
  const phases = entries.map((entry) =>
    plainRecord(entry?.progress) ? entry.progress.phase : null,
  );
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

  let previousAt = Number.NEGATIVE_INFINITY;
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
    if (
      response.fromDiskCache === true ||
      response.fromServiceWorker === true ||
      response.fromPrefetchCache === true ||
      response.requestServedFromCache === true
    ) {
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

function canonicalExpected(input, label, requireSource) {
  if (!plainRecord(input) || !plainRecord(input.expected)) {
    return { error: `${label} evidence must contain canonical expected facts` };
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
    return { error: `${label} canonical expected facts are invalid` };
  }
  if (
    requireSource &&
    (!plainRecord(expected.source) ||
      typeof expected.source.name !== 'string' ||
      expected.source.name.length === 0 ||
      typeof expected.source.version !== 'string' ||
      expected.source.version.length === 0 ||
      typeof expected.source.integrity !== 'string' ||
      expected.source.integrity.length === 0)
  ) {
    return { error: `${label} canonical source descriptor is invalid` };
  }
  return { value: expected };
}

function pageEvidence(input, label, requireSource = false) {
  const canonical = canonicalExpected(input, label, requireSource);
  if (canonical.error) return canonical;
  const expected = canonical.value;
  if (!zeroInspection(input.preInspection)) {
    return { error: `${label} pre-open storage is not semantically empty` };
  }

  const progress = exactProgressSequence(input.progress, expected);
  if (progress.error) return progress;
  if (
    typeof input.openResolvedAtMs !== 'number' ||
    !Number.isFinite(input.openResolvedAtMs) ||
    input.openResolvedAtMs < progress.value.readyAtMs
  ) {
    return { error: `${label} ready progress did not precede project-open settlement` };
  }

  const post = input.postInspection;
  if (
    !plainRecord(post) ||
    post.storageClass !== progress.value.storageClass ||
    post.verifiedObjectCount !== 1 ||
    post.verifiedObjectBytes !== expected.memberBytes ||
    post.readySetCount !== 1
  ) {
    return { error: `${label} post-open storage does not prove one exact ready object/set` };
  }
  if (
    !plainRecord(input.preInspection) ||
    input.preInspection.storageClass !== progress.value.storageClass
  ) {
    return { error: `${label} storage class changed across the measured operation` };
  }
  if (
    !plainRecord(input.cleanup) ||
    input.cleanup.projectClosed !== true ||
    input.cleanup.workbenchClosed !== true ||
    input.cleanup.lockReacquired !== true
  ) {
    return { error: `${label} cleanup or origin Web Lock reacquisition failed` };
  }

  return {
    value: {
      durationMs: progress.value.readyAtMs - progress.value.startedAtMs,
      requiredSetDigest: expected.requiredSetDigest,
      storageClass: progress.value.storageClass,
      memberBytes: expected.memberBytes,
      expected,
    },
  };
}

function eddyEndpoints(value) {
  if (!plainRecord(value)) return { error: 'Eddy fill endpoints must be an object' };
  const registry = absoluteHttpEndpoint(value.registryUrl);
  if (registry === null) return { error: 'Eddy fill registry URL must be absolute http(s)' };
  const resolver = absoluteHttpEndpoint(value.resolverUrl);
  if (resolver === null) return { error: 'Eddy fill resolver URL must be absolute http(s)' };
  const bundle = absoluteHttpEndpoint(value.bundleUrl);
  if (bundle === null) return { error: 'Eddy fill bundle URL must be absolute http(s)' };
  return { value: { bundle, registry, resolver } };
}

function packagePath(name) {
  return encodeURIComponent(name).replace('%40', '@');
}

function looksLikeStandardSource(url, registry, sourceName) {
  const base = registry.href.replace(/\/$/u, '');
  const packument = `${base}/${packagePath(sourceName)}`;
  if (url.href === packument) return true;
  const path = url.pathname.toLowerCase();
  const plain = sourceName.toLowerCase();
  const encoded = encodeURIComponent(sourceName).toLowerCase();
  return (path.includes(plain) || path.includes(encoded)) && path.endsWith('.tgz');
}

function exactShadowSourcePostData(source) {
  return JSON.stringify({
    dependencies: { [source.name]: source.version },
    optionalDependencies: {},
  });
}

function looksLikeBundleSource(url, bundle) {
  const prefix = `${bundle.href.replace(/\/+$/u, '')}/bundle/`;
  return url.href.startsWith(prefix);
}

function cacheSource(response) {
  if (response.fromDiskCache === true) return 'response.fromDiskCache';
  if (response.fromDiskCache !== false) return 'response.fromDiskCache proof absent';
  if (response.fromServiceWorker === true) return 'response.fromServiceWorker';
  if (response.fromServiceWorker !== false) return 'response.fromServiceWorker proof absent';
  if (response.fromPrefetchCache === true) return 'response.fromPrefetchCache';
  if (response.requestServedFromCache === true) return 'Network.requestServedFromCache';
  return null;
}

function eddyNetworkEvidence(responses, endpoints, source) {
  if (!Array.isArray(responses) || responses.length === 0) {
    return { error: 'Eddy fill has no CDP asset-source response evidence' };
  }
  const expectedPostData = exactShadowSourcePostData(source);
  const exact = [];
  for (const [index, response] of responses.entries()) {
    const label = `Eddy asset-source response ${index + 1}`;
    if (!plainRecord(response)) return { error: `${label} must be an object` };
    const url = absoluteHttpEndpoint(response.url);
    if (url === null) return { error: `${label} URL must be absolute http(s)` };
    if (looksLikeStandardSource(url, endpoints.registry, source.name)) {
      return { error: 'Eddy cold fill fell back to the standard registry source' };
    }
    if (looksLikeBundleSource(url, endpoints.bundle)) {
      return {
        error: 'Eddy cold fill used a learned or configured bundle GET instead of cold POST',
      };
    }
    if (url.href === endpoints.resolver.href) {
      if (typeof response.postData !== 'string') {
        return { error: 'Eddy cold fill captured a resolver lifecycle without request body proof' };
      }
      try {
        const parsed = JSON.parse(response.postData);
        if (!plainRecord(parsed)) throw new TypeError('request body must be an object');
      } catch {
        return { error: 'Eddy cold fill captured a malformed resolver request body' };
      }
    }
    if (
      url.href === endpoints.resolver.href &&
      response.method === 'POST' &&
      response.postData === expectedPostData
    ) {
      exact.push(response);
    }
  }
  if (exact.length !== 1) {
    return {
      error: `Eddy cold fill requires one byte-exact canonical resolver POST; captured ${exact.length}`,
    };
  }
  const response = exact[0];
  if (!plainRecord(response)) return { error: 'Eddy asset-source response must be an object' };
  if (typeof response.requestId !== 'string' || response.requestId.length === 0) {
    return { error: 'Eddy asset-source response lacks a CDP request lifecycle' };
  }
  if (
    response.lifecycleId !== undefined &&
    (typeof response.lifecycleId !== 'string' || response.lifecycleId.length === 0)
  ) {
    return { error: 'Eddy asset-source response lifecycleId is invalid' };
  }
  const url = absoluteHttpEndpoint(response.url);
  if (url === null) return { error: 'Eddy asset-source response URL is not absolute http(s)' };
  if (looksLikeStandardSource(url, endpoints.registry, source.name)) {
    return { error: 'Eddy cold fill fell back to the standard registry source' };
  }
  if (url.href !== endpoints.resolver.href) {
    return { error: 'Eddy cold fill response did not use the exact configured resolver URL' };
  }
  if (response.method !== 'POST') {
    return { error: 'Eddy cold fill lacks the exact empty-pin resolver POST' };
  }
  if (!Number.isSafeInteger(response.status) || response.status < 200 || response.status >= 300) {
    return { error: 'Eddy cold fill resolver POST is not a successful 2xx response' };
  }
  if (response.complete !== true) {
    return { error: 'Eddy cold fill resolver POST body evidence is incomplete' };
  }
  const cache = cacheSource(response);
  if (cache !== null) {
    return { error: `Eddy cold fill resolver POST lacks clean network provenance (${cache})` };
  }
  if (!nonNegativeSafeInteger(response.bodyBytes) || response.bodyBytes === 0) {
    return { error: 'Eddy cold fill bundle bodyBytes must be a positive safe integer' };
  }
  if (!positiveProtocol(response.protocol)) {
    return { error: 'Eddy cold fill resolver origin lacks positive CDP protocol evidence' };
  }
  return {
    value: {
      responseBodyBytes: { bundle: response.bodyBytes, total: response.bodyBytes },
      transport: {
        mode: 'auto',
        origins: {
          [url.origin]: { protocol: response.protocol, requests: 1 },
        },
      },
    },
  };
}

/** Build one measured STD run only from complete page/storage/CDP/cleanup proof. */
export function buildStandardShadowAssetColdRun(input) {
  const page = pageEvidence(input, 'standard fill');
  if (page.error) return refuse(page.error);
  const network = networkEvidence(input.sourceResponses);
  if (network.error) return refuse(network.error);

  return {
    ok: true,
    run: {
      durationMs: page.value.durationMs,
      requiredSetDigest: page.value.requiredSetDigest,
      storageClass: page.value.storageClass,
      fillTransport: 'standard',
      fillCache: 'network',
      memberBytes: page.value.memberBytes,
      responseBodyBytes: network.value.responseBodyBytes,
      transport: network.value.transport,
    },
  };
}

/** Build one measured Eddy run only from exact empty-pin POST + shared page proof. */
export function buildEddyShadowAssetColdRun(input) {
  const page = pageEvidence(input, 'Eddy fill', true);
  if (page.error) return refuse(page.error);
  if (input.shadowSourceCacheRegime !== 'fresh-owner-empty-tarball-cache') {
    return refuse('Eddy fill lacks the exact fresh-owner empty-tarball-cache premise');
  }
  const endpoints = eddyEndpoints(input.endpoints);
  if (endpoints.error) return refuse(endpoints.error);
  const network = eddyNetworkEvidence(
    input.sourceResponses,
    endpoints.value,
    page.value.expected.source,
  );
  if (network.error) return refuse(network.error);

  return {
    ok: true,
    run: {
      durationMs: page.value.durationMs,
      requiredSetDigest: page.value.requiredSetDigest,
      storageClass: page.value.storageClass,
      fillTransport: 'eddy',
      fillCache: 'bundle',
      memberBytes: page.value.memberBytes,
      responseBodyBytes: network.value.responseBodyBytes,
      transport: network.value.transport,
    },
  };
}
