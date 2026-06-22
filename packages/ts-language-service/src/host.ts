/**
 * `ts.LanguageServiceHost` backed by the rifty VFS, the parsed tsconfig, the
 * std-lib map and the open-document overlay. The host is fully synchronous —
 * the (async) lib load happens up front and the resolved {@link libMap} is
 * passed in.
 *
 * Lib serving: TS asks for the default lib plus every `lib` the options imply by
 * file name. `getDefaultLibFileName` hands back a synthetic `/ts-lib/<name>`
 * path, and TS resolves the `lib`-option files relative to that dir, so every
 * std-lib request arrives under `/ts-lib/`. `getScriptSnapshot`, `fileExists`
 * and `readFile` intercept paths under that dir and serve from {@link libMap}
 * (never touching the VFS) — that is how `Array`, `Promise`, DOM, etc. resolve,
 * without shadowing a project file whose basename happens to collide.
 */

import type { FsSync } from '@riftydev/vfs';
import ts from 'typescript';
import type { DocumentOverlay } from './overlay.ts';
import {
  directoryExists,
  fileExists,
  getDirectories,
  readFileUtf8,
  vfsReadDirectory,
} from './vfs-ts-host.ts';

/** Synthetic directory whose children are the std-lib `.d.ts` files. */
const LIB_DIR = '/ts-lib';

export interface VfsLanguageServiceHostDeps {
  readonly fsSync: FsSync;
  /** Project root (POSIX-absolute); `getCurrentDirectory`. */
  readonly projectRoot: string;
  readonly compilerOptions: ts.CompilerOptions;
  /** Root files of the program (from the parsed tsconfig). */
  readonly fileNames: readonly string[];
  /** Std-lib `.d.ts` by file name (e.g. `lib.es2024.d.ts` → contents). */
  readonly libMap: ReadonlyMap<string, string>;
  readonly overlay: DocumentOverlay;
  /**
   * Observer fired for each module literal resolved by
   * `resolveModuleNameLiterals` (`to` = the resolved file, or undefined on a
   * miss). Test/diagnostic seam; production wiring leaves it unset.
   */
  readonly onModuleResolved?: (
    name: string,
    containingFile: string,
    to: string | undefined,
  ) => void;
}

export function createVfsLanguageServiceHost(
  deps: VfsLanguageServiceHostDeps,
): ts.LanguageServiceHost {
  const { fsSync, projectRoot, compilerOptions, fileNames, libMap, overlay, onModuleResolved } =
    deps;

  /**
   * Lib contents if `fileName` is a std-lib file UNDER the synthetic `/ts-lib/`
   * dir, else undefined. Scoping to the dir (not bare basename) stops a project
   * file whose basename collides (e.g. `/proj/lib.dom.d.ts`) from being shadowed
   * by the std lib. TS asks for the default lib AND every `lib`-option file under
   * this dir (lib files resolve relative to `getDefaultLibFileName`'s directory).
   */
  const libContents = (fileName: string): string | undefined => {
    const i = fileName.lastIndexOf('/');
    if (i === -1 || fileName.slice(0, i) !== LIB_DIR) return undefined;
    return libMap.get(fileName.slice(i + 1));
  };

  /**
   * VFS-backed `ModuleResolutionHost` for `ts.resolveModuleName`. Lib files are
   * intercepted by basename so a `.d.ts` that imports a std-lib name still
   * resolves. `realpath` is identity — the Memory VFS has no symlinks.
   */
  const moduleResolutionHost: ts.ModuleResolutionHost = {
    fileExists: (fileName) => libContents(fileName) !== undefined || fileExists(fsSync, fileName),
    readFile: (fileName) => libContents(fileName) ?? readFileUtf8(fsSync, fileName),
    directoryExists: (dirName) => dirName === LIB_DIR || directoryExists(fsSync, dirName),
    getDirectories: (dirName) => getDirectories(fsSync, dirName),
    realpath: (p) => p,
    getCurrentDirectory: () => projectRoot,
    useCaseSensitiveFileNames: true,
  };

  // Shared across the program's resolutions so node_modules walks are cached
  // (and resolution is deterministic — the parity gold standard).
  const resolutionCache = ts.createModuleResolutionCache(
    projectRoot,
    (s) => s, // case-sensitive: canonical name is the name
    compilerOptions,
  );

  /**
   * VFS-derived version (content-independent change token): mtime+size. Changes
   * whenever the file is rewritten; `overlay.invalidate` covers the case where a
   * backend can't move mtime. Falls back to a content hash only if stat lacks
   * both (memory backend always provides them).
   */
  const vfsVersion = (fileName: string): string => {
    const stat = fsSync.statSyncOrNull(fileName);
    if (!stat?.isFile) return '0';
    if (stat.mtime !== undefined || stat.size !== undefined) {
      return `${stat.mtime ?? 0}:${stat.size ?? 0}`;
    }
    // No timestamps/size from the backend: hash the bytes (rare).
    const bytes = fsSync.readFileBytesSync(fileName);
    let h = 5381;
    for (let i = 0; i < bytes.length; i++) h = (h * 33) ^ (bytes[i] ?? 0);
    return `h${h >>> 0}`;
  };

  return {
    getCompilationSettings: () => compilerOptions,
    getCurrentDirectory: () => projectRoot,
    // Root files = the program's files plus any open buffer (an untitled/new
    // doc has no VFS entry yet but must still be type-checked).
    getScriptFileNames: () => [...new Set([...fileNames, ...overlay.openPaths()])],

    getDefaultLibFileName: (options) => `${LIB_DIR}/${ts.getDefaultLibFileName(options)}`,

    getScriptVersion: (fileName) => {
      // Open buffer wins. Once closed, the version reverts to the VFS token (so
      // TS re-reads disk) folded with the external-invalidation counter.
      const open = overlay.versionOf(fileName);
      if (open !== undefined) return open;
      if (libContents(fileName) !== undefined) return 'lib'; // libs are immutable
      return `${vfsVersion(fileName)}#${overlay.invalidationOf(fileName)}`;
    },

    getScriptSnapshot: (fileName) => {
      const opened = overlay.get(fileName);
      if (opened) return ts.ScriptSnapshot.fromString(opened.text);
      const lib = libContents(fileName);
      if (lib !== undefined) return ts.ScriptSnapshot.fromString(lib);
      const text = readFileUtf8(fsSync, fileName);
      return text === undefined ? undefined : ts.ScriptSnapshot.fromString(text);
    },

    fileExists: (fileName) => {
      if (overlay.get(fileName) !== undefined) return true;
      if (libContents(fileName) !== undefined) return true;
      return fileExists(fsSync, fileName);
    },

    readFile: (fileName) => {
      const opened = overlay.get(fileName);
      if (opened) return opened.text;
      const lib = libContents(fileName);
      if (lib !== undefined) return lib;
      return readFileUtf8(fsSync, fileName);
    },

    readDirectory: (path, extensions, exclude, include, depth) =>
      // include defaults to "*" — matchFiles requires a non-undefined include.
      vfsReadDirectory(
        fsSync,
        path,
        extensions ?? [],
        exclude,
        include ?? ['*'],
        depth,
      ) as string[],

    directoryExists: (dirName) => dirName === LIB_DIR || directoryExists(fsSync, dirName),

    getDirectories: (dirName) => getDirectories(fsSync, dirName),

    useCaseSensitiveFileNames: () => true,

    // Explicit, VFS-backed, mode-aware resolution. Mirrors what TS's internal
    // fallback would do — but pinned to the VFS host + shared cache, and never
    // able to slip through to ts.sys. Mode comes from getModeForUsageLocation so
    // nodenext import/require conditions resolve like real tsc.
    resolveModuleNameLiterals: (
      literals,
      containingFile,
      redirectedReference,
      options,
      containingSourceFile,
    ) =>
      literals.map((literal) => {
        const mode = ts.getModeForUsageLocation(containingSourceFile, literal, options);
        const result = ts.resolveModuleName(
          literal.text,
          containingFile,
          options,
          moduleResolutionHost,
          resolutionCache,
          redirectedReference,
          mode,
        );
        onModuleResolved?.(literal.text, containingFile, result.resolvedModule?.resolvedFileName);
        return result;
      }),

    // Let TS reuse our cache for incidental (non-import) lookups.
    getResolvedModuleWithFailedLookupLocationsFromCache: (moduleName, containingFile, mode) =>
      ts.resolveModuleNameFromCache(moduleName, containingFile, resolutionCache, mode),
  };
}
