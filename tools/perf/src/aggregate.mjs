/**
 * Pure aggregation for the cold-start / npm-install benchmark harness
 * (docs/backlog/perf/cold-start-and-install-benchmark). No I/O, no browser: the
 * testable core the RED-first unit suite pins. `../bench.mjs` feeds it the
 * measured samples and writes the JSON artifact.
 */

export const SCHEMA_VERSION = 3;
const DEFAULT_STEP_MS = 100;
const SHADOW_ASSET_RUN_COUNT = 5;
const SHADOW_ASSET_MEMBER_BYTES = 13_918_738;
const SHADOW_ASSET_CACHE_REGIME = 'fresh-context-empty-store-and-tarball;warm-proxy-origin';
const SHADOW_ASSET_STORAGE_CLASSES = new Set([
  'opfs-persisted',
  'opfs-best-effort',
  'memory-session',
]);

/** Median of a non-empty numeric array (mean of the two middles when even). */
export function median(values) {
  if (values.length === 0) throw new Error('median() of an empty sample set');
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * Round UP to the next `stepMs`. The launch figure must never claim faster than
 * measured (Fidelity), so the displayed number rounds conservatively up.
 */
export function roundUpMs(ms, stepMs = DEFAULT_STEP_MS) {
  return Math.ceil(ms / stepMs) * stepMs;
}

/** Summarize a measured sample set: `{ status, count, samples, median, displayMs }`. */
export function summarize(samples, stepMs = DEFAULT_STEP_MS) {
  const med = median(samples);
  return {
    status: 'measured',
    count: samples.length,
    samples: [...samples],
    median: med,
    displayMs: roundUpMs(med, stepMs),
  };
}

function shadowAssetUnmeasured(note) {
  return { status: 'unmeasured', note };
}

function plainRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonNegativeSafeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function positiveProtocol(protocol) {
  return (
    typeof protocol === 'string' &&
    protocol.length > 0 &&
    protocol !== 'unknown' &&
    protocol !== 'unreachable'
  );
}

function remoteOrigin(value) {
  try {
    const url = new URL(value);
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.origin === value
      ? url.origin
      : null;
  } catch {
    return null;
  }
}

function registryOrigin(value) {
  if (typeof value !== 'string' || value.length === 0) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.origin : null;
  } catch {
    return null;
  }
}

function endpointOrigin(value) {
  if (typeof value !== 'string' || value.length === 0) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.origin : null;
  } catch {
    return null;
  }
}

function exactResponseFields(value, expected) {
  const fields = Object.keys(value).sort();
  return (
    fields.length === expected.length && fields.every((field, index) => field === expected[index])
  );
}

function normalizedShadowAssetRun(run, index, expectedFillTransport, expectedFillCache) {
  const label = `shadow asset cold run ${index + 1}`;
  if (!plainRecord(run)) return { error: `${label} must be an object` };
  if (
    typeof run.durationMs !== 'number' ||
    !Number.isFinite(run.durationMs) ||
    run.durationMs < 0
  ) {
    return { error: `${label} durationMs must be a non-negative finite number` };
  }
  if (typeof run.requiredSetDigest !== 'string' || run.requiredSetDigest.length === 0) {
    return { error: `${label} requiredSetDigest must be a non-empty string` };
  }
  if (!SHADOW_ASSET_STORAGE_CLASSES.has(run.storageClass)) {
    return { error: `${label} storageClass is invalid` };
  }
  if (run.fillTransport !== expectedFillTransport) {
    return {
      error: `${label} fillTransport must be ${expectedFillTransport}; received ${String(run.fillTransport)}`,
    };
  }
  if (run.fillCache !== expectedFillCache) {
    return {
      error: `${label} fillCache must be ${expectedFillCache}; received ${String(run.fillCache)}`,
    };
  }
  if (run.memberBytes !== SHADOW_ASSET_MEMBER_BYTES) {
    return {
      error: `${label} memberBytes must be ${SHADOW_ASSET_MEMBER_BYTES}; received ${String(run.memberBytes)}`,
    };
  }

  const response = run.responseBodyBytes;
  if (!plainRecord(response)) return { error: `${label} responseBodyBytes must be an object` };
  let responseBodyBytes;
  if (expectedFillTransport === 'standard') {
    const fields = ['packumentDecoded', 'tarball', 'total'];
    if (!exactResponseFields(response, fields)) {
      return {
        error: `${label} standard responseBodyBytes must contain exactly ${fields.join(', ')}`,
      };
    }
    for (const field of fields) {
      if (!nonNegativeSafeInteger(response[field])) {
        return { error: `${label} responseBodyBytes.${field} must be a non-negative safe integer` };
      }
    }
    if (response.packumentDecoded === 0 || response.tarball === 0) {
      return { error: `${label} standard packument and tarball response bytes must be positive` };
    }
    if (response.total < response.packumentDecoded + response.tarball) {
      return {
        error: `${label} responseBodyBytes.total is smaller than packumentDecoded + tarball`,
      };
    }
    responseBodyBytes = {
      packumentDecoded: response.packumentDecoded,
      tarball: response.tarball,
      total: response.total,
    };
  } else {
    const fields = ['bundle', 'total'];
    if (!exactResponseFields(response, fields)) {
      return { error: `${label} Eddy responseBodyBytes must contain exactly bundle, total` };
    }
    for (const field of fields) {
      if (!nonNegativeSafeInteger(response[field])) {
        return { error: `${label} responseBodyBytes.${field} must be a non-negative safe integer` };
      }
    }
    if (response.bundle === 0) {
      return { error: `${label} Eddy bundle response bytes must be positive` };
    }
    if (response.total < response.bundle) {
      return { error: `${label} responseBodyBytes.total is smaller than bundle` };
    }
    responseBodyBytes = { bundle: response.bundle, total: response.total };
  }

  const transport = run.transport;
  if (!plainRecord(transport) || transport.mode !== 'auto' || !plainRecord(transport.origins)) {
    return { error: `${label} transport must contain mode auto and an origins record` };
  }
  const origins = {};
  let usedOrigins = 0;
  for (const [origin, evidence] of Object.entries(transport.origins)) {
    if (remoteOrigin(origin) === null)
      return { error: `${label} transport origin is invalid: ${origin}` };
    if (!plainRecord(evidence) || !nonNegativeSafeInteger(evidence.requests)) {
      return { error: `${label} transport evidence for ${origin} has invalid requests` };
    }
    if (typeof evidence.protocol !== 'string' || evidence.protocol.length === 0) {
      return { error: `${label} transport evidence for ${origin} has no protocol` };
    }
    if (evidence.requests > 0) {
      usedOrigins += 1;
      if (!positiveProtocol(evidence.protocol)) {
        return {
          error: `${label} used origin ${origin} lacks positive protocol evidence (${evidence.protocol})`,
        };
      }
    }
    origins[origin] = { protocol: evidence.protocol, requests: evidence.requests };
  }
  if (usedOrigins === 0) return { error: `${label} has no used remote origin` };

  return {
    value: {
      durationMs: run.durationMs,
      requiredSetDigest: run.requiredSetDigest,
      storageClass: run.storageClass,
      fillTransport: run.fillTransport,
      fillCache: run.fillCache,
      memberBytes: run.memberBytes,
      responseBodyBytes,
      transport: { mode: 'auto', origins },
    },
  };
}

function buildShadowAssetColdRow(input, expectedFillTransport, stepMs, label) {
  if (!plainRecord(input) || input.status !== 'measured') {
    const note =
      plainRecord(input) && typeof input.note === 'string' && input.note.length > 0
        ? input.note
        : `${label} was not measured`;
    return shadowAssetUnmeasured(note);
  }
  if (!Array.isArray(input.runs) || input.runs.length !== SHADOW_ASSET_RUN_COUNT) {
    return shadowAssetUnmeasured(
      `${label} requires exactly ${SHADOW_ASSET_RUN_COUNT} complete runs; received ${Array.isArray(input.runs) ? input.runs.length : 0}`,
    );
  }
  if (input.cacheRegime !== SHADOW_ASSET_CACHE_REGIME) {
    return shadowAssetUnmeasured(`${label} cacheRegime must be ${SHADOW_ASSET_CACHE_REGIME}`);
  }
  const registry = registryOrigin(input.registryUrl);
  if (registry === null) {
    return shadowAssetUnmeasured(`${label} registryUrl must be an absolute http(s) URL`);
  }
  const expectedFillCache = expectedFillTransport === 'standard' ? 'network' : 'bundle';
  let measuredOrigins;
  if (expectedFillTransport === 'standard') {
    measuredOrigins = new Set([registry]);
  } else {
    const resolver = endpointOrigin(input.resolverUrl);
    if (resolver === null) {
      return shadowAssetUnmeasured(`${label} resolverUrl must be an absolute http(s) URL`);
    }
    const bundle = input.bundleUrl === undefined ? resolver : endpointOrigin(input.bundleUrl);
    if (bundle === null) {
      return shadowAssetUnmeasured(`${label} bundleUrl must be an absolute http(s) URL`);
    }
    measuredOrigins = new Set([resolver, bundle]);
  }
  const runs = [];
  for (const [index, raw] of input.runs.entries()) {
    const normalized = normalizedShadowAssetRun(
      raw,
      index,
      expectedFillTransport,
      expectedFillCache,
    );
    if (normalized.error) return shadowAssetUnmeasured(normalized.error);
    runs.push(normalized.value);
  }

  const first = runs[0];
  if (!first) return shadowAssetUnmeasured(`${label} has no complete run`);
  for (const [index, run] of runs.entries()) {
    if (run.requiredSetDigest !== first.requiredSetDigest) {
      return shadowAssetUnmeasured(`${label} run ${index + 1} has a mixed required-set digest`);
    }
    if (run.storageClass !== first.storageClass) {
      return shadowAssetUnmeasured(`${label} run ${index + 1} has a mixed storage class`);
    }
    const usedMeasuredOrigin = [...measuredOrigins].some(
      (origin) => (run.transport.origins[origin]?.requests ?? 0) > 0,
    );
    if (!usedMeasuredOrigin) {
      return shadowAssetUnmeasured(
        expectedFillTransport === 'standard'
          ? `${label} run ${index + 1} has no measured request for registry origin ${registry}`
          : `${label} run ${index + 1} has no measured request for a configured Eddy origin`,
      );
    }
  }

  const summary = summarize(
    runs.map((run) => run.durationMs),
    stepMs,
  );
  return {
    ...summary,
    requiredSetDigest: first.requiredSetDigest,
    storageClass: first.storageClass,
    fillTransport: expectedFillTransport,
    fillCache: expectedFillCache,
    memberBytes: SHADOW_ASSET_MEMBER_BYTES,
    registryUrl: input.registryUrl,
    ...(typeof input.resolverUrl === 'string' && input.resolverUrl.length > 0
      ? { resolverUrl: input.resolverUrl }
      : {}),
    ...(typeof input.bundleUrl === 'string' && input.bundleUrl.length > 0
      ? { bundleUrl: input.bundleUrl }
      : {}),
    cacheRegime: SHADOW_ASSET_CACHE_REGIME,
    runs,
  };
}

function matchedShadowAssetColdRows(standard, eddy) {
  return (
    standard.status === 'measured' &&
    eddy.status === 'measured' &&
    standard.count === SHADOW_ASSET_RUN_COUNT &&
    eddy.count === SHADOW_ASSET_RUN_COUNT &&
    standard.requiredSetDigest === eddy.requiredSetDigest &&
    standard.storageClass === eddy.storageClass &&
    standard.memberBytes === eddy.memberBytes &&
    standard.cacheRegime === eddy.cacheRegime
  );
}

function uniformShadowAssetColdBoundary(input) {
  if (
    !plainRecord(input) ||
    input.status !== 'measured' ||
    input.cacheRegime === undefined ||
    !Array.isArray(input.runs) ||
    input.runs.length !== SHADOW_ASSET_RUN_COUNT
  ) {
    return null;
  }
  const first = input.runs[0];
  if (!plainRecord(first)) return null;
  const boundary = {
    requiredSetDigest: first.requiredSetDigest,
    storageClass: first.storageClass,
    memberBytes: first.memberBytes,
    cacheRegime: input.cacheRegime,
  };
  if (
    input.runs.some(
      (run) =>
        !plainRecord(run) ||
        run.requiredSetDigest !== boundary.requiredSetDigest ||
        run.storageClass !== boundary.storageClass ||
        run.memberBytes !== boundary.memberBytes,
    )
  ) {
    return null;
  }
  return boundary;
}

function refuseUnmatchedEddyBoundary(standard, eddy, standardInput, eddyInput) {
  if (standard.status !== 'measured') return eddy;
  const standardBoundary = uniformShadowAssetColdBoundary(standardInput);
  const eddyBoundary = uniformShadowAssetColdBoundary(eddyInput);
  if (standardBoundary === null || eddyBoundary === null) return eddy;
  const mismatches = ['requiredSetDigest', 'storageClass', 'memberBytes', 'cacheRegime'].filter(
    (field) => standardBoundary[field] !== eddyBoundary[field],
  );
  return mismatches.length === 0
    ? eddy
    : shadowAssetUnmeasured(
        `Eddy shadow asset cold row does not match the measured standard boundary: ${mismatches.join(', ')}`,
      );
}

function buildShadowAssetColdMetric(input, stepMs) {
  const standardInput =
    plainRecord(input) && Object.hasOwn(input, 'standard')
      ? input.standard
      : { status: 'unmeasured', note: '--shadow-asset-cold off' };
  const standard = buildShadowAssetColdRow(
    standardInput,
    'standard',
    stepMs,
    'shadow asset cold standard row',
  );
  const metric = { standard };
  if (plainRecord(input) && input.eddy !== undefined) {
    const eddy = refuseUnmatchedEddyBoundary(
      standard,
      buildShadowAssetColdRow(input.eddy, 'eddy', stepMs, 'shadow asset cold Eddy row'),
      standardInput,
      input.eddy,
    );
    metric.eddy = eddy;
    if (matchedShadowAssetColdRows(standard, eddy)) {
      metric.speedupX = Math.round((standard.median / eddy.median) * 100) / 100;
    }
  }
  return metric;
}

/**
 * Assemble the committed benchmark artifact. `coldStartSamples` is always
 * measured; `install` is either a measured record or a non-measured one
 * (`{ status: 'requires proxy' }` / `{ status: 'unmeasured', note }`). The
 * install number is ALWAYS recorded — measured or an explicit non-measured
 * status, never silently skipped (the item's CI contract).
 *
 * A measured `install` carries the PRIMARY path's `samples` (standard when no
 * resolver, eddy when one is configured) + `registryUrl`. When an eddy pass ran
 * against a standard baseline it also carries `resolverUrl` + `baselineSamples`;
 * the artifact then nests the standard baseline under `baseline` and records the
 * measured `speedupX` (baseline median ÷ eddy median). ONE number can't lie
 * about the other: both sample sets are kept verbatim.
 */
export function buildArtifact({
  generatedAt,
  runs,
  coldStartSamples,
  install,
  presetBoot,
  shadowAssetCold,
  stepMs = DEFAULT_STEP_MS,
}) {
  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt,
    runner: { runs, browser: 'chromium', headless: true },
    metrics: {
      coldStartToInteractiveMs: summarize(coldStartSamples, stepMs),
      npmInstallToFirstViteResponseMs: buildInstallMetric(install, stepMs),
      shadowAssetColdFillMs: buildShadowAssetColdMetric(shadowAssetCold, stepMs),
      ...(presetBoot !== undefined
        ? { presetBootToPreviewLiveMs: buildPresetBootMetric(presetBoot, stepMs, runs) }
        : {}),
    },
  };
}

/**
 * Instant-preset pick→preview-live (schema v2; no npm install in the path).
 * `presetBoot` is either `{ status, note }` (phase skipped — recorded, never
 * silent) or per-preset records: measured `{ presetId, samples, stageRuns }` or
 * `{ presetId, status: 'unmeasured', note }`. A stage absent in ANY run
 * aggregates to null — a thin stage median would claim attribution it lacks.
 * The CORE enforces completeness (not just the harness): a sample/stage set
 * shorter than `runs` degrades to `unmeasured` — never a thin median.
 */
function buildPresetBootMetric(presetBoot, stepMs, runs) {
  if (!Array.isArray(presetBoot)) {
    return { status: presetBoot.status, ...(presetBoot.note ? { note: presetBoot.note } : {}) };
  }
  return presetBoot.map((p) => {
    if (p.status === 'unmeasured') {
      return { presetId: p.presetId, status: 'unmeasured', note: p.note };
    }
    if (p.samples.length !== runs || p.stageRuns.length !== runs) {
      return {
        presetId: p.presetId,
        status: 'unmeasured',
        note: `partial sample set: ${p.samples.length}/${runs} samples, ${p.stageRuns.length}/${runs} stage runs — refusing a thin median`,
      };
    }
    return {
      presetId: p.presetId,
      ...summarize(p.samples, stepMs),
      stages: medianStages(p.stageRuns),
    };
  });
}

function medianStages(stageRuns) {
  const keys = [...new Set(stageRuns.flatMap((s) => Object.keys(s)))];
  const out = {};
  for (const key of keys) {
    const vals = stageRuns.map((s) => s[key]).filter((v) => typeof v === 'number');
    out[key] = vals.length === stageRuns.length ? median(vals) : null;
  }
  return out;
}

/**
 * Verify per-run transport evidence against the pinned transport
 * (docs/backlog/perf/eddy-http3-cold-validation). One record per run:
 * `{ origin: { protocol, requests } }` — `protocol` from the post-window CDP
 * probe ('h2' | 'h3' | 'http/1.1' | 'unreachable' | 'unknown'), `requests` =
 * how many measured-window requests actually hit that origin. A pass whose
 * evidence contradicts its pin is REFUSED — a silently-fallen-back h3 pass
 * would quote an h2 number as h3:
 *   'auto' → always ok (evidence recorded, nothing pinned);
 *   'h3'   → every USED origin (requests > 0) must positively probe 'h3';
 *   'h2'   → every USED origin must positively probe 'h2' — 'http/1.1' refuses
 *            too (the artifact labels the leg h2; an h1 fallback would
 *            misrepresent the h2-vs-h3 comparison), as does
 *            'unreachable'/'unknown' (not proof).
 * Unused origins (requests 0 — e.g. the eddy host during the standard
 * baseline) are recorded, never enforced. The proof is PER RUN: a pinned run
 * in which NO measured origin saw a request verifies nothing (probe-only) and
 * refuses — one well-evidenced run must not vouch for another. A pin with no
 * evidence at all is refused (nothing was ever probed).
 */
export function verifyTransportPin(mode, runProtocols) {
  if (mode === 'auto') return { ok: true };
  if (runProtocols.length === 0) {
    return {
      ok: false,
      note: `transport pinned to ${mode} but no protocol evidence was collected`,
    };
  }
  const positive = mode === 'h3' ? 'h3' : 'h2';
  const violations = [];
  for (const [i, run] of runProtocols.entries()) {
    let usedInRun = 0;
    for (const [origin, evidence] of Object.entries(run)) {
      if (evidence.requests === 0) continue;
      usedInRun += 1;
      if (evidence.protocol !== positive) {
        violations.push(`${origin} observed ${evidence.protocol}`);
      }
    }
    if (usedInRun === 0) {
      violations.push(
        `run ${i + 1} made no measured-window request to any measured origin — the pin would verify vacuously (probe-only)`,
      );
    }
  }
  if (violations.length === 0) return { ok: true };
  return {
    ok: false,
    note: `transport pinned to ${mode} but ${[...new Set(violations)].join('; ')} — refusing the pass`,
  };
}

/**
 * Eddy bench pass proof: resolverUrl configured is not enough. The installer
 * auto-falls back to the standard path on any resolver decline/failure, and the
 * preview can still go live. Only the terminal line emitted from
 * `result.source === 'eddy'` proves the measured run used the fast path.
 */
export function verifyEddyInstallProof(terminalText) {
  return /via eddy \(fast\)/.test(terminalText)
    ? { ok: true }
    : {
        ok: false,
        note: 'eddy pass reached first Vite response without terminal proof `via eddy (fast)`',
      };
}

function buildInstallMetric(install, stepMs) {
  if (!install || install.status !== 'measured') {
    // Non-measured is still RECORDED (never silently skipped): `requires proxy`
    // when no proxy is configured, or `unmeasured` + a note when a proxy was
    // set but install didn't reach first Vite response.
    const record = { status: install?.status ?? 'requires proxy' };
    if (install?.note) record.note = install.note;
    if (install?.transport) record.transport = install.transport;
    if (install?.transportMatrix) {
      record.transportMatrix = buildTransportMatrixMetric(install.transportMatrix, stepMs);
    }
    return record;
  }
  const summary = summarize(install.samples, stepMs);
  if (install.registryUrl) summary.registryUrl = install.registryUrl;
  if (install.resolverUrl) summary.resolverUrl = install.resolverUrl;
  if (install.transport) summary.transport = install.transport;
  // An eddy pass with a standard baseline: nest the baseline + the measured
  // speedup (baseline median ÷ eddy median, 2 d.p.). No baseline → standard-only
  // run, top-level samples ARE the standard number.
  if (install.baselineSamples && install.baselineSamples.length > 0) {
    const baseline = summarize(install.baselineSamples, stepMs);
    baseline.label = 'standard';
    if (install.baselineTransport) baseline.transport = install.baselineTransport;
    summary.baseline = baseline;
    summary.speedupX = Math.round((baseline.median / summary.median) * 100) / 100;
  }
  if (install.transportMatrix) {
    summary.transportMatrix = buildTransportMatrixMetric(install.transportMatrix, stepMs);
  }
  return summary;
}

function buildTransportMatrixMetric(matrix, stepMs) {
  const out = {};
  for (const [mode, phases] of Object.entries(matrix)) {
    const row = {};
    if (phases.standard) row.standard = buildInstallPhaseMetric(phases.standard, stepMs);
    if (phases.eddy) row.eddy = buildInstallPhaseMetric(phases.eddy, stepMs);
    if (row.standard?.status === 'measured' && row.eddy?.status === 'measured') {
      row.speedupX = Math.round((row.standard.median / row.eddy.median) * 100) / 100;
    }
    out[mode] = row;
  }
  return out;
}

function buildInstallPhaseMetric(phase, stepMs) {
  if (phase.status !== 'measured') {
    const out = { status: phase.status };
    if (phase.note) out.note = phase.note;
    if (phase.registryUrl) out.registryUrl = phase.registryUrl;
    if (phase.resolverUrl) out.resolverUrl = phase.resolverUrl;
    if (phase.transport) out.transport = phase.transport;
    return out;
  }
  const out = summarize(phase.samples, stepMs);
  if (phase.registryUrl) out.registryUrl = phase.registryUrl;
  if (phase.resolverUrl) out.resolverUrl = phase.resolverUrl;
  if (phase.transport) out.transport = phase.transport;
  return out;
}
