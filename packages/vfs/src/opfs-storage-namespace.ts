import { VfsError } from './errors.ts';
import { mapOpfsError } from './opfs-errors.ts';

declare const navigator: { storage?: { getDirectory(): Promise<FileSystemDirectoryHandle> } };

const SEGMENT = /^[A-Za-z0-9._-]+$/;
const INVALID =
  'storage.namespace must be a relative OPFS path of one or more [A-Za-z0-9._-]+ segments';

export function parseOpfsStorageNamespace(value: unknown): readonly string[] | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new TypeError(INVALID);
  if (
    value.length === 0 ||
    value.includes('\\') ||
    value.startsWith('/') ||
    value.endsWith('/') ||
    value.includes('//')
  ) {
    throw new TypeError(INVALID);
  }
  const parts = value.split('/');
  for (const part of parts) {
    if (part === '.' || part === '..' || !SEGMENT.test(part)) throw new TypeError(INVALID);
  }
  return parts;
}

export async function resolveOpfsStorageRoot(
  namespace?: string,
): Promise<FileSystemDirectoryHandle> {
  const parts = parseOpfsStorageNamespace(namespace);
  if (typeof navigator === 'undefined' || !navigator.storage?.getDirectory) {
    throw new VfsError('EPERM', '/', 'OPFS navigator.storage.getDirectory unavailable');
  }
  const origin = await navigator.storage.getDirectory();
  if (!origin) throw new VfsError('EPERM', '/', 'OPFS getDirectory returned undefined');
  if (parts === undefined) return origin;
  let dir = origin;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i] as string;
    try {
      dir = await dir.getDirectoryHandle(part, { create: true });
    } catch (err) {
      throw mapOpfsError(err, `/${parts.slice(0, i + 1).join('/')}`, 'dir');
    }
  }
  return dir;
}
