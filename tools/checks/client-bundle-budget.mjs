/**
 * CI-only packed JS ceilings; min bytes / sum of separately gzipped chunks.
 * 2026-09-07, Node24.16/esbuild0.28/Chromium148, accepted I4 @974cc355e:
 * artifact    cleaned min/gzip     historical leak min/gzip
 * main          56861/18033          103660/30188   (io)
 * sw            14056/4828            63105/18467   (io)
 * generic      725778/213598        4311637/1245917 (TypeScript)
 * toolchain    796895/236199        4568192/1326387 (TypeScript)
 * Ceilings: cleaned ×1.5 rounded up to 1000 B; every leak crosses both.
 * Bumps require remeasurement + cause here in the same PR. Absolute caps:
 * cumulative small growth can cross one; this is not a shrink-only ratchet.
 * Raw reports/requests: docs/backlog/toolchain-build/reference/client-bundle-budget-evidence.json.
 */
export const CLIENT_BUNDLE_BUDGETS = {
  main: { min: 86_000, gzip: 28_000 },
  sw: { min: 22_000, gzip: 8_000 },
  generic: { min: 1_089_000, gzip: 321_000 },
  toolchain: { min: 1_196_000, gzip: 355_000 },
};

/** The report must already include all readiness-joined JS requests. */
export function assertClientBundleBudgets(report, boot) {
  const failures = [];
  for (const [name, limits] of Object.entries(CLIENT_BUNDLE_BUDGETS)) {
    const matches = report.rows.filter((row) => row.name === name);
    if (matches.length !== 1) {
      failures.push(`${name}: expected one artifact, got ${matches.length}`);
      continue;
    }
    const row = matches[0];
    for (const [metric, ceiling] of Object.entries(limits)) {
      const bytes = row[metric];
      if (!Number.isSafeInteger(bytes) || bytes <= 0)
        failures.push(`${name}: invalid ${metric} byte count ${bytes}`);
      else if (bytes > ceiling) failures.push(`${name}: ${metric} ${bytes} B exceeds ${ceiling} B`);
    }
    if (!['generic', 'toolchain'].includes(name)) continue;
    if (!Array.isArray(row.compiler) || row.compiler.length === 0)
      failures.push(`${name}: missing compiler provenance`);
    else if (row.compiler.some((path) => row.eager.includes(path)))
      failures.push(`${name}: TypeScript compiler in eager graph`);
    const observations = boot.rows.filter((observation) => observation.name === name);
    if (observations.length === 0) failures.push(`${name}: missing browser boot observation`);
    const observedJs = new Set(
      observations.flatMap((observation) =>
        observation.requests.filter((path) => path.endsWith('.js')),
      ),
    );
    for (const path of observedJs) {
      if (!row.eager.includes(path)) failures.push(`${name}: unaccounted boot JS ${path}`);
    }
  }
  if (failures.length) throw new Error(`Client bundle budget failed:\n${failures.join('\n')}`);
}
