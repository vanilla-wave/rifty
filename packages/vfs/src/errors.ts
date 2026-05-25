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
