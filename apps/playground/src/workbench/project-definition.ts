import type { PreviewHandle } from './preview-readiness.ts';

declare const projectDefinitionReady: unique symbol;
declare const inspectedProjectDefinitionReady: unique symbol;

export interface ProjectDefinition<TReady> {
  readonly [projectDefinitionReady]: TReady;
}

export interface ViteProjectDefinitionOptions {
  readonly id: string;
  readonly files: Readonly<Record<string, string | Uint8Array>>;
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly devDependencies?: Readonly<Record<string, string>>;
  readonly viteVersion?: string;
}

interface ProjectDefinitionData {
  readonly kind: 'vite';
  readonly id: string;
  readonly storageSegment: string;
  readonly identity: string;
  readonly files: Readonly<Record<string, Uint8Array>>;
}

/** Package-internal structured-clone payload; never part of the public root. */
export interface ProjectDefinitionWire {
  readonly kind: 'vite';
  readonly id: string;
  /** Page claim checked against exact owner-received bytes at owner ingress. */
  readonly identity: string;
  readonly files: Readonly<Record<string, Uint8Array>>;
}

export interface InspectedProjectDefinition<TReady = unknown> extends ProjectDefinitionData {
  readonly [inspectedProjectDefinitionReady]: TReady;
}

type StoredProjectDefinition = ProjectDefinitionData;

const definitions = new WeakMap<object, StoredProjectDefinition>();
const encoder = new TextEncoder();
const manifestDecoder = new TextDecoder('utf-8', { fatal: true });
const DEFAULT_VITE_VERSION = '8.0.16';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertId(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError('Project definition id must be a non-empty string');
  }
  return value;
}

function utf16Hex(value: string): string {
  let encoded = '';
  for (let index = 0; index < value.length; index += 1) {
    encoded += value.charCodeAt(index).toString(16).padStart(4, '0');
  }
  return encoded;
}

export function projectStorageSegment(id: string): string {
  const validId = assertId(id);
  if (
    /^[A-Za-z0-9._-]+$/.test(validId) &&
    validId !== '.' &&
    validId !== '..' &&
    !validId.startsWith('~')
  ) {
    return validId;
  }
  return `~${utf16Hex(validId)}`;
}

function assertProjectPath(value: string): string {
  if (!value.startsWith('/') || value === '/' || value.includes('\0')) {
    throw new TypeError(`Project file path must be an absolute project-rooted file: ${value}`);
  }
  const segments = value.split('/');
  if (segments.some((segment, index) => index > 0 && (segment === '' || segment === '.'))) {
    throw new TypeError(`Project file path must be normalized: ${value}`);
  }
  if (segments.includes('..')) {
    throw new TypeError(`Project file path must not traverse its project root: ${value}`);
  }
  if (value === '/.rifty' || value.startsWith('/.rifty/')) {
    throw new TypeError(`Project file path uses reserved Workbench metadata: ${value}`);
  }
  return value;
}

function cloneFiles(value: unknown): Record<string, Uint8Array> {
  if (!isRecord(value)) throw new TypeError('Project definition files must be an object');
  const files: Record<string, Uint8Array> = {};
  for (const [rawPath, data] of Object.entries(value)) {
    const path = assertProjectPath(rawPath);
    if (typeof data === 'string') files[path] = encoder.encode(data);
    else if (data instanceof Uint8Array) files[path] = data.slice();
    else throw new TypeError(`Project file ${path} must be a string or Uint8Array`);
  }
  return files;
}

function cloneWireFiles(value: unknown): Record<string, Uint8Array> {
  if (!isPlainRecord(value)) {
    throw new TypeError('Project definition wire files must be a plain object');
  }
  const files: Record<string, Uint8Array> = {};
  for (const [rawPath, data] of Object.entries(value)) {
    const path = assertProjectPath(rawPath);
    if (!(data instanceof Uint8Array)) {
      throw new TypeError(`Project definition wire file ${path} must be a Uint8Array`);
    }
    files[path] = data.slice();
  }
  return files;
}

function dependencyMap(value: unknown, field: string): Record<string, string> | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new TypeError(`${field} must be an object`);
  const result: Record<string, string> = {};
  for (const [name, version] of Object.entries(value)) {
    if (name.length === 0 || typeof version !== 'string' || version.length === 0) {
      throw new TypeError(`${field}.${name || '<empty>'} must be a non-empty string`);
    }
    Object.defineProperty(result, name, {
      value: version,
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  return result;
}

function mergeDependencies(
  base: Record<string, string> | undefined,
  overrides: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (base === undefined && overrides === undefined) return undefined;
  return { ...(base ?? {}), ...(overrides ?? {}) };
}

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

function canonicalJson(value: JsonValue): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key] as JsonValue)}`)
    .join(',')}}`;
}

function parseManifest(files: Record<string, Uint8Array>): Record<string, unknown> {
  const bytes = files['/package.json'];
  if (bytes === undefined) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(manifestDecoder.decode(bytes));
  } catch (error) {
    throw new TypeError(
      `Project /package.json must contain a UTF-8 JSON object: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!isRecord(parsed)) throw new TypeError('Project /package.json must contain a JSON object');
  return parsed;
}

function normalizeManifest(
  files: Record<string, Uint8Array>,
  options: ViteProjectDefinitionOptions,
): void {
  const manifest = parseManifest(files);
  const dependencies = mergeDependencies(
    dependencyMap(manifest.dependencies, 'package.json dependencies'),
    dependencyMap(options.dependencies, 'Project dependencies'),
  );
  let devDependencies = mergeDependencies(
    dependencyMap(manifest.devDependencies, 'package.json devDependencies'),
    dependencyMap(options.devDependencies, 'Project devDependencies'),
  );
  const viteVersion = options.viteVersion;
  if (viteVersion !== undefined && (typeof viteVersion !== 'string' || viteVersion.length === 0)) {
    throw new TypeError('viteVersion must be a non-empty string');
  }
  const dependencyVite = dependencies?.vite;
  const devDependencyVite = devDependencies?.vite;
  if (viteVersion !== undefined) {
    if (dependencyVite !== undefined || devDependencyVite !== undefined) {
      throw new TypeError('viteVersion is mutually exclusive with a supplied Vite dependency');
    }
    devDependencies = { ...(devDependencies ?? {}), vite: viteVersion };
  } else if (dependencyVite !== undefined && devDependencyVite !== undefined) {
    throw new TypeError('Vite must be declared in exactly one final dependency section');
  } else if (dependencyVite === undefined && devDependencyVite === undefined) {
    devDependencies = { ...(devDependencies ?? {}), vite: DEFAULT_VITE_VERSION };
  }

  if (dependencies === undefined) Reflect.deleteProperty(manifest, 'dependencies');
  else manifest.dependencies = dependencies;
  if (devDependencies === undefined) Reflect.deleteProperty(manifest, 'devDependencies');
  else manifest.devDependencies = devDependencies;
  files['/package.json'] = encoder.encode(`${canonicalJson(manifest as JsonValue)}\n`);
}

function bytesHex(bytes: Uint8Array): string {
  let result = '';
  for (const byte of bytes) result += byte.toString(16).padStart(2, '0');
  return result;
}

function exactIdentity(kind: 'vite', id: string, files: Record<string, Uint8Array>): string {
  const fields = [`kind:${kind}`, `id:${utf16Hex(id)}`];
  for (const path of Object.keys(files).sort()) {
    fields.push(`path:${utf16Hex(path)}`, `bytes:${bytesHex(files[path] as Uint8Array)}`);
  }
  return `workbench-definition:v1:${fields.map((field) => `${field.length}:${field}`).join('')}`;
}

function frozenFileSnapshot(
  files: Readonly<Record<string, Uint8Array>>,
): Readonly<Record<string, Uint8Array>> {
  const snapshot: Record<string, Uint8Array> = {};
  for (const [path, bytes] of Object.entries(files)) snapshot[path] = bytes.slice();
  return Object.freeze(snapshot);
}

function createViteDefinition(
  options: ViteProjectDefinitionOptions,
): ProjectDefinition<PreviewHandle> {
  if (!isRecord(options)) throw new TypeError('projects.vite options must be an object');
  const id = assertId(options.id);
  const files = cloneFiles(options.files);
  normalizeManifest(files, options);
  const stored: StoredProjectDefinition = Object.freeze({
    kind: 'vite',
    id,
    storageSegment: projectStorageSegment(id),
    identity: exactIdentity('vite', id, files),
    files: frozenFileSnapshot(files),
  });
  const definition = Object.freeze({}) as ProjectDefinition<PreviewHandle>;
  definitions.set(definition, stored);
  return definition;
}

export const projects = Object.freeze({
  vite: createViteDefinition,
});

export function inspectProjectDefinition<TReady>(
  definition: ProjectDefinition<TReady>,
): InspectedProjectDefinition<TReady> {
  const stored =
    typeof definition === 'object' && definition !== null ? definitions.get(definition) : undefined;
  if (stored === undefined) throw new TypeError('Invalid or forged ProjectDefinition');
  return Object.freeze({
    kind: stored.kind,
    id: stored.id,
    storageSegment: stored.storageSegment,
    identity: stored.identity,
    files: frozenFileSnapshot(stored.files),
  }) as InspectedProjectDefinition<TReady>;
}

/** Snapshot page-inspected intent into the sole clone-safe owner payload. */
export function projectDefinitionWire(
  definition: InspectedProjectDefinition,
): ProjectDefinitionWire {
  return Object.freeze({
    kind: definition.kind,
    id: definition.id,
    identity: definition.identity,
    files: frozenFileSnapshot(definition.files),
  });
}

/**
 * Owner ingress for project intent. Derived values are born here; neither an
 * identity nor a storage path supplied by the page is trusted as authority.
 */
export function inspectProjectDefinitionWire(value: unknown): InspectedProjectDefinition {
  if (!isRecord(value) || !hasExactKeys(value, ['kind', 'id', 'identity', 'files'])) {
    throw new TypeError('Invalid project definition wire');
  }
  if (value.kind !== 'vite') throw new TypeError('Invalid project definition wire kind');
  const id = assertId(value.id);
  if (typeof value.identity !== 'string' || value.identity.length === 0) {
    throw new TypeError('Invalid project definition wire identity');
  }
  const files = cloneWireFiles(value.files);
  const identity = exactIdentity('vite', id, files);
  if (value.identity !== identity) {
    throw new TypeError('Project definition wire identity does not match exact received bytes');
  }
  return Object.freeze({
    kind: 'vite',
    id,
    storageSegment: projectStorageSegment(id),
    identity,
    files: frozenFileSnapshot(files),
  }) as InspectedProjectDefinition;
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value);
  return (
    actual.length === expected.length &&
    expected.every((key) => Object.prototype.hasOwnProperty.call(value, key))
  );
}
