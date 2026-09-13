import { type FsSync, OpfsPreloadError } from '@riftydev/vfs';
import type { OpfsLayoutIssue } from '@riftydev/vfs/internal';
const DIAGNOSIS = '/.rifty/workbench/v2/storage-layout.json';
const LEGACY =
  'Projects saved with legacy per-file OPFS v1 were not carried over. This includes edited source, npm installs, cloned repositories and Git history. Old native bytes remain until storage is cleared.';
const CORRUPT =
  'Stored project data was corrupt and was not restored. Projects are recreated from their definitions.';

/** Metadata only: legacy bytes never enter the current project image. */
export async function hasNativeLegacyLayout(root: FileSystemDirectoryHandle): Promise<boolean> {
  try {
    let directory = root;
    for (const name of ['.rifty', 'workbench', 'v1'])
      directory = await directory.getDirectoryHandle(name);
    return true;
  } catch (error) {
    if (
      error instanceof DOMException &&
      (error.name === 'NotFoundError' || error.name === 'TypeMismatchError')
    )
      return false;
    throw new OpfsPreloadError(error);
  }
}
/** Both mutations precede the drain microtask; its first HEAD carries the diagnosis. */
export function captureStorageCorruption(fs: FsSync, issue: OpfsLayoutIssue | undefined): void {
  if (issue?.kind !== 'corrupt') return;
  fs.mkdirSync('/.rifty/workbench/v2', { recursive: true });
  fs.writeFileSync(DIAGNOSIS, new TextEncoder().encode('{"version":1,"kind":"corrupt"}'));
}
export function storageLayoutSummary(fs: FsSync, legacy: boolean): string | undefined {
  let corrupt = false;
  try {
    if (fs.existsSync(DIAGNOSIS)) {
      const record: unknown = JSON.parse(
        new TextDecoder('utf-8', { fatal: true }).decode(fs.readFileBytesSync(DIAGNOSIS)),
      );
      if (
        record === null ||
        typeof record !== 'object' ||
        Array.isArray(record) ||
        Object.keys(record).sort().join(',') !== 'kind,version' ||
        (record as Record<string, unknown>).version !== 1 ||
        (record as Record<string, unknown>).kind !== 'corrupt'
      )
        throw new Error('Invalid persisted storage-layout diagnosis');
      corrupt = true;
    }
  } catch (cause) {
    throw new OpfsPreloadError(cause);
  }
  const parts = [...(corrupt ? [CORRUPT] : []), ...(legacy ? [LEGACY] : [])];
  return parts.length === 0 ? undefined : parts.join(' ');
}
