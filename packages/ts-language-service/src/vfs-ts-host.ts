/**
 * FsSync → TypeScript host primitives, shared by the config parser
 * ({@link vfsReadDirectory} for `ParseConfigHost.readDirectory`), the language
 * service host, and the module resolver. One place so the three TS host shapes
 * agree on how the VFS is read (UTF-8 decode, dirent split, glob expansion).
 */

import type { FsSync } from '@riftydev/vfs';
import ts from 'typescript';

const decoder = new TextDecoder('utf-8', { fatal: false });
type TypeScriptApi = typeof ts;

/** Decode VFS bytes as UTF-8; `undefined` on a missing/unreadable file. */
export function readFileUtf8(fsSync: FsSync, fileName: string): string | undefined {
  const stat = fsSync.statSyncOrNull(fileName);
  if (!stat?.isFile) return undefined;
  return decoder.decode(fsSync.readFileBytesSync(fileName));
}

export function fileExists(fsSync: FsSync, fileName: string): boolean {
  return fsSync.statSyncOrNull(fileName)?.isFile === true;
}

export function directoryExists(fsSync: FsSync, dirName: string): boolean {
  return fsSync.statSyncOrNull(dirName)?.isDirectory === true;
}

/** Immediate child directory names → absolute paths (TS `getDirectories`). */
export function getDirectories(fsSync: FsSync, dirName: string): string[] {
  if (!directoryExists(fsSync, dirName)) return [];
  return fsSync
    .readdirSync(dirName)
    .filter((d) => d.isDirectory)
    .map((d) => `${dirName === '/' ? '' : dirName}/${d.name}`);
}

/**
 * `getFileSystemEntries` for {@link ts.matchFiles}: immediate child *names*
 * split into files vs directories (matchFiles re-joins them with the dir).
 */
function getFileSystemEntries(
  fsSync: FsSync,
  path: string,
): {
  readonly files: readonly string[];
  readonly directories: readonly string[];
} {
  if (!directoryExists(fsSync, path)) return { files: [], directories: [] };
  const files: string[] = [];
  const directories: string[] = [];
  for (const d of fsSync.readdirSync(path)) {
    if (d.isFile) files.push(d.name);
    else if (d.isDirectory) directories.push(d.name);
  }
  return { files, directories };
}

/**
 * `ts.matchFiles` is the exact include/exclude/depth glob algorithm tsc uses to
 * expand a tsconfig's file set — reusing it (vs hand-rolling glob matching) is
 * what keeps our file discovery faithful to real tsc (parity gold standard).
 * It is a stable-but-internal API (present at runtime, absent from the public
 * `.d.ts`), so we declare the one signature we call here. See ADR-0166.
 */
type MatchFiles = (
  path: string,
  extensions: readonly string[] | undefined,
  excludes: readonly string[] | undefined,
  includes: readonly string[] | undefined,
  useCaseSensitiveFileNames: boolean,
  currentDirectory: string,
  depth: number | undefined,
  getFileSystemEntries: (path: string) => {
    readonly files: readonly string[];
    readonly directories: readonly string[];
  },
  realpath: (path: string) => string,
) => string[];

/** `ParseConfigHost.readDirectory` over the VFS, via tsc's own matcher. */
export function vfsReadDirectory(
  fsSync: FsSync,
  rootDir: string,
  extensions: readonly string[],
  excludes: readonly string[] | undefined,
  includes: readonly string[],
  depth: number | undefined,
  tsApi: TypeScriptApi = ts,
): readonly string[] {
  const activeMatchFiles = (tsApi as unknown as { matchFiles: MatchFiles }).matchFiles;
  return activeMatchFiles(
    rootDir,
    extensions,
    excludes,
    includes,
    /* useCaseSensitiveFileNames */ true,
    rootDir,
    depth,
    (p) => getFileSystemEntries(fsSync, p),
    (p) => p,
  );
}
