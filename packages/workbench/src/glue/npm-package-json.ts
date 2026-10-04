import { NotImplementedError } from '@riftydev/io';
import type { Vfs } from '@riftydev/vfs';
import valid from 'semver/functions/valid.js';
import subset from 'semver/ranges/subset.js';
import validRange from 'semver/ranges/valid.js';

/** npm Arborist preserves a requested range when the default save would widen it. */
export function installedSaveRange(
  requested: string,
  version: string | undefined,
  exact = false,
): string {
  const candidate = version === undefined ? '*' : exact ? version : `^${version}`;
  return valid(requested, true) ||
    !validRange(requested, true) ||
    subset(candidate, requested, { loose: true })
    ? candidate
    : requested;
}

export interface ProjectPackageJson {
  readonly raw: Record<string, unknown>;
  readonly name: string;
  readonly version: string;
  readonly scripts: Record<string, string>;
  readonly dependencies: Record<string, string>;
  readonly devDependencies: Record<string, string>;
  readonly optionalDependencies: Record<string, string>;
}

const DEFAULT_PROJECT_NAME = 'rifty-project';
const DEFAULT_PROJECT_VERSION = '0.0.0';

/**
 * Parse `name`, `name@range`, `@scope/name`, or `@scope/name@range`. A scope's
 * leading `@` isn't a version separator, so look for the *second* `@`.
 */
export function parseSpec(spec: string): { name: string; range: string; explicit: boolean } {
  const directUnsupported = unsupportedDependencySpec(spec);
  if (directUnsupported) throwUnsupportedDependencySpec(spec, directUnsupported);
  if (spec.startsWith('@')) {
    const at = spec.indexOf('@', 1);
    if (at < 0) return { name: spec, range: 'latest', explicit: false };
    const range = spec.slice(at + 1) || 'latest';
    const unsupported = unsupportedDependencySpec(range);
    if (unsupported) throwUnsupportedDependencySpec(spec, unsupported);
    return { name: spec.slice(0, at), range, explicit: spec.slice(at + 1).length > 0 };
  }
  const at = spec.indexOf('@');
  if (at < 0) return { name: spec, range: 'latest', explicit: false };
  const range = spec.slice(at + 1) || 'latest';
  const unsupported = unsupportedDependencySpec(range);
  if (unsupported) throwUnsupportedDependencySpec(spec, unsupported);
  return { name: spec.slice(0, at), range, explicit: spec.slice(at + 1).length > 0 };
}

function unsupportedDependencySpec(range: string): string | null {
  const trimmed = range.trim();
  if (trimmed === '.' || trimmed === '..') return 'file';
  if (/^(?:\.{0,2}\/|\/)/.test(trimmed)) return 'file';
  if (/^(file|link):/.test(trimmed)) return 'file';
  if (trimmed.startsWith('workspace:')) return 'workspace';
  if (/^(git\+|git:|github:|gitlab:|bitbucket:)/.test(trimmed) || /\.git(?:#|$)/.test(trimmed)) {
    return 'git';
  }
  if (/^https?:/.test(trimmed)) return 'http-tarball';
  if (trimmed.startsWith('npm:')) return 'npm-alias';
  if (isGithubShorthand(trimmed)) return 'git';
  return null;
}

function isGithubShorthand(spec: string): boolean {
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:[#@].+)?$/.test(spec);
}

function throwUnsupportedDependencySpec(spec: string, feature: string): never {
  throw new NotImplementedError(
    `npm-client.dependency-spec.${feature}`,
    `${spec} is outside registry semver/tag installs`,
  );
}

export async function readPackageJson(vfs: Vfs, cwd: string): Promise<ProjectPackageJson> {
  const path = `${cwd}/package.json`;
  if (!(await vfs.exists(path))) {
    return {
      raw: { name: DEFAULT_PROJECT_NAME, version: DEFAULT_PROJECT_VERSION, private: true },
      name: DEFAULT_PROJECT_NAME,
      version: DEFAULT_PROJECT_VERSION,
      scripts: {},
      dependencies: {},
      devDependencies: {},
      optionalDependencies: {},
    };
  }
  const text = await vfs.readFileText(path);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch (err) {
    throw new Error(`npm: package.json at ${path} is not valid JSON: ${(err as Error).message}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`npm: package.json at ${path} must be an object`);
  }
  const raw = parsed as Record<string, unknown>;
  const dependencies = readPackageJsonStringMap(raw, 'dependencies');
  const scripts = readPackageJsonScripts(raw);
  const devDependencies = readPackageJsonStringMap(raw, 'devDependencies');
  const optionalDependencies = readPackageJsonStringMap(raw, 'optionalDependencies');
  return {
    raw,
    name: typeof raw.name === 'string' ? raw.name : DEFAULT_PROJECT_NAME,
    version: typeof raw.version === 'string' ? raw.version : DEFAULT_PROJECT_VERSION,
    scripts,
    dependencies,
    devDependencies,
    optionalDependencies,
  };
}

function readPackageJsonStringMap(
  raw: Record<string, unknown>,
  field: string,
): Record<string, string> {
  const value = raw[field];
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    // TODO(backlog: npm-client/tar-symlink-and-nonregistry-dep-tracking)
    throw new NotImplementedError(`npm-client.package-json.${field}`);
  }
  const out: Record<string, string> = {};
  for (const [name, range] of Object.entries(value)) {
    if (typeof range !== 'string') {
      // TODO(backlog: npm-client/tar-symlink-and-nonregistry-dep-tracking)
      throw new NotImplementedError(`npm-client.package-json.${field}`);
    }
    out[name] = range;
  }
  return out;
}

export function readPackageJsonScripts(raw: Record<string, unknown>): Record<string, string> {
  return raw.scripts && typeof raw.scripts === 'object' && !Array.isArray(raw.scripts)
    ? Object.fromEntries(
        Object.entries(raw.scripts).filter(
          (entry): entry is [string, string] => typeof entry[1] === 'string',
        ),
      )
    : {};
}

export async function writePackageJson(
  vfs: Vfs,
  cwd: string,
  pkg: ProjectPackageJson,
): Promise<void> {
  const path = `${cwd}/package.json`;
  // Stable formatting: re-installs with an unchanged dep set produce
  // byte-identical output, so the shell's diff-before-write keeps mtimes stable.
  await vfs.writeFile(path, serializeProjectPackageJson(pkg));
}

export function serializeProjectPackageJson(pkg: ProjectPackageJson): string {
  return `${JSON.stringify(pkg.raw, null, 2)}\n`;
}
