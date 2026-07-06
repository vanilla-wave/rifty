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
 * Validate an `openReadable` window (shared by MemoryVfs and OPFS
 * `chunkedFileStream`). Loud RangeErrors instead of the old silent traps:
 * `chunkSize: 0` looped the pull callback forever (reader hang) and a negative
 * `start` fell into `subarray`'s from-the-end semantics (review 2026-07-05).
 */
export function assertReadWindow(opts?: {
  chunkSize?: number;
  start?: number;
  end?: number;
}): void {
  const { chunkSize, start, end } = opts ?? {};
  if (chunkSize !== undefined && (!Number.isInteger(chunkSize) || chunkSize <= 0)) {
    throw new RangeError(`openReadable chunkSize must be a positive integer; got ${chunkSize}`);
  }
  for (const [name, value] of [
    ['start', start],
    ['end', end],
  ] as const) {
    if (value !== undefined && (!Number.isInteger(value) || value < 0)) {
      throw new RangeError(`openReadable ${name} must be a non-negative integer; got ${value}`);
    }
  }
  if (start !== undefined && end !== undefined && end < start) {
    throw new RangeError(`openReadable window is inverted: start ${start} > end ${end}`);
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
