import type { FsSync } from '@rifty/vfs';
import { dirname, isAbsolute, joinPath, normalizePath } from '@rifty/vfs';
import { isBuiltinSpecifier } from '../builtins/index.ts';
import { ModuleLoadError } from './errors.ts';

const utf8 = new TextDecoder('utf-8');

export type ModuleKind = 'cjs' | 'esm' | 'json' | 'builtin';

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
 * tsconfig-style path aliases (ADR-0066): a map of `pattern → target(s)` where
 * each target is an **absolute** VFS path pattern. Patterns may carry at most
 * one `*` (e.g. `"@/*"`); the `*` capture from the specifier is substituted into
 * the target. Targets are an ordered candidate list (a single string is a
 * one-element list) — the first that resolves to an existing file wins. The
 * resolver does NOT read tsconfig itself: a caller (the opencode smoke harness, a
 * future "open a TS project" flow) reads `compilerOptions.paths`, resolves its
 * targets to absolute patterns (handling `baseUrl`/`extends`), and supplies this
 * map. Off by default = Node-faithful resolution.
 */
export type PathAliases = Readonly<Record<string, string | readonly string[]>>;

/** Options for {@link createResolver}. */
export interface ResolverOptions {
  /** tsconfig-style path aliases (ADR-0066). Absent = Node-faithful resolution. */
  readonly paths?: PathAliases;
}

// `.ts`/`.tsx` come AFTER the `.js` family so a plain-Node package shipping
// `foo.js` resolves byte-identically to Node (Node never resolves bare `.ts`),
// and BEFORE `.json` (ADR-0053). This is a deliberate, human-ratified deviation
// from Node's resolution: rifty resolves a bare `.ts` where Node-without-a-
// stripper would `MODULE_NOT_FOUND`. The transform side is separable — a `.ts`
// that resolves with no transform hook throws a directed error at execute time
// (no silent stub), not here.
const DEFAULT_EXTENSIONS = ['.js', '.mjs', '.cjs', '.ts', '.tsx', '.json'] as const;
const INDEX_FILES = [
  'index.js',
  'index.mjs',
  'index.cjs',
  'index.ts',
  'index.tsx',
  'index.json',
] as const;

// TypeScript declaration files (`.d.ts`/`.d.cts`/`.d.mts`) are types-only — they
// carry no runnable JS and the strip-types path would feed them to acorn and throw
// `SYNTAX_ERROR`. Node's own strip-types loaders deliberately skip them. Because
// `.d.ts` ends with `.ts` (now in DEFAULT_EXTENSIONS, ADR-0053) a naive `${base}.ts`
// append or an `exports`/`main` target naming a `.d.ts` would otherwise match one.
// We reject any declaration-file candidate at every file-acceptance point so it
// resolves as if it did not exist (MODULE_NOT_FOUND), never as an executable module.
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
}

export function createResolver(vfs: FsSync, resolverOpts: ResolverOptions = {}): Resolver {
  const paths = resolverOpts.paths;
  return {
    resolve(specifier, opts) {
      const fromDir =
        vfs.existsSync(opts.fromFile) && vfs.statSync(opts.fromFile).isDirectory
          ? opts.fromFile
          : dirname(opts.fromFile);

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
      if (specifier.startsWith('data:') || specifier.startsWith('file:')) {
        throw new ModuleLoadError(
          'UNSUPPORTED_PROTOCOL',
          specifier,
          `Protocol in '${specifier}' is not supported in M2.`,
          opts.fromFile,
        );
      }

      if (specifier.startsWith('#')) {
        const filePath = resolveImportsSpecifier(vfs, specifier, fromDir, opts.esm);
        if (filePath === null) {
          throw new ModuleLoadError(
            'MODULE_NOT_FOUND',
            specifier,
            `Cannot find package import '${specifier}' (imported from '${opts.fromFile}')`,
            opts.fromFile,
          );
        }
        return readResolved(vfs, filePath, opts.esm);
      }

      // tsconfig-style path aliases (ADR-0066): tried only for non-relative,
      // non-absolute specifiers (relative/absolute imports never alias), and
      // only when a pattern actually matches — so real `@scope/pkg` packages are
      // untouched. An alias that matches a pattern but resolves no candidate file
      // falls THROUGH to the normal bare walk (matching tsc's paths-then-fallback),
      // so a genuine miss still reports MODULE_NOT_FOUND on the original specifier.
      if (paths !== undefined && !isRelativeSpecifier(specifier) && !isAbsolute(specifier)) {
        const aliased = resolvePathAlias(vfs, specifier, paths);
        if (aliased !== null) return readResolved(vfs, aliased, opts.esm);
      }

      const filePath = resolveSpecifierToFile(vfs, specifier, fromDir, opts.esm);
      if (filePath === null) {
        throw new ModuleLoadError(
          'MODULE_NOT_FOUND',
          specifier,
          `Cannot find module '${specifier}' (imported from '${opts.fromFile}')`,
          opts.fromFile,
        );
      }
      return readResolved(vfs, filePath, opts.esm);
    },
  };
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
  specifier: string,
  fromDir: string,
  esm: boolean,
): string | null {
  if (isRelativeSpecifier(specifier)) {
    const base = joinPath(fromDir, specifier);
    return resolveAsFileOrDir(vfs, base);
  }
  if (isAbsolute(specifier)) {
    return resolveAsFileOrDir(vfs, normalizePath(specifier));
  }
  return resolveBareSpecifier(vfs, specifier, fromDir, esm);
}

/**
 * Resolve a specifier against a tsconfig-style {@link PathAliases} map (ADR-0066).
 * Selects the most-specific matching pattern (exact > wildcard; among wildcards,
 * longest static prefix then longest static suffix), substitutes the `*` capture
 * into each of that pattern's ordered candidate targets, and returns the first
 * target that resolves to an existing file. Returns `null` when no pattern matches
 * OR when a pattern matches but no candidate file exists — both let the caller fall
 * through to normal resolution.
 */
function resolvePathAlias(vfs: FsSync, specifier: string, paths: PathAliases): string | null {
  const match = matchAliasPattern(paths, specifier);
  if (match === null) return null;
  for (const target of match.targets) {
    const substituted = match.star === null ? target : target.replace(/\*/g, match.star);
    const resolved = resolveAsFileOrDir(vfs, normalizePath(substituted));
    if (resolved !== null) return resolved;
  }
  return null;
}

interface AliasMatch {
  /** Ordered candidate target patterns for the winning alias key. */
  readonly targets: readonly string[];
  /** The `*` capture, or `null` for an exact (star-less) pattern. */
  readonly star: string | null;
}

/**
 * Pick the most-specific {@link PathAliases} key matching `specifier`. An exact
 * (star-less) key matches only the whole specifier and, having full length as its
 * "base", outranks any wildcard. Among wildcards, longest static prefix wins, ties
 * broken by longest static suffix — the same specificity model as `findWildcard`
 * for `exports`/`imports`. Keys with more than one `*` are ignored (tsc rule).
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
    if (suffix.includes('*')) continue; // at most one `*` per tsc
    if (
      specifier.length >= prefix.length + suffix.length &&
      specifier.startsWith(prefix) &&
      specifier.endsWith(suffix)
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

function resolveAsFileOrDir(vfs: FsSync, base: string): string | null {
  // Node's resolution order is LOAD_AS_FILE *before* LOAD_AS_DIRECTORY: an exact
  // file, then `X` + extension, and only then `X` as a directory. We stat `base`
  // once and apply that order.
  const baseStat = vfs.existsSync(base) ? vfs.statSync(base) : null;

  // (1) `base` as an exact file. A declaration file named explicitly (e.g. an
  // `exports` target `./foo.d.ts`) is not a runnable module — skip it so the
  // caller falls back to a sibling `.js`/`.ts` or reports MODULE_NOT_FOUND.
  if (baseStat?.isFile) return isDeclarationFile(base) ? null : base;

  // (2) `base` + extension. Node tries `X.js` (and rifty's `.ts`/`.tsx` set,
  // ADR-0053) BEFORE treating `X` as a directory — so a `foo.ts` sibling wins
  // over a same-named `foo/` directory. opencode relies on this: `./migration`
  // (from `core/src/database/database.ts`) must resolve the `migration.ts`
  // barrel, NOT the sibling `migration/` directory of SQL migration files (which
  // has no index). Verified against Node 24: `require('./foo')` with both
  // `foo.js` and `foo/index.js` present resolves `foo.js`.
  for (const ext of DEFAULT_EXTENSIONS) {
    const candidate = `${base}${ext}`;
    if (isDeclarationFile(candidate)) continue;
    if (vfs.existsSync(candidate) && vfs.statSync(candidate).isFile) return candidate;
  }

  // (3) `base` as a directory (package.json `main`, then `index.*`).
  if (baseStat?.isDirectory) return resolveAsDirectory(vfs, base);

  return null;
}

function resolveAsDirectory(vfs: FsSync, dir: string): string | null {
  const pkgPath = joinPath(dir, 'package.json');
  if (vfs.existsSync(pkgPath)) {
    const pkg = readPackageJson(vfs, pkgPath);
    const main = pickMainEntry(pkg);
    if (main) {
      const candidate = resolveAsFileOrDir(vfs, joinPath(dir, main));
      if (candidate) return candidate;
    }
  }
  for (const idx of INDEX_FILES) {
    const candidate = joinPath(dir, idx);
    if (isDeclarationFile(candidate)) continue;
    if (vfs.existsSync(candidate) && vfs.statSync(candidate).isFile) return candidate;
  }
  return null;
}

function resolveBareSpecifier(
  vfs: FsSync,
  specifier: string,
  fromDir: string,
  esm: boolean,
): string | null {
  const { name, subpath } = parseBareSpecifier(specifier);
  let dir = fromDir;
  while (true) {
    const candidateDir = joinPath(dir, 'node_modules', name);
    if (vfs.existsSync(candidateDir) && vfs.statSync(candidateDir).isDirectory) {
      const file = resolveInsidePackage(vfs, candidateDir, subpath, esm);
      if (file) return file;
    }
    if (dir === '/') break;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

interface ParsedBareSpecifier {
  readonly name: string;
  readonly subpath: string;
}

function parseBareSpecifier(specifier: string): ParsedBareSpecifier {
  if (specifier.startsWith('@')) {
    const firstSlash = specifier.indexOf('/');
    if (firstSlash === -1) return { name: specifier, subpath: '.' };
    const secondSlash = specifier.indexOf('/', firstSlash + 1);
    if (secondSlash === -1) return { name: specifier, subpath: '.' };
    return { name: specifier.slice(0, secondSlash), subpath: `.${specifier.slice(secondSlash)}` };
  }
  const slash = specifier.indexOf('/');
  if (slash === -1) return { name: specifier, subpath: '.' };
  return { name: specifier.slice(0, slash), subpath: `.${specifier.slice(slash)}` };
}

function resolveInsidePackage(
  vfs: FsSync,
  pkgDir: string,
  subpath: string,
  esm: boolean,
): string | null {
  const pkgJsonPath = joinPath(pkgDir, 'package.json');
  if (vfs.existsSync(pkgJsonPath)) {
    const pkg = readPackageJson(vfs, pkgJsonPath);
    if (pkg.exports !== undefined) {
      const resolved = resolveExports(pkg.exports, subpath, esm);
      if (resolved !== null) {
        return resolveAsFileOrDir(vfs, joinPath(pkgDir, resolved));
      }
      throw new ModuleLoadError(
        'PACKAGE_PATH_NOT_EXPORTED',
        subpath,
        `Package subpath '${subpath}' is not defined by 'exports' in ${pkgJsonPath}`,
      );
    }
    if (subpath === '.') {
      const main = pickMainEntry(pkg);
      if (main) {
        const candidate = resolveAsFileOrDir(vfs, joinPath(pkgDir, main));
        if (candidate) return candidate;
      }
    } else {
      return resolveAsFileOrDir(vfs, joinPath(pkgDir, subpath.slice(2)));
    }
  }
  if (subpath === '.') {
    return resolveAsDirectory(vfs, pkgDir);
  }
  return resolveAsFileOrDir(vfs, joinPath(pkgDir, subpath.slice(2)));
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
 * `imports` field. Walks upward from `fromDir` until it finds a `package.json`
 * — the spec says we don't keep walking past the first one (the first one
 * defines the package scope). Reuses the same conditions logic as `exports`.
 *
 * Returns the absolute resolved file path, or `null` if no match.
 */
function resolveImportsSpecifier(
  vfs: FsSync,
  specifier: string,
  fromDir: string,
  esm: boolean,
): string | null {
  let dir = fromDir;
  while (true) {
    const pkgJsonPath = joinPath(dir, 'package.json');
    if (vfs.existsSync(pkgJsonPath) && vfs.statSync(pkgJsonPath).isFile) {
      const pkg = readPackageJson(vfs, pkgJsonPath);
      if (pkg.imports !== undefined) {
        const resolved = resolveImports(pkg.imports, specifier, esm);
        if (resolved !== null) {
          // `imports` targets may be absolute paths, package-relative, or bare
          // specifiers ("lodash"). We only handle file-relative targets here.
          if (resolved.startsWith('./') || resolved.startsWith('../')) {
            return resolveAsFileOrDir(vfs, joinPath(dir, resolved));
          }
          if (isAbsolute(resolved)) {
            return resolveAsFileOrDir(vfs, normalizePath(resolved));
          }
          // Bare specifier — recurse through the normal bare resolver.
          return resolveBareSpecifier(vfs, resolved, dir, esm);
        }
      }
      // First package.json found, no match — stop walking per Node spec.
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
  // `undefined` = no pattern matched; `null` = the most-specific pattern is a
  // block (deny). Both mean "no resolution" here; only a real target resolves.
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
    // `undefined` = no pattern matched; `null` = the most-specific pattern is a
    // block (deny, e.g. effect's `"./internal/*": null`). Both yield no
    // resolution, so the caller throws PACKAGE_PATH_NOT_EXPORTED. Only a real
    // target resolves.
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
 * per Node's `PACKAGE_IMPORTS_EXPORTS_RESOLVE` (not first-by-insertion-order).
 * effect@4 declares a catch-all `./*` -> `./dist/*.js` alongside more-specific
 * null blocks (its `./internal/*` and `./<star>/index` keys map to null); a
 * first-match scan in insertion order would leak `effect/internal/x` through
 * `./*` instead of letting the null block deny it. Node ignores key order and
 * selects the
 * candidate with the longest pattern base (the part before `*`), breaking ties
 * on the longest pattern trailer (the part after `*`).
 *
 * A best-match whose target is `null` (or `undefined`) is a deliberate BLOCK:
 * we return `null` so the caller throws `PACKAGE_PATH_NOT_EXPORTED` — it must
 * NOT fall through to a less-specific non-null pattern.
 *
 * Returns `undefined` when no pattern matches at all (so the caller can tell a
 * blocked subpath apart from an unmatched one), the substituted target string
 * (wrapped) when a non-null pattern wins, or `null` when the winner is a block.
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
    // A pattern matches when the subpath carries its prefix and suffix and the
    // two do not overlap (`prefix.length + suffix.length <= subpath.length`).
    if (
      subpath.length >= prefix.length + suffix.length &&
      subpath.startsWith(prefix) &&
      subpath.endsWith(suffix)
    ) {
      // Specificity = longer base wins; tie -> longer trailer wins.
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

function readPackageJson(vfs: FsSync, path: string): PackageJson {
  try {
    return JSON.parse(utf8.decode(vfs.readFileBytesSync(path))) as PackageJson;
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
 * via the `type` field). Walks up from the file's directory.
 */
export function findPackageScope(
  vfs: FsSync,
  filePath: string,
): { dir: string; pkg: PackageJson } | null {
  let dir = dirname(filePath);
  while (true) {
    const candidate = joinPath(dir, 'package.json');
    if (vfs.existsSync(candidate) && vfs.statSync(candidate).isFile) {
      try {
        return {
          dir,
          pkg: JSON.parse(utf8.decode(vfs.readFileBytesSync(candidate))) as PackageJson,
        };
      } catch {
        return { dir, pkg: {} };
      }
    }
    if (dir === '/') return null;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function readResolved(vfs: FsSync, filePath: string, _esm: boolean): ResolvedModule {
  const source = utf8.decode(vfs.readFileBytesSync(filePath));
  const kind = detectKind(vfs, filePath);
  const scope = findPackageScope(vfs, filePath);
  return {
    id: filePath,
    kind,
    source,
    packageRoot: scope ? scope.dir : null,
  };
}

function detectKind(vfs: FsSync, filePath: string): ModuleKind {
  if (filePath.endsWith('.json')) return 'json';
  if (filePath.endsWith('.mjs')) return 'esm';
  if (filePath.endsWith('.cjs')) return 'cjs';
  if (filePath.endsWith('.js') || filePath.endsWith('.ts') || filePath.endsWith('.tsx')) {
    // `.ts`/`.tsx` mirror the `.js` branch (ADR-0053): ESM under a
    // `type:module` scope, else CJS — matching how a TS-aware Node loader
    // classifies a source file by its nearest package scope.
    const scope = findPackageScope(vfs, filePath);
    if (scope && scope.pkg.type === 'module') return 'esm';
    return 'cjs';
  }
  // Unknown extension — assume CJS, matches Node's default for `.js` in non-module packages.
  return 'cjs';
}
