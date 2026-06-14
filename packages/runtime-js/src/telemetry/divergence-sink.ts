// In-process divergence / NotImplemented telemetry sink.
// Leaf module: no deps, no network, no persistence. Session-scoped, dev-only.
// Backlog: playground/notimplemented-stub-telemetry. T15 wires boundary capture,
// T16 surfaces it in the playground (may persist via localStorage — sink stays pure).

/** A kind of telemetry hit. `divergence` = behavior diverges from real Node
 * (e.g. rewrite-engine active); `not-implemented` = a NotImplementedError feature. */
export type TelemetryKind = 'not-implemented' | 'divergence';

/** One feature's aggregated hit count. */
export interface TelemetryEntry {
  feature: string;
  kind: TelemetryKind;
  count: number;
}

interface Cell {
  kind: TelemetryKind;
  count: number;
}

export interface RecordOptions {
  /** Return `true` only the FIRST time this feature is recorded (so a caller can
   * emit a one-time loud warning). `false` on every subsequent call. */
  warnOnce?: boolean;
}

// Map preserves insertion order → stable tie-break for equal counts.
const hits = new Map<string, Cell>();
const warned = new Set<string>();

function record(feature: string, kind: TelemetryKind, opts?: RecordOptions): boolean {
  const cell = hits.get(feature);
  if (cell) cell.count += 1;
  else hits.set(feature, { kind, count: 1 });

  if (!opts?.warnOnce) return false;
  if (warned.has(feature)) return false;
  warned.add(feature);
  return true;
}

/** Record a NotImplementedError feature hit. */
export function recordNotImplemented(feature: string, opts?: RecordOptions): boolean {
  return record(feature, 'not-implemented', opts);
}

/** Record a behavior-divergence hit. */
export function recordDivergence(feature: string, opts?: RecordOptions): boolean {
  return record(feature, 'divergence', opts);
}

/** Snapshot all hits, sorted by count desc; ties broken by insertion order (stable). */
export function snapshotTelemetry(): TelemetryEntry[] {
  return [...hits.entries()]
    .map(([feature, cell]) => ({ feature, kind: cell.kind, count: cell.count }))
    .sort((a, b) => b.count - a.count);
}

/** Clear all counts and the warned-set (for tests / session reset). */
export function resetTelemetry(): void {
  hits.clear();
  warned.clear();
}

/**
 * Boundary capture (T15): if `err` is a NotImplementedError, record its feature.
 *
 * Matched by `name === 'NotImplementedError'` NOT `instanceof` — `@riftydev/io`
 * and `@riftydev/vfs` each define their own `NotImplementedError` class, so a
 * single `instanceof` check would miss errors from the other package. The
 * `feature` field is preferred; falls back to the message. No-op for any other
 * value, so it is safe to call on every surfaced error at the worker boundary.
 */
export function captureNotImplemented(err: unknown): void {
  if (err instanceof Error && err.name === 'NotImplementedError') {
    const feature = (err as Error & { feature?: string }).feature ?? err.message;
    recordNotImplemented(feature);
  }
}
