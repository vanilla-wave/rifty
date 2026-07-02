/**
 * Local copy of the repo's loud-gap error convention (packages/io/src/errors.ts).
 * The bench is a workspace tool and must never import product packages just for
 * an error class (ADR-0191: never product API).
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
