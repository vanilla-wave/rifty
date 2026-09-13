/**
 * CI-only packed JS ceilings; min bytes / sum of separately gzipped chunks.
 * 2026-09-13, Node24.16/esbuild0.28/Chromium148, merged main @db50e46b2:
 * Rebaseline after segmented OPFS and SDK/toolchain growth (PR #299 follow-up).
 * User accepted renewed 50% headroom; preserve lazy default-vfs entry/provenance.
 * artifact    cleaned min/gzip    reintroduced io/compiler leak min/gzip
 * main        85184/26630      140987/42351
 * sw          15220/5327       70693/20898
 * generic     748921/220937     4301313/1242200
 * toolchain   855453/256720     4407688/1277813
 * Ceilings: cleaned ×1.5 rounded up to 1000 B; every remeasured leak crosses both.
 * The original 2026-09-07 main leak is now below the main cap; today's equivalent
 * leak is remeasured, while the independent SDK io-provenance guard stays intact.
 * Bumps require remeasurement + cause here in the same PR. Absolute caps:
 * cumulative small growth can cross one; this is not a shrink-only ratchet.
 * Raw reports/requests: docs/backlog/toolchain-build/reference/client-bundle-budget-evidence.json.
 */
export const CLIENT_BUNDLE_BUDGETS = {
  main: { min: 128_000, gzip: 40_000 },
  sw: { min: 23_000, gzip: 8_000 },
  generic: { min: 1_124_000, gzip: 332_000 },
  toolchain: { min: 1_284_000, gzip: 386_000 },
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
