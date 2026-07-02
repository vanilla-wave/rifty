// The `?preset=<id>&autorun=1` deep-link: a shareable launch URL that boots
// straight into a preset, and the seam the perf harness drives to measure
// cold-start + npm-install (docs/backlog/perf/cold-start-and-install-benchmark).
// Pure — maps a query string to the intent; the <id> is validated against the
// preset registry at apply time, not here.
export interface PresetDeepLink {
  /** Preset id requested in the URL, or undefined if none/empty. */
  presetId: string | undefined;
  /** Run the preset's boot lines automatically (only meaningful with a preset). */
  autorun: boolean;
}

export function parsePresetDeepLink(search: string): PresetDeepLink {
  const params = new URLSearchParams(search);
  const raw = params.get('preset');
  const presetId = raw !== null && raw.length > 0 ? raw : undefined;
  const autorun = presetId !== undefined && isTruthy(params.get('autorun'));
  return { presetId, autorun };
}

function isTruthy(value: string | null): boolean {
  return value === '1' || value === 'true';
}

// agent-bench hook: external validation harness only. Not public API.
// `?agentBench=1` (ADR-0191) gates the `globalThis.__riftyAgentBench`
// observation namespace; without the flag the namespace is absent entirely.
export function parseAgentBenchFlag(search: string): boolean {
  return isTruthy(new URLSearchParams(search).get('agentBench'));
}
