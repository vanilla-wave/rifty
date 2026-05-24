/**
 * Standard error thrown when a feature is intentionally not implemented yet
 * (so the gap is loud, not silent). The `feature` argument should follow
 * `module.method` form (e.g. `'fs.watch'`).
 */
export class NotImplementedError extends Error {
  readonly feature: string;

  constructor(feature: string, hint?: string) {
    const detail = hint ? ` (${hint})` : '';
    super(`Not implemented: ${feature}${detail}`);
    this.name = 'NotImplementedError';
    this.feature = feature;
  }
}
