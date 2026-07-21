import type { FsSync } from '@riftydev/vfs';
import { basename, dirname, isAbsolute, joinPath, normalizePath } from '@riftydev/vfs';
import { ensureRuntimeJsBuiltinsRegistered, isBuiltinSpecifier } from '../builtins/index.ts';
import {
  URLConstructor,
  fileURLToPathPosix,
  hasEncodedPathSeparator,
} from '../internal/posix-file-url.ts';
import { hasURLScheme } from '../internal/url-scheme.ts';
import { ModuleLoadError } from './errors.ts';
import {
  type TsconfigPathResolution,
  findNearestTsconfig,
  loadTsconfigPathResolution,
  shouldPrependTsconfigBaseUrl,
} from './tsconfig-paths.ts';

const SafeMap = Map;
const safeReflectApply = Reflect.apply.bind(Reflect);
const mapGetPrimordial = SafeMap.prototype.get;
const mapSetPrimordial = SafeMap.prototype.set;
const mapClearPrimordial = SafeMap.prototype.clear;
const jsonParsePrimordial = JSON.parse;
const safeGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor.bind(Object);
const stringEndsWithPrimordial = String.prototype.endsWith;
const utf8 = new TextDecoder('utf-8');
const textDecoderDecodePrimordial = TextDecoder.prototype.decode;

function safeMapGet<K, V>(map: Map<K, V>, key: K): V | undefined {
  return safeReflectApply(mapGetPrimordial, map, [key]) as V | undefined;
}

function safeMapSet<K, V>(map: Map<K, V>, key: K, value: V): void {
  safeReflectApply(mapSetPrimordial, map, [key, value]);
}

function safeMapClear<K, V>(map: Map<K, V>): void {
  safeReflectApply(mapClearPrimordial, map, []);
}

function safeDecode(bytes: Uint8Array): string {
  return safeReflectApply(textDecoderDecodePrimordial, utf8, [bytes]) as string;
}

function safeJsonParse(source: string): unknown {
  return safeReflectApply(jsonParsePrimordial, undefined, [source]);
}

function safeEndsWith(value: string, suffix: string): boolean {
  return safeReflectApply(stringEndsWithPrimordial, value, [suffix]) as boolean;
}

function ownPackageType(pkg: unknown): string | undefined {
  if (typeof pkg !== 'object' || pkg === null) return undefined;
  const descriptor = safeGetOwnPropertyDescriptor(pkg, 'type');
  if (descriptor === undefined || !('value' in descriptor)) return undefined;
  return typeof descriptor.value === 'string' ? descriptor.value : undefined;
}

export type ModuleKind = 'cjs' | 'esm' | 'json' | 'builtin' | 'text';

// Non-JS assets imported as TEXT (ADR-0067): `import s from "./f.txt"` binds the
// default to raw file contents (esbuild/Bun text-loader behaviour). Only matched
// on explicit-extension imports — Node never resolves these, so it's additive,
// not a parity regression. opencode imports `.txt`/`.sql`/`.md`/`.prompt`.
const TEXT_EXTENSIONS = ['.txt', '.sql', '.md', '.prompt'] as const;

export interface ResolvedModule {
  readonly id: string;
  readonly kind: ModuleKind;
  readonly source: string;
  /** The directory of the package the resolved file belongs to (for `__dirname` etc.). */
  readonly packageRoot: string | null;
}

export interface ResolveOptions {
  /** The file (or directory) doing the import. Used for relative paths and node_modules walk. */
  readonly fromFile: string;
  /** ESM (true) or CJS (false) resolution mode — affects conditions chosen for `exports`. */
  readonly esm: boolean;
}

/**
 * tsconfig-style path aliases (ADR-0066): `pattern → target(s)`, each target an
 * **absolute** VFS path pattern. Patterns carry at most one `*`; the specifier's
 * `*` capture is substituted into the target. Targets are an ordered candidate
 * list (a bare string = one element) — first to resolve to an existing file wins.
 * Explicit maps are still the fastest/most-controlled path. When
 * `autoDiscoverTsconfigPaths` is enabled, the resolver uses TypeScript's own
 * config parser to locate `tsconfig.json`, follow `extends`, interpret
 * `baseUrl`, and compute this same absolute map. Off by default =
 * Node-faithful resolution.
 */
export type PathAliases = Readonly<Record<string, string | readonly string[]>>;

/** Options for {@link createResolver}. */
export interface ResolverOptions {
  /** tsconfig-style path aliases (ADR-0066). Absent = Node-faithful resolution. */
  readonly paths?: PathAliases;
  /**
   * If true, locate the nearest `tsconfig.json` for the importing file and derive
   * path aliases from `compilerOptions.paths` with the real TypeScript parser.
   * Explicit {@link paths} win when both are supplied.
   */
  readonly autoDiscoverTsconfigPaths?: boolean;
}

// `.ts`/`.tsx` come AFTER the `.js` family (so a plain-Node `foo.js` resolves
// byte-identically) and BEFORE `.json` (ADR-0053). Deliberate, human-ratified
// deviation: rifty resolves a bare `.ts` where Node-without-a-stripper would
// MODULE_NOT_FOUND. The transform side is separable — a resolved `.ts` with no
// transform hook throws a directed error at execute time (no silent stub).
const DEFAULT_EXTENSIONS = ['.js', '.mjs', '.cjs', '.ts', '.tsx', '.json'] as const;
const INDEX_FILES = [
  'index.js',
  'index.mjs',
  'index.cjs',
  'index.ts',
  'index.tsx',
  'index.json',
] as const;
// tsconfig `paths`/`baseUrl` are TypeScript-owned resolution, not Node's loader.
// Keep Node-first order above for normal imports; match TS source priority here.
const TSCONFIG_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json'] as const;
const TSCONFIG_INDEX_FILES = [
  'index.ts',
  'index.tsx',
  'index.js',
  'index.jsx',
  'index.mjs',
  'index.cjs',
  'index.json',
] as const;

// Declaration files (`.d.ts`/`.d.cts`/`.d.mts`) are types-only — no runnable JS;
// strip-types would feed them to acorn and throw SYNTAX_ERROR (Node's own
// strip-types loaders skip them). Since `.d.ts` ends with `.ts` (in
// DEFAULT_EXTENSIONS, ADR-0053), a `${base}.ts` append or an `exports`/`main`
// target could match one. Reject at every file-acceptance point so it resolves
// as MODULE_NOT_FOUND, never as an executable module.
const DECLARATION_FILE = /\.d\.(?:ts|cts|mts)$/;

/**
 * True for a TypeScript declaration file (`*.d.ts` / `*.d.cts` / `*.d.mts`).
 * These are never resolvable as runnable modules.
 */
function isDeclarationFile(path: string): boolean {
  return DECLARATION_FILE.test(path);
}

export interface Resolver {
  resolve(specifier: string, opts: ResolveOptions): ResolvedModule;
  /**
   * Drop the resolver-internal caches (package.json parses + resolution memo).
   * Called by `loader.invalidate()` on BOTH the full-clear and targeted arms —
   * the caches are input-keyed and cannot be pruned by module id, so any
   * invalidate clears them whole (perf #5/#15). See Q-2026-06-06-320/321.
   */
  clearCaches(): void;
}

/** Parsed-`package.json` cache, keyed by ABSOLUTE package.json path (perf #5). */
type PkgCache = Map<string, PackageJson>;

export function createResolver(vfs: FsSync, resolverOpts: ResolverOptions = {}): Resolver {
  const explicitPaths = resolverOpts.paths;
  const autoDiscoverTsconfigPaths = resolverOpts.autoDiscoverTsconfigPaths === true;
  // package.json parse cache (perf #5). N sibling imports from one package
  // re-decoded+re-parsed its package.json N times; cache by absolute path.
  // Cleared whole in `loader.invalidate()` (both arms) — `load-fixture` reload
  // overwrites package.json then invalidates, so a stale `type`/`main`/`exports`
  // would silently flip ESM/CJS classification. TODO(backlog: perf/loader-packagejson-parse-cache).
  const pkgCache: PkgCache = new SafeMap();
  // Resolution memo (perf #15): key `esm\0fromDir\0specifier` -> resolved
  // file-id. NEVER caches not-found (guest writes / npm install create files
  // without firing invalidate) nor the ERR_PACKAGE_PATH_NOT_EXPORTED throw.
  // Cleared whole on ANY invalidate (input-keyed; cannot prune by resolved id).
  // TODO(backlog: perf/resolver-resolution-cache).
  const resolveCache = new SafeMap<string, string>();
  const nearestTsconfigCache = new SafeMap<string, string | null>();
  const tsconfigResolutionCache = new SafeMap<string, TsconfigPathResolution | null>();
  return {
    clearCaches() {
      safeMapClear(pkgCache);
      safeMapClear(resolveCache);
      safeMapClear(nearestTsconfigCache);
      safeMapClear(tsconfigResolutionCache);
    },
    resolve(specifier, opts) {
      const fromFileStat = vfs.statSyncOrNull(opts.fromFile);
      const fromDir = fromFileStat?.isDirectory ? opts.fromFile : dirname(opts.fromFile);

      ensureRuntimeJsBuiltinsRegistered();
      if (specifier.startsWith('node:') || isBuiltinSpecifier(specifier)) {
        const name = specifier.startsWith('node:') ? specifier.slice(5) : specifier;
        if (!isBuiltinSpecifier(name)) {
          throw new ModuleLoadError(
            'MODULE_NOT_FOUND',
            specifier,
            `Built-in '${specifier}' is not implemented`,
            opts.fromFile,
          );
        }
        return { id: `node:${name}`, kind: 'builtin', source: '', packageRoot: null };
      }
      // URL dispatch is ESM-only. CJS sends every string through its ordinary
      // alias/path/package pipeline; URL-looking names may resolve as filenames.
      if (opts.esm && hasURLScheme(specifier, 'data')) {
        throw new ModuleLoadError(
          'UNSUPPORTED_PROTOCOL',
          specifier,
          `Protocol in '${specifier}' is not supported in M2.`,
          opts.fromFile,
        );
      }
      if (opts.esm && hasURLScheme(specifier, 'file')) {
        const filePath = fileUrlToVfsPath(specifier, opts.fromFile);
        const resolved = resolveAsFileOrDir(vfs, pkgCache, filePath);
        if (resolved === null) {
          throw moduleNotFound(specifier, opts.fromFile, opts.esm);
        }
        return readResolved(vfs, pkgCache, resolved, opts.esm);
      }

      if (specifier.startsWith('#')) {
        const filePath = resolveImportsSpecifier(vfs, pkgCache, specifier, fromDir, opts.esm);
        if (filePath === null) {
          throw new ModuleLoadError(
            'MODULE_NOT_FOUND',
            specifier,
            `Cannot find package import '${specifier}' (imported from '${opts.fromFile}')`,
            opts.fromFile,
          );
        }
        return readResolved(vfs, pkgCache, filePath, opts.esm);
      }

      // tsconfig-style path aliases (ADR-0066): only for bare specifiers and
      // only when a pattern matches — so real `@scope/pkg` packages are untouched.
      // A pattern match that resolves no file skips `baseUrl` (matching TypeScript),
      // then falls through to the bare node_modules walk.
      if (!isRelativeSpecifier(specifier) && !isAbsolute(specifier)) {
        const tsconfigResolution = resolutionFor(fromDir);
        if (tsconfigResolution !== undefined) {
          const aliased: PathAliasResolution =
            tsconfigResolution.paths !== undefined
              ? resolvePathAlias(vfs, pkgCache, specifier, tsconfigResolution.paths)
              : { status: 'no-match' };
          if (aliased.status === 'resolved')
            return readResolved(vfs, pkgCache, aliased.path, opts.esm);
          if (
            aliased.status === 'no-match' &&
            tsconfigResolution.baseUrl !== undefined &&
            shouldPrependTsconfigBaseUrl(specifier)
          ) {
            const baseUrlResolved = resolveAsFileOrDir(
              vfs,
              pkgCache,
              joinPath(tsconfigResolution.baseUrl, specifier),
              TSCONFIG_RESOLUTION,
            );
            if (baseUrlResolved !== null)
              return readResolved(vfs, pkgCache, baseUrlResolved, opts.esm);
          }
        }
      }

      // Resolution memo (perf #15): key by (esm,fromDir,specifier). A HIT skips
      // the full node_modules walk; `readResolved` still re-reads source fresh.
      // Only SUCCESSFUL (non-null) resolutions are cached — a miss leaves the
      // memo untouched so a later-created file resolves, and the
      // ERR_PACKAGE_PATH_NOT_EXPORTED throw propagates before any `set` is reached.
      const resolveKey = `${opts.esm ? 1 : 0}\0${fromDir}\0${specifier}`;
      const cached = safeMapGet(resolveCache, resolveKey);
      if (cached !== undefined) return readResolved(vfs, pkgCache, cached, opts.esm);

      const filePath = resolveSpecifierToFile(vfs, pkgCache, specifier, fromDir, opts.esm);
      if (filePath === null) {
        throw moduleNotFound(specifier, opts.fromFile, opts.esm);
      }
      safeMapSet(resolveCache, resolveKey, filePath);
      return readResolved(vfs, pkgCache, filePath, opts.esm);
    },
  };

  function resolutionFor(fromDir: string): TsconfigPathResolution | undefined {
    if (explicitPaths !== undefined) return { paths: explicitPaths };
    if (!autoDiscoverTsconfigPaths) return undefined;
    let configPath = safeMapGet(nearestTsconfigCache, fromDir);
    if (configPath === undefined) {
      configPath = findNearestTsconfig(vfs, fromDir);
      safeMapSet(nearestTsconfigCache, fromDir, configPath);
    }
    if (configPath === null) return undefined;
    let resolution = safeMapGet(tsconfigResolutionCache, configPath);
    if (resolution === undefined) {
      resolution = loadTsconfigPathResolution(vfs, configPath);
      safeMapSet(tsconfigResolutionCache, configPath, resolution);
    }
    return resolution ?? undefined;
  }
}

function fileUrlToVfsPath(specifier: string, fromFile: string): string {
  let url: URL;
  try {
    url = new URLConstructor(specifier);
  } catch (err) {
    const msg = (err as Error).message ?? String(err);
    throw new ModuleLoadError(
      'UNSUPPORTED_PROTOCOL',
      specifier,
      `Invalid file URL '${specifier}': ${msg}`,
      fromFile,
    );
  }
  if (url.protocol !== 'file:') {
    throw new ModuleLoadError(
      'UNSUPPORTED_PROTOCOL',
      specifier,
      `Protocol in '${specifier}' is not supported in M2.`,
      fromFile,
    );
  }
  if (hasEncodedPathSeparator(url.pathname, true)) {
    const error = new TypeError(
      `Invalid module "${url.pathname}" must not include encoded "/" or "\\" characters imported from ${fromFile}`,
    ) as TypeError & { code: string };
    error.code = 'ERR_INVALID_MODULE_SPECIFIER';
    throw error;
  }
  const pathname = fileURLToPathPosix(url);
  return normalizePath(pathname.startsWith('/') ? pathname : `/${pathname}`);
}

/**
 * Build a `MODULE_NOT_FOUND` for a missing file resolution. Node uses TWO
 * different shapes and rifty matches the one Node actually emits:
 *
 *  - CJS-loader shape — for a missing ENTRY (Node runs even a `.mjs` entry
 *    through the CJS loader → `MODULE_NOT_FOUND`, `requireStack: []`) and a
 *    nested `require()` miss. Message `Cannot find module '<specifier>'` + a
 *    `Require stack:` block (non-empty stack only), byte-faithful to Node's
 *    `cjs/loader`; `requireStack` lists the requiring module. The entry is
 *    detected as a self-reference (`runNodeEntry` loads it via
 *    `loader.import(entryPath, entryPath)`, so the resolver sees
 *    `specifier === fromFile` and the top-level entry has no requirer). Deeper
 *    ancestors collapse to the immediate requirer (compat note).
 *  - ESM `import()` miss — Node emits a DIFFERENT error here
 *    (`ERR_MODULE_NOT_FOUND`, `Cannot find module '<abs>' imported from <parent>`,
 *    a `url` prop, NO requireStack). rifty does not produce that shape yet, so an
 *    ESM (non-entry) miss keeps the honest, clearly-rifty form — NO `requireStack`
 *    (its absence is the signal that the worker-entry seam must NOT reshape it
 *    into the CJS form and masquerade as Node parity).
 *    TODO(backlog: runtime-js/esm-import-miss-err-module-not-found)
 */
function moduleNotFound(specifier: string, fromFile: string, esm: boolean): ModuleLoadError {
  const isEntrySelfRef =
    isAbsolute(specifier) && normalizePath(specifier) === normalizePath(fromFile);
  if (!esm || isEntrySelfRef) {
    const requireStack = isEntrySelfRef ? [] : [fromFile];
    const block =
      requireStack.length === 0
        ? ''
        : `\nRequire stack:\n${requireStack.map((p) => `- ${p}`).join('\n')}`;
    return new ModuleLoadError(
      'MODULE_NOT_FOUND',
      specifier,
      `Cannot find module '${specifier}'${block}`,
      fromFile,
      requireStack,
    );
  }
  return new ModuleLoadError(
    'MODULE_NOT_FOUND',
    specifier,
    `Cannot find module '${specifier}' (imported from '${fromFile}')`,
    fromFile,
  );
}

/** A relative specifier (`./x`, `../x`, `.`, `..`) — never alias- or bare-resolved. */
function isRelativeSpecifier(specifier: string): boolean {
  return (
    specifier.startsWith('./') ||
    specifier.startsWith('../') ||
    specifier === '.' ||
    specifier === '..'
  );
}

function resolveSpecifierToFile(
  vfs: FsSync,
  pkgCache: PkgCache,
  specifier: string,
  fromDir: string,
  esm: boolean,
): string | null {
  if (isRelativeSpecifier(specifier)) {
    const base = joinPath(fromDir, specifier);
    return resolveAsFileOrDir(vfs, pkgCache, base);
  }
  if (isAbsolute(specifier)) {
    return resolveAsFileOrDir(vfs, pkgCache, normalizePath(specifier));
  }
  return resolveBareSpecifier(vfs, pkgCache, specifier, fromDir, esm);
}

/**
 * Resolve a specifier against a {@link PathAliases} map (ADR-0066). Picks the
 * most-specific pattern (exact > wildcard; among wildcards, longest prefix then
 * suffix), substitutes the `*` capture into its ordered targets, returns the
 * first that resolves to an existing file. A matched miss is distinct from no
 * match because TypeScript does NOT try `baseUrl` after a matching `paths` key
 * fails, though it may still continue to package resolution.
 */
type PathAliasResolution =
  | { readonly status: 'resolved'; readonly path: string }
  | { readonly status: 'matched-miss' }
  | { readonly status: 'no-match' };

interface FileDirResolutionOrder {
  readonly extensions: readonly string[];
  readonly indexFiles: readonly string[];
}

const TSCONFIG_RESOLUTION: FileDirResolutionOrder = {
  extensions: TSCONFIG_EXTENSIONS,
  indexFiles: TSCONFIG_INDEX_FILES,
};

function resolvePathAlias(
  vfs: FsSync,
  pkgCache: PkgCache,
  specifier: string,
  paths: PathAliases,
): PathAliasResolution {
  const match = matchAliasPattern(paths, specifier);
  if (match === null) return { status: 'no-match' };
  for (const target of match.targets) {
    const substituted = match.star === null ? target : target.replace(/\*/g, match.star);
    const resolved = resolveAsFileOrDir(
      vfs,
      pkgCache,
      normalizePath(substituted),
      TSCONFIG_RESOLUTION,
    );
    if (resolved !== null) return { status: 'resolved', path: resolved };
  }
  return { status: 'matched-miss' };
}

interface AliasMatch {
  /** Ordered candidate target patterns for the winning alias key. */
  readonly targets: readonly string[];
  /** The `*` capture, or `null` for an exact (star-less) pattern. */
  readonly star: string | null;
}

/**
 * Pick the most-specific {@link PathAliases} key matching `specifier`. An exact
 * (star-less) key matches the whole specifier and, with full length as its base,
 * outranks any wildcard. Among wildcards: longest prefix, ties broken by longest
 * suffix — same model as `findWildcard`. Keys with more than one `*` are ignored
 * (tsc rule).
 */
function matchAliasPattern(paths: PathAliases, specifier: string): AliasMatch | null {
  let bestKey: string | null = null;
  let bestStar: string | null = null;
  let bestBaseLen = -1;
  let bestTrailerLen = -1;
  for (const key of Object.keys(paths)) {
    const starIdx = key.indexOf('*');
    if (starIdx === -1) {
      if (key !== specifier) continue;
      // Exact match: treat the whole key as the static base, no trailer, no capture.
      if (key.length > bestBaseLen) {
        bestKey = key;
        bestStar = null;
        bestBaseLen = key.length;
        bestTrailerLen = 0;
      }
      continue;
    }
    const prefix = key.slice(0, starIdx);
    const suffix = key.slice(starIdx + 1);
    if (suffix.includes('*')) continue; // tsc: at most one `*`
    if (
      specifier.length >= prefix.length + suffix.length &&
      specifier.startsWith(prefix) &&
      safeEndsWith(specifier, suffix)
    ) {
      const baseLen = prefix.length;
      const trailerLen = suffix.length;
      if (baseLen > bestBaseLen || (baseLen === bestBaseLen && trailerLen > bestTrailerLen)) {
        bestKey = key;
        bestStar = specifier.slice(prefix.length, specifier.length - suffix.length);
        bestBaseLen = baseLen;
        bestTrailerLen = trailerLen;
      }
    }
  }
  if (bestKey === null) return null;
  const target = paths[bestKey];
  if (target === undefined) return null;
  const targets = typeof target === 'string' ? [target] : target;
  return { targets, star: bestStar };
}

function resolveAsFileOrDir(
  vfs: FsSync,
  pkgCache: PkgCache,
  base: string,
  order?: FileDirResolutionOrder,
): string | null {
  const baseStat = vfs.statSyncOrNull(base);
  const file = resolveAsFile(vfs, base, baseStat?.isFile === true, order);
  if (file !== null) return file;
  if (baseStat?.isDirectory) return resolveAsDirectory(vfs, pkgCache, base, order);
  return null;
}

function resolveAsFile(
  vfs: FsSync,
  base: string,
  baseIsFile: boolean,
  order?: FileDirResolutionOrder,
): string | null {
  if (baseIsFile) return isDeclarationFile(base) ? null : base;
  for (const ext of order?.extensions ?? DEFAULT_EXTENSIONS) {
    const candidate = `${base}${ext}`;
    if (isDeclarationFile(candidate)) continue;
    if (vfs.statSyncOrNull(candidate)?.isFile) return candidate;
  }
  return null;
}

function resolveIndex(vfs: FsSync, dir: string, order?: FileDirResolutionOrder): string | null {
  for (const idx of order?.indexFiles ?? INDEX_FILES) {
    const candidate = joinPath(dir, idx);
    if (isDeclarationFile(candidate)) continue;
    if (vfs.statSyncOrNull(candidate)?.isFile) return candidate;
  }
  return null;
}

function resolveAsDirectory(
  vfs: FsSync,
  pkgCache: PkgCache,
  dir: string,
  order?: FileDirResolutionOrder,
): string | null {
  const pkgPath = joinPath(dir, 'package.json');
  if (vfs.existsSync(pkgPath)) {
    const pkg = readPackageJson(vfs, pkgCache, pkgPath);
    const main = pickMainEntry(pkg);
    if (main) {
      const mainBase = joinPath(dir, main);
      const mainStat = vfs.statSyncOrNull(mainBase);
      const mainFile = resolveAsFile(vfs, mainBase, mainStat?.isFile === true, order);
      if (mainFile !== null) return mainFile;
      const mainIndex = resolveIndex(vfs, mainBase, order);
      if (mainIndex !== null) return mainIndex;
    }
  }
  return resolveIndex(vfs, dir, order);
}

function resolveBareSpecifier(
  vfs: FsSync,
  pkgCache: PkgCache,
  specifier: string,
  fromDir: string,
  esm: boolean,
): string | null {
  const trailingDirectorySegment = hasTrailingDirectorySegment(specifier);
  for (const nodeModulesDir of nodeModulesPaths(fromDir)) {
    const exported = resolvePackageExports(vfs, pkgCache, nodeModulesDir, specifier, esm);
    if (exported !== null) return exported;

    const candidate = joinPath(nodeModulesDir, specifier);
    const candidateStat = vfs.statSyncOrNull(candidate);
    if (!trailingDirectorySegment) {
      const file = resolveAsFile(vfs, candidate, candidateStat?.isFile === true);
      if (file !== null) return file;
    }
    if (candidateStat?.isDirectory) {
      const directory = resolveAsDirectory(vfs, pkgCache, candidate);
      if (directory !== null) return directory;
    }
  }
  return null;
}

function nodeModulesPaths(fromDir: string): readonly string[] {
  const paths: string[] = [];
  let dir = normalizePath(fromDir);
  while (true) {
    if (basename(dir) !== 'node_modules') paths.push(joinPath(dir, 'node_modules'));
    if (dir === '/') return paths;
    const parent = dirname(dir);
    if (parent === dir) return paths;
    dir = parent;
  }
}

function hasTrailingDirectorySegment(specifier: string): boolean {
  return (
    safeEndsWith(specifier, '/') ||
    specifier === '.' ||
    specifier === '..' ||
    safeEndsWith(specifier, '/.') ||
    safeEndsWith(specifier, '/..')
  );
}

interface ParsedPackageRequest {
  readonly name: string;
  readonly subpath: string;
}

const PACKAGE_EXPORTS_PATTERN = /^((?:@[^/\\%]+\/)?[^./\\%][^/\\%]*)(\/.*)?$/;

function parsePackageRequest(specifier: string): ParsedPackageRequest | null {
  const match = PACKAGE_EXPORTS_PATTERN.exec(specifier);
  if (match === null) return null;
  const name = match[1];
  if (name === undefined) return null;
  return { name, subpath: `.${match[2] ?? ''}` };
}

function resolvePackageExports(
  vfs: FsSync,
  pkgCache: PkgCache,
  nodeModulesDir: string,
  specifier: string,
  esm: boolean,
): string | null {
  const parsed = parsePackageRequest(specifier);
  if (parsed === null) return null;
  const pkgDir = joinPath(nodeModulesDir, parsed.name);
  const pkgJsonPath = joinPath(pkgDir, 'package.json');
  if (vfs.statSyncOrNull(pkgJsonPath)?.isFile !== true) return null;
  const pkg = readPackageJson(vfs, pkgCache, pkgJsonPath);
  if (pkg.exports === undefined || pkg.exports === null) return null;

  const target = resolveExports(pkg.exports, parsed.subpath, esm);
  if (target === null) {
    throw new ModuleLoadError(
      'ERR_PACKAGE_PATH_NOT_EXPORTED',
      parsed.subpath,
      `Package subpath '${parsed.subpath}' is not defined by 'exports' in ${pkgJsonPath}`,
    );
  }

  const targetPath = joinPath(pkgDir, target);
  if (!isDeclarationFile(targetPath) && vfs.statSyncOrNull(targetPath)?.isFile) {
    return targetPath;
  }
  throw new ModuleLoadError(
    'MODULE_NOT_FOUND',
    specifier,
    `Cannot find module '${targetPath}' exported by ${pkgJsonPath}`,
  );
}

type ExportsField =
  | string
  | { [key: string]: ExportsField | null }
  | readonly ExportsField[]
  | null;

interface PackageJson {
  name?: string;
  version?: string;
  type?: string;
  main?: string;
  module?: string;
  exports?: ExportsField;
  imports?: ExportsField;
}

const CONDITIONS = ['node', 'default', 'import', 'require'] as const;
type Condition = (typeof CONDITIONS)[number];

function activeConditions(esm: boolean): readonly Condition[] {
  return esm ? (['node', 'import', 'default'] as const) : (['node', 'require', 'default'] as const);
}

/**
 * Resolve a `#name` specifier against the nearest enclosing `package.json`'s
 * `imports` field. Walks up from `fromDir` to the first `package.json` (the spec
 * stops there — it defines the package scope). Reuses the `exports` conditions.
 *
 * @returns absolute resolved path, or `null` if no match.
 */
function resolveImportsSpecifier(
  vfs: FsSync,
  pkgCache: PkgCache,
  specifier: string,
  fromDir: string,
  esm: boolean,
): string | null {
  let dir = fromDir;
  while (true) {
    const pkgJsonPath = joinPath(dir, 'package.json');
    if (vfs.statSyncOrNull(pkgJsonPath)?.isFile) {
      const pkg = readPackageJson(vfs, pkgCache, pkgJsonPath);
      if (pkg.imports !== undefined) {
        const resolved = resolveImports(pkg.imports, specifier, esm);
        if (resolved !== null) {
          // `imports` targets may be absolute, file-relative, or bare ("lodash").
          if (resolved.startsWith('./') || resolved.startsWith('../')) {
            return resolveAsFileOrDir(vfs, pkgCache, joinPath(dir, resolved));
          }
          if (isAbsolute(resolved)) {
            return resolveAsFileOrDir(vfs, pkgCache, normalizePath(resolved));
          }
          // Bare specifier — recurse through the normal bare resolver.
          return resolveBareSpecifier(vfs, pkgCache, resolved, dir, esm);
        }
      }
      // First package.json found, no match — stop walking (Node spec).
      return null;
    }
    if (dir === '/') return null;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function resolveImports(field: ExportsField, specifier: string, esm: boolean): string | null {
  if (field === null || typeof field !== 'object' || Array.isArray(field)) return null;
  const obj = field as { [key: string]: ExportsField | null };
  const direct = obj[specifier];
  if (direct !== undefined && direct !== null) {
    return resolveConditionTree(direct, esm);
  }
  const wildcard = findWildcard(obj, specifier);
  // `undefined` = no pattern matched; `null` = most-specific pattern is a block.
  // Both mean no resolution; only a real target resolves.
  if (wildcard !== null && wildcard !== undefined) {
    return resolveConditionTree(wildcard, esm);
  }
  return null;
}

function resolveExports(field: ExportsField, subpath: string, esm: boolean): string | null {
  if (typeof field === 'string') return subpath === '.' ? field : null;
  if (Array.isArray(field)) {
    const tried = field as readonly ExportsField[];
    for (const item of tried) {
      const r = resolveExports(item, subpath, esm);
      if (r !== null) return r;
    }
    return null;
  }
  if (field === null || typeof field !== 'object') return null;

  const obj = field as { [key: string]: ExportsField | null };
  const keys = Object.keys(obj);
  const hasSubpaths = keys.some((k) => k.startsWith('.'));

  if (hasSubpaths) {
    const direct = obj[subpath];
    if (direct !== undefined && direct !== null) {
      return resolveConditionTree(direct, esm);
    }
    const wildcard = findWildcard(obj, subpath);
    // `undefined` = no pattern matched; `null` = most-specific pattern is a block
    // (e.g. effect's `"./internal/*": null`) → caller throws
    // ERR_PACKAGE_PATH_NOT_EXPORTED. Only a real target resolves.
    if (wildcard !== null && wildcard !== undefined) {
      return resolveConditionTree(wildcard, esm);
    }
    return null;
  }

  if (subpath !== '.') return null;
  return resolveConditionTree(field, esm);
}

function resolveConditionTree(node: ExportsField, esm: boolean): string | null {
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) {
    for (const item of node) {
      const r = resolveConditionTree(item, esm);
      if (r !== null) return r;
    }
    return null;
  }
  if (node === null || typeof node !== 'object') return null;
  for (const cond of activeConditions(esm)) {
    if (cond in node) {
      const sub = (node as Record<string, ExportsField | null>)[cond];
      if (sub === null) return null;
      if (sub !== undefined) {
        const r = resolveConditionTree(sub, esm);
        if (r !== null) return r;
      }
    }
  }
  return null;
}

/**
 * Resolve a `*`-pattern key against `subpath`, picking the MOST-SPECIFIC match
 * per Node's `PACKAGE_IMPORTS_EXPORTS_RESOLVE` (not first-by-insertion-order):
 * longest pattern base (before `*`) wins, ties broken on longest trailer (after
 * `*`). effect@4 declares a catch-all `./*` alongside more-specific null blocks
 * (`./internal/*`); a first-match scan would leak `effect/internal/x` through
 * `./*` instead of letting the block deny it.
 *
 * A winning target of `null`/`undefined` is a deliberate BLOCK: return `null`
 * so the caller throws `ERR_PACKAGE_PATH_NOT_EXPORTED`, never falling through to a
 * less-specific non-null pattern.
 *
 * @returns `undefined` = no pattern matched (vs blocked); substituted target
 * when a non-null pattern wins; `null` when the winner is a block.
 */
function findWildcard(
  obj: { [key: string]: ExportsField | null },
  subpath: string,
): ExportsField | null | undefined {
  let bestKey: string | null = null;
  let bestStar = '';
  let bestBaseLen = -1;
  let bestTrailerLen = -1;
  for (const key of Object.keys(obj)) {
    if (!key.includes('*')) continue;
    const [prefix, suffix] = key.split('*');
    if (prefix === undefined || suffix === undefined) continue;
    // Matches when subpath carries prefix+suffix without overlap.
    if (
      subpath.length >= prefix.length + suffix.length &&
      subpath.startsWith(prefix) &&
      safeEndsWith(subpath, suffix)
    ) {
      // Specificity: longer base wins, tie → longer trailer.
      if (
        prefix.length > bestBaseLen ||
        (prefix.length === bestBaseLen && suffix.length > bestTrailerLen)
      ) {
        bestKey = key;
        bestStar = subpath.slice(prefix.length, subpath.length - suffix.length);
        bestBaseLen = prefix.length;
        bestTrailerLen = suffix.length;
      }
    }
  }
  if (bestKey === null) return undefined;
  const tmpl = obj[bestKey];
  if (tmpl === undefined || tmpl === null) return null;
  return substituteStar(tmpl, bestStar);
}

function substituteStar(node: ExportsField, star: string): ExportsField {
  if (typeof node === 'string') return node.replace(/\*/g, star);
  if (Array.isArray(node))
    return node.map((n) => substituteStar(n, star)) as readonly ExportsField[];
  if (node === null || typeof node !== 'object') return node;
  const out: { [key: string]: ExportsField | null } = {};
  for (const [k, v] of Object.entries(node as { [key: string]: ExportsField | null })) {
    out[k] = v === null ? null : substituteStar(v, star);
  }
  return out;
}

/**
 * Decode+parse `path`'s package.json, consulting/populating `pkgCache` (perf
 * #5). Returns `null` on a decode/parse failure WITHOUT caching it — callers
 * apply their own error behaviour (throw vs `{}` fallback), so a failure from
 * one caller never poisons the other. Only a successful parse is memoized
 * (keyed by absolute path), shared across all parse sites.
 */
function cachedParse(vfs: FsSync, pkgCache: PkgCache, path: string): PackageJson | null {
  const hit = safeMapGet(pkgCache, path);
  if (hit !== undefined) return hit;
  let parsed: PackageJson;
  try {
    parsed = safeJsonParse(safeDecode(vfs.readFileBytesSync(path))) as PackageJson;
  } catch {
    return null;
  }
  safeMapSet(pkgCache, path, parsed);
  return parsed;
}

function readPackageJson(vfs: FsSync, pkgCache: PkgCache, path: string): PackageJson {
  const hit = safeMapGet(pkgCache, path);
  if (hit !== undefined) return hit;
  try {
    const parsed = safeJsonParse(safeDecode(vfs.readFileBytesSync(path))) as PackageJson;
    safeMapSet(pkgCache, path, parsed);
    return parsed;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new ModuleLoadError('SYNTAX_ERROR', path, `Failed to parse ${path}: ${message}`);
  }
}

function pickMainEntry(pkg: PackageJson): string | null {
  if (pkg.main) return pkg.main;
  if (pkg.module) return pkg.module;
  return null;
}

/**
 * Find the nearest `package.json` for a resolved file (used to decide ESM vs CJS
 * via the `type` field). Walks up from the file's directory. Parse failure on a
 * present-but-malformed package.json falls back to `{}` (uncached) so a broken
 * manifest classifies as a CJS scope rather than failing the whole resolve.
 */
export function findPackageScope(
  vfs: FsSync,
  pkgCache: PkgCache,
  filePath: string,
): { dir: string; pkg: PackageJson } | null {
  let dir = dirname(filePath);
  while (true) {
    const candidate = joinPath(dir, 'package.json');
    if (vfs.statSyncOrNull(candidate)?.isFile) {
      const pkg = cachedParse(vfs, pkgCache, candidate);
      return { dir, pkg: pkg ?? {} };
    }
    if (dir === '/') return null;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function readResolved(
  vfs: FsSync,
  pkgCache: PkgCache,
  filePath: string,
  _esm: boolean,
): ResolvedModule {
  const raw = safeDecode(vfs.readFileBytesSync(filePath));
  // One scope walk: feed its `type` into detectKind so the `.js`/`.ts`/`.tsx`
  // branch no longer re-walks/re-parses the same package.json (perf #4).
  const scope = findPackageScope(vfs, pkgCache, filePath);
  const kind = detectKind(filePath, ownPackageType(scope?.pkg));
  // Node strips a leading `#!` shebang before compiling a JS module (CJS
  // `Module._compile` + the ESM loader). Match it for the compiled kinds so a
  // shebang'd entry — `node <script>`, a child_process spawn, or a
  // `node_modules/.bin/<name>` launcher shim (ADR-0137) — never reaches
  // `new Function`/`new AsyncFunction` (which throw on `#!`). Drop only the
  // `#!` line's text, keep its newline so line numbers + source-map offsets
  // past line 1 are unchanged. json/text are not compiled — leave them verbatim.
  const source =
    (kind === 'cjs' || kind === 'esm') && raw.charCodeAt(0) === 0x23 && raw.charCodeAt(1) === 0x21
      ? raw.replace(/^#![^\n]*/, '')
      : raw;
  return {
    id: filePath,
    kind,
    source,
    packageRoot: scope ? scope.dir : null,
  };
}

function detectKind(filePath: string, scopeType: string | undefined): ModuleKind {
  if (safeEndsWith(filePath, '.json')) return 'json';
  for (let index = 0; index < TEXT_EXTENSIONS.length; index += 1) {
    if (safeEndsWith(filePath, TEXT_EXTENSIONS[index] as string)) return 'text';
  }
  if (safeEndsWith(filePath, '.mjs')) return 'esm';
  if (safeEndsWith(filePath, '.cjs')) return 'cjs';
  if (
    safeEndsWith(filePath, '.js') ||
    safeEndsWith(filePath, '.ts') ||
    safeEndsWith(filePath, '.tsx') ||
    safeEndsWith(filePath, '.jsx')
  ) {
    // `.ts`/`.tsx`/`.jsx` mirror the `.js` branch (ADR-0053): ESM under a `type:module`
    // scope, else CJS — as a TS-aware Node loader classifies by package scope.
    // `scopeType` is the SAME findPackageScope result readResolved computed.
    return scopeType === 'module' ? 'esm' : 'cjs';
  }
  // Unknown extension — assume CJS, matches Node's default for `.js` in non-module packages.
  return 'cjs';
}
