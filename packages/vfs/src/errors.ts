import type { VfsErrorCode } from './types.ts';

export class VfsError extends Error {
  readonly code: VfsErrorCode;
  readonly path: string;

  constructor(code: VfsErrorCode, path: string, message?: string, options?: { cause?: unknown }) {
    super(message ?? `${code}: ${path}`, options);
    this.name = 'VfsError';
    this.code = code;
    this.path = path;
  }
}

/**
 * Standard error thrown when a feature is intentionally not implemented yet
 * (so the gap is loud, not silent). The `feature` argument should follow
 * `module.method` form (e.g. `'OpfsFsSync.readdirSync'`).
 *
 * Mirrors the `@riftydev/io` `NotImplementedError` shape but lives in `@riftydev/vfs`
 * to keep this layer free of upward dependencies (vfs is below io in the
 * layer diagram; see CLAUDE.md "Hard rules → Architecture").
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
