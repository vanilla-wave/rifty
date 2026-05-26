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

const DEFAULT_EXTENSIONS = ['.js', '.mjs', '.cjs', '.json'] as const;
const INDEX_FILES = ['index.js', 'index.mjs', 'index.cjs', 'index.json'] as const;

export interface Resolver {
  resolve(specifier: string, opts: ResolveOptions): ResolvedModule;
}

export function createResolver(vfs: FsSync): Resolver {
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

function resolveSpecifierToFile(
  vfs: FsSync,
  specifier: string,
  fromDir: string,
  esm: boolean,
): string | null {
  if (
    specifier.startsWith('./') ||
    specifier.startsWith('../') ||
    specifier === '.' ||
    specifier === '..'
  ) {
    const base = joinPath(fromDir, specifier);
    return resolveAsFileOrDir(vfs, base);
  }
  if (isAbsolute(specifier)) {
    return resolveAsFileOrDir(vfs, normalizePath(specifier));
  }
  return resolveBareSpecifier(vfs, specifier, fromDir, esm);
}

function resolveAsFileOrDir(vfs: FsSync, base: string): string | null {
  if (vfs.existsSync(base)) {
    const st = vfs.statSync(base);
    if (st.isFile) return base;
    if (st.isDirectory) return resolveAsDirectory(vfs, base);
  }
  for (const ext of DEFAULT_EXTENSIONS) {
    const candidate = `${base}${ext}`;
    if (vfs.existsSync(candidate) && vfs.statSync(candidate).isFile) return candidate;
  }
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
  if (wildcard !== null) {
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
    if (wildcard !== null) {
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

function findWildcard(
  obj: { [key: string]: ExportsField | null },
  subpath: string,
): ExportsField | null {
  // Match keys like `'./fp/*'` against `subpath`.
  for (const key of Object.keys(obj)) {
    if (!key.includes('*')) continue;
    const [prefix, suffix] = key.split('*');
    if (prefix === undefined || suffix === undefined) continue;
    if (subpath.startsWith(prefix) && subpath.endsWith(suffix)) {
      const star = subpath.slice(prefix.length, subpath.length - suffix.length);
      const tmpl = obj[key];
      if (tmpl === undefined || tmpl === null) return null;
      return substituteStar(tmpl, star);
    }
  }
  return null;
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
  if (filePath.endsWith('.js')) {
    const scope = findPackageScope(vfs, filePath);
    if (scope && scope.pkg.type === 'module') return 'esm';
    return 'cjs';
  }
  // Unknown extension — assume CJS, matches Node's default for `.js` in non-module packages.
  return 'cjs';
}
