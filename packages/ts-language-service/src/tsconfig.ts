/**
 * Load + parse a project's `tsconfig.json` over the VFS into a
 * {@link ts.ParsedCommandLine} (resolved compilerOptions + the expanded file
 * list). Uses tsc's own `readConfigFile` + `parseJsonConfigFileContent` with a
 * VFS-backed `ParseConfigHost`, so `extends`, include/exclude globs and option
 * coercion match real tsc exactly.
 *
 * No tsconfig found → tsc's default options over the discovered loose files
 * (the documented "loose files" behaviour real tsc has — NOT a stub).
 */

import type { FsSync } from '@riftydev/vfs';
import ts from 'typescript';
import { fileExists, readFileUtf8, vfsReadDirectory } from './vfs-ts-host.ts';

type TypeScriptApi = typeof ts;

function makeParseConfigHost(fsSync: FsSync, tsApi: TypeScriptApi): ts.ParseConfigHost {
  return {
    useCaseSensitiveFileNames: true,
    fileExists: (p) => fileExists(fsSync, p),
    readFile: (p) => readFileUtf8(fsSync, p),
    readDirectory: (rootDir, extensions, excludes, includes, depth) =>
      vfsReadDirectory(fsSync, rootDir, extensions, excludes, includes, depth, tsApi),
  };
}

/**
 * Parse the tsconfig at (or discovered from) `projectRoot`. When present its
 * options + globs are honoured; when absent, default options over the loose
 * files under `projectRoot`.
 */
export function loadTsConfig(
  fsSync: FsSync,
  projectRoot: string,
  tsApi: TypeScriptApi = ts,
): ts.ParsedCommandLine {
  const host = makeParseConfigHost(fsSync, tsApi);
  const configPath = tsApi.findConfigFile(
    projectRoot,
    (p) => fileExists(fsSync, p),
    'tsconfig.json',
  );

  if (!configPath) {
    // No tsconfig → tsc's loose-file defaults: empty config json, so include
    // defaults to "**/*" under projectRoot (parseJsonConfigFileContent's own
    // behaviour) and options are the compiler defaults.
    return tsApi.parseJsonConfigFileContent({}, host, projectRoot);
  }

  const read = tsApi.readConfigFile(configPath, (p) => readFileUtf8(fsSync, p));
  // readConfigFile surfaces JSON syntax errors here; semantic option errors come
  // back on the ParsedCommandLine below. On a syntax error fall back to the raw
  // (possibly empty) config so parsing still yields a command line, then FOLD the
  // syntax error into its diagnostics — real tsserver surfaces it too (Fidelity).
  const json = read.config ?? {};
  // POSIX dir of the (absolute) config path; tsc resolves include/extends
  // relative to this.
  const configDir = configPath.slice(0, configPath.lastIndexOf('/')) || '/';
  const parsed = tsApi.parseJsonConfigFileContent(
    json,
    host,
    configDir,
    /* existingOptions */ undefined,
    configPath,
  );
  if (read.error) {
    return { ...parsed, errors: [read.error, ...parsed.errors] };
  }
  return parsed;
}
