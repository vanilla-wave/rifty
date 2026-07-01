/**
 * Pure aggregation for the cold-start / npm-install benchmark harness
 * (docs/backlog/perf/cold-start-and-install-benchmark). No I/O, no browser: the
 * testable core the RED-first unit suite pins. `../bench.mjs` feeds it the
 * measured samples and writes the JSON artifact.
 */

export const SCHEMA_VERSION = 2;
const DEFAULT_STEP_MS = 100;

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
  stepMs = DEFAULT_STEP_MS,
}) {
  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt,
    runner: { runs, browser: 'chromium', headless: true },
    metrics: {
      coldStartToInteractiveMs: summarize(coldStartSamples, stepMs),
      npmInstallToFirstViteResponseMs: buildInstallMetric(install, stepMs),
      ...(presetBoot !== undefined
        ? { presetBootToPreviewLiveMs: buildPresetBootMetric(presetBoot, stepMs) }
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
 */
function buildPresetBootMetric(presetBoot, stepMs) {
  if (!Array.isArray(presetBoot)) {
    return { status: presetBoot.status, ...(presetBoot.note ? { note: presetBoot.note } : {}) };
  }
  return presetBoot.map((p) => {
    if (p.status === 'unmeasured') {
      return { presetId: p.presetId, status: 'unmeasured', note: p.note };
    }
    return { presetId: p.presetId, ...summarize(p.samples, stepMs), stages: medianStages(p.stageRuns) };
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

function buildInstallMetric(install, stepMs) {
  if (!install || install.status !== 'measured') {
    // Non-measured is still RECORDED (never silently skipped): `requires proxy`
    // when no proxy is configured, or `unmeasured` + a note when a proxy was
    // set but install didn't reach first Vite response.
    const record = { status: install?.status ?? 'requires proxy' };
    if (install?.note) record.note = install.note;
    return record;
  }
  const summary = summarize(install.samples, stepMs);
  if (install.registryUrl) summary.registryUrl = install.registryUrl;
  if (install.resolverUrl) summary.resolverUrl = install.resolverUrl;
  // An eddy pass with a standard baseline: nest the baseline + the measured
  // speedup (baseline median ÷ eddy median, 2 d.p.). No baseline → standard-only
  // run, top-level samples ARE the standard number.
  if (install.baselineSamples && install.baselineSamples.length > 0) {
    const baseline = summarize(install.baselineSamples, stepMs);
    baseline.label = 'standard';
    summary.baseline = baseline;
    summary.speedupX = Math.round((baseline.median / summary.median) * 100) / 100;
  }
  return summary;
}
