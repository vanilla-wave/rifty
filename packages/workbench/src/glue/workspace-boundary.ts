import { normalizePath } from '@riftydev/vfs';

const MAX_WORKSPACE_ID_LENGTH = 256;

export function validateWorkspaceId(value: unknown, field: string): string {
  if (
    typeof value !== 'string' ||
    value.trim().length === 0 ||
    value.length > MAX_WORKSPACE_ID_LENGTH ||
    value.includes('\0')
  ) {
    throw new TypeError(`${field} must be a non-empty string of at most 256 characters`);
  }
  try {
    encodeURIComponent(value);
  } catch {
    throw new TypeError(`${field} must be a well-formed Unicode string`);
  }
  return value;
}

export function workspaceIdPathSegment(workspaceId: string, field: string): string {
  const encoded = encodeURIComponent(validateWorkspaceId(workspaceId, field));
  if (encoded === '.') return '%2E';
  if (encoded === '..') return '%2E%2E';
  return encoded;
}

export function validateWorkspaceRoot(value: unknown, field: string): string {
  if (
    typeof value !== 'string' ||
    !value.startsWith('/') ||
    value.includes('\0') ||
    normalizePath(value) !== value
  ) {
    throw new TypeError(`${field} must be a normalized absolute VFS path`);
  }
  if (value === '/' || value === '/.rifty' || value.startsWith('/.rifty/')) {
    throw new TypeError(`${field} uses a reserved profile metadata path`);
  }
  return value;
}
