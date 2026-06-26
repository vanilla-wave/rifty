import type { FsSync } from '@riftydev/vfs';
import { dirname, isAbsolute, joinPath, normalizePath } from '@riftydev/vfs';
// TODO(backlog: runtime-js/lazy-typescript-tsconfig-discovery): load TypeScript only when auto-discovery is enabled.
import ts from 'typescript';
import { ModuleLoadError } from './errors.ts';
import type { PathAliases } from './resolver.ts';

const utf8 = new TextDecoder('utf-8');
const NON_FATAL_EMPTY_PROJECT_CODES = new Set([18002, 18003]);

interface CompilerOptionsWithPathsBasePath extends ts.CompilerOptions {
  readonly pathsBasePath?: string;
}

export interface TsconfigPathResolution {
  readonly paths?: PathAliases;
  readonly baseUrl?: string;
}

export function findNearestTsconfig(vfs: FsSync, fromDir: string): string | null {
  let dir = normalizePath(fromDir);
  while (true) {
    const candidate = joinPath(dir, 'tsconfig.json');
    if (vfs.statSyncOrNull(candidate)?.isFile) return candidate;
    if (dir === '/') return null;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function loadTsconfigPathResolution(
  vfs: FsSync,
  configPath: string,
): TsconfigPathResolution | null {
  const text = readUtf8(vfs, configPath);
  const root = ts.parseConfigFileTextToJson(configPath, text);
  if (root.error !== undefined) {
    throw tsconfigError(configPath, [root.error]);
  }

  const host: ts.ParseConfigHost = {
    useCaseSensitiveFileNames: true,
    fileExists: (path) => vfs.statSyncOrNull(normalizePath(path))?.isFile === true,
    readFile: (path) => {
      const normalized = normalizePath(path);
      return vfs.statSyncOrNull(normalized)?.isFile === true
        ? readUtf8(vfs, normalized)
        : undefined;
    },
    readDirectory: () => [],
  };
  const configDir = dirname(configPath);
  const parsed = ts.parseJsonConfigFileContent(root.config, host, configDir, {}, configPath);
  const fatalDiagnostics = parsed.errors.filter(
    (diagnostic) => !NON_FATAL_EMPTY_PROJECT_CODES.has(diagnostic.code),
  );
  if (fatalDiagnostics.length > 0) {
    throw tsconfigError(configPath, fatalDiagnostics);
  }

  const options = parsed.options as CompilerOptionsWithPathsBasePath;
  const basePath = options.baseUrl ?? options.pathsBasePath ?? configDir;
  const aliases: Record<string, string | readonly string[]> = {};
  const rawPaths = options.paths as unknown;
  if (rawPaths !== undefined) {
    if (!isRecord(rawPaths)) {
      throw tsconfigShapeError(configPath, 'compilerOptions.paths must be an object');
    }
    for (const [pattern, targets] of Object.entries(rawPaths)) {
      if (!Array.isArray(targets)) {
        throw tsconfigShapeError(
          configPath,
          `compilerOptions.paths["${pattern}"] must be an array of strings`,
        );
      }
      for (const target of targets) {
        if (typeof target !== 'string') {
          throw tsconfigShapeError(
            configPath,
            `compilerOptions.paths["${pattern}"] must contain only strings`,
          );
        }
      }
      aliases[pattern] = targets.map((target) => absolutizeTarget(basePath, target));
    }
  }
  const out: { paths?: PathAliases; baseUrl?: string } = {};
  if (Object.keys(aliases).length > 0) out.paths = aliases;
  if (options.baseUrl !== undefined) out.baseUrl = normalizePath(options.baseUrl);
  if (out.paths === undefined && out.baseUrl === undefined) {
    return null;
  }
  return out;
}

function readUtf8(vfs: FsSync, path: string): string {
  try {
    return utf8.decode(vfs.readFileBytesSync(path));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new ModuleLoadError(
      'TSCONFIG_READ_ERROR',
      path,
      `Cannot read tsconfig '${path}': ${detail}`,
      path,
    );
  }
}

function absolutizeTarget(basePath: string, target: string): string {
  return isAbsolute(target) ? normalizePath(target) : normalizePath(joinPath(basePath, target));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function tsconfigShapeError(configPath: string, detail: string): ModuleLoadError {
  return new ModuleLoadError(
    'TSCONFIG_PARSE_ERROR',
    configPath,
    `Cannot parse tsconfig '${configPath}': ${detail}`,
    configPath,
  );
}

function tsconfigError(configPath: string, diagnostics: readonly ts.Diagnostic[]): ModuleLoadError {
  const message = diagnostics
    .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, ' '))
    .join('; ');
  return new ModuleLoadError(
    'TSCONFIG_PARSE_ERROR',
    configPath,
    `Cannot parse tsconfig '${configPath}': ${message}`,
    configPath,
  );
}
