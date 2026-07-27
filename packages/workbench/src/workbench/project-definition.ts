import { serializePackageJson } from '@riftydev/npm-client';
import { nodeProjectRootShellCommand } from './internal/node-command.ts';
import { defineOwnEnumerableProperty } from './internal/own-property.ts';
import {
  DEFAULT_VITE8_CONFIG_JS,
  DEFAULT_VITE8_CONFIG_PATH,
  DEFAULT_VITE8_VERSION,
  VITE8_WASI_RUNTIME_OVERRIDE,
  VITE8_WASI_RUNTIME_OVERRIDE_NAME,
  VITE_CONFIG_FILENAMES,
} from './internal/vite-project-policy.ts';
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

interface NodeProjectDefinitionOptions {
  readonly id: string;
  readonly files: Readonly<Record<string, string | Uint8Array>>;
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly devDependencies?: Readonly<Record<string, string>>;
  readonly entryPath: string;
}

export interface NodeServerProjectDefinitionOptions extends NodeProjectDefinitionOptions {
  readonly port: number;
}

export interface NodeCliProjectDefinitionOptions extends NodeProjectDefinitionOptions {
  readonly args?: readonly string[];
}

interface ProjectDefinitionBase {
  readonly id: string;
  readonly storageSegment: string;
  readonly identity: string;
  readonly files: Readonly<Record<string, Uint8Array>>;
}

interface ViteProjectDefinitionData extends ProjectDefinitionBase {
  readonly kind: 'vite';
}

interface NodeServerProjectDefinitionData extends ProjectDefinitionBase {
  readonly kind: 'node-server';
  readonly entryPath: string;
  readonly port: number;
}

interface NodeCliProjectDefinitionData extends ProjectDefinitionBase {
  readonly kind: 'node-cli';
  readonly entryPath: string;
  readonly args: readonly string[];
}

type ProjectDefinitionData =
  | ViteProjectDefinitionData
  | NodeServerProjectDefinitionData
  | NodeCliProjectDefinitionData;

interface ProjectDefinitionWireBase {
  readonly id: string;
  /** Page claim checked against exact owner-received bytes at owner ingress. */
  readonly identity: string;
  readonly files: Readonly<Record<string, Uint8Array>>;
}

interface ViteProjectDefinitionWire extends ProjectDefinitionWireBase {
  readonly kind: 'vite';
}

interface NodeServerProjectDefinitionWire extends ProjectDefinitionWireBase {
  readonly kind: 'node-server';
  readonly entryPath: string;
  readonly port: number;
}

interface NodeCliProjectDefinitionWire extends ProjectDefinitionWireBase {
  readonly kind: 'node-cli';
  readonly entryPath: string;
  readonly args: readonly string[];
}

/** Package-internal structured-clone payload; never part of the public root. */
export type ProjectDefinitionWire =
  | ViteProjectDefinitionWire
  | NodeServerProjectDefinitionWire
  | NodeCliProjectDefinitionWire;

export type InspectedProjectDefinition<TReady = unknown> = ProjectDefinitionData & {
  readonly [inspectedProjectDefinitionReady]: TReady;
};

type StoredProjectDefinition = ProjectDefinitionData;

const definitions = new WeakMap<object, StoredProjectDefinition>();
const encoder = new TextEncoder();
const manifestDecoder = new TextDecoder('utf-8', { fatal: true });

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
    defineOwnEnumerableProperty(result, name, version);
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
): boolean {
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
    devDependencies = { ...(devDependencies ?? {}), vite: DEFAULT_VITE8_VERSION };
  }
  const finalViteVersion =
    viteVersion ?? dependencyVite ?? devDependencyVite ?? DEFAULT_VITE8_VERSION;

  if (dependencies === undefined) Reflect.deleteProperty(manifest, 'dependencies');
  else manifest.dependencies = dependencies;
  if (devDependencies === undefined) Reflect.deleteProperty(manifest, 'devDependencies');
  else manifest.devDependencies = devDependencies;
  if (finalViteVersion === DEFAULT_VITE8_VERSION) {
    const suppliedOverrides = manifest.overrides;
    if (suppliedOverrides !== undefined && !isRecord(suppliedOverrides)) {
      throw new TypeError('package.json overrides must be an object');
    }
    const overrides: Record<string, unknown> = {};
    for (const [name, value] of Object.entries(suppliedOverrides ?? {})) {
      defineOwnEnumerableProperty(overrides, name, value);
    }
    if (!Object.prototype.hasOwnProperty.call(overrides, VITE8_WASI_RUNTIME_OVERRIDE_NAME)) {
      defineOwnEnumerableProperty(
        overrides,
        VITE8_WASI_RUNTIME_OVERRIDE_NAME,
        VITE8_WASI_RUNTIME_OVERRIDE,
      );
    }
    manifest.overrides = overrides;
  }
  // TODO(backlog: playground/workbench-implicit-vite-module-scope)
  files['/package.json'] = encoder.encode(serializePackageJson(manifest));
  return (
    viteVersion === undefined && dependencyVite === undefined && devDependencyVite === undefined
  );
}

function normalizeNodeManifest(
  files: Record<string, Uint8Array>,
  options: NodeProjectDefinitionOptions,
  serverEntryPath?: string,
): void {
  const manifest = parseManifest(files);
  const dependencies = mergeDependencies(
    dependencyMap(manifest.dependencies, 'package.json dependencies'),
    dependencyMap(options.dependencies, 'Project dependencies'),
  );
  const devDependencies = mergeDependencies(
    dependencyMap(manifest.devDependencies, 'package.json devDependencies'),
    dependencyMap(options.devDependencies, 'Project devDependencies'),
  );
  if (dependencies === undefined) Reflect.deleteProperty(manifest, 'dependencies');
  else manifest.dependencies = dependencies;
  if (devDependencies === undefined) Reflect.deleteProperty(manifest, 'devDependencies');
  else manifest.devDependencies = devDependencies;
  if (serverEntryPath !== undefined) {
    const suppliedScripts = manifest.scripts;
    if (suppliedScripts !== undefined && !isRecord(suppliedScripts)) {
      throw new TypeError('package.json scripts must be an object');
    }
    const scripts: Record<string, string> = {};
    for (const [name, command] of Object.entries(suppliedScripts ?? {})) {
      if (name.length === 0 || typeof command !== 'string') {
        throw new TypeError(`package.json scripts.${name || '<empty>'} must be a string`);
      }
      defineOwnEnumerableProperty(scripts, name, command);
    }
    if (!Object.hasOwn(scripts, 'dev')) {
      scripts.dev = nodeProjectRootShellCommand(serverEntryPath);
    }
    manifest.scripts = scripts;
  }
  files['/package.json'] = encoder.encode(serializePackageJson(manifest));
}

function nodeEntryPath(value: unknown, files: Record<string, Uint8Array>): string {
  if (typeof value !== 'string') throw new TypeError('Node project entry must be a string');
  let entryPath: string;
  try {
    entryPath = assertProjectPath(value);
  } catch (error) {
    throw new TypeError(
      `Node project entry is invalid: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  if (!Object.prototype.hasOwnProperty.call(files, entryPath)) {
    throw new TypeError(`Node project entry is absent from files: ${entryPath}`);
  }
  return entryPath;
}

function nodeServerPort(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > 65_535) {
    throw new RangeError('Node server port must be an integer from 1 to 65535');
  }
  return value as number;
}

function nodeCliArgs(value: unknown): readonly string[] {
  if (value === undefined) return Object.freeze([]);
  if (!Array.isArray(value)) throw new TypeError('Node CLI arguments must be an array');
  const args = value.map((argument, index) => {
    if (typeof argument !== 'string') {
      throw new TypeError(`Node CLI argument ${index} must be a string`);
    }
    if (argument.includes('\0')) {
      throw new TypeError(`Node CLI argument ${index} must not contain NUL`);
    }
    return argument;
  });
  return Object.freeze(args);
}

function normalizeDefaultVite8Config(
  files: Record<string, Uint8Array>,
  usesBuiltInDefault: boolean,
): void {
  if (!usesBuiltInDefault) return;
  const configOwned = VITE_CONFIG_FILENAMES.some((name) =>
    Object.prototype.hasOwnProperty.call(files, `/${name}`),
  );
  if (!configOwned) files[DEFAULT_VITE8_CONFIG_PATH] = encoder.encode(DEFAULT_VITE8_CONFIG_JS);
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

function exactNodeIdentity(
  kind: 'node-server' | 'node-cli',
  id: string,
  files: Record<string, Uint8Array>,
  entryPath: string,
  runtimeFields: readonly string[],
): string {
  const fields = [
    `kind:${kind}`,
    `id:${utf16Hex(id)}`,
    `entry:${utf16Hex(entryPath)}`,
    ...runtimeFields,
  ];
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
  normalizeDefaultVite8Config(files, normalizeManifest(files, options));
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

export function defineNodeServerProject(
  options: NodeServerProjectDefinitionOptions,
): ProjectDefinition<PreviewHandle> {
  if (!isRecord(options)) throw new TypeError('Node server project options must be an object');
  const id = assertId(options.id);
  const files = cloneFiles(options.files);
  const entryPath = nodeEntryPath(options.entryPath, files);
  const port = nodeServerPort(options.port);
  normalizeNodeManifest(files, options, entryPath);
  const stored: NodeServerProjectDefinitionData = Object.freeze({
    kind: 'node-server',
    id,
    storageSegment: projectStorageSegment(id),
    identity: exactNodeIdentity('node-server', id, files, entryPath, [`port:${port}`]),
    files: frozenFileSnapshot(files),
    entryPath,
    port,
  });
  const definition = Object.freeze({}) as ProjectDefinition<PreviewHandle>;
  definitions.set(definition, stored);
  return definition;
}

export function defineNodeCliProject(
  options: NodeCliProjectDefinitionOptions,
): ProjectDefinition<void> {
  if (!isRecord(options)) throw new TypeError('Node CLI project options must be an object');
  const id = assertId(options.id);
  const files = cloneFiles(options.files);
  const entryPath = nodeEntryPath(options.entryPath, files);
  const args = nodeCliArgs(options.args);
  normalizeNodeManifest(files, options);
  const stored: NodeCliProjectDefinitionData = Object.freeze({
    kind: 'node-cli',
    id,
    storageSegment: projectStorageSegment(id),
    identity: exactNodeIdentity(
      'node-cli',
      id,
      files,
      entryPath,
      args.map((argument) => `arg:${utf16Hex(argument)}`),
    ),
    files: frozenFileSnapshot(files),
    entryPath,
    args,
  });
  const definition = Object.freeze({}) as ProjectDefinition<void>;
  definitions.set(definition, stored);
  return definition;
}

export const projects = Object.freeze({
  vite: createViteDefinition,
});

type DefinitionReady<TDefinition> = TDefinition extends ProjectDefinition<infer TReady>
  ? TReady
  : never;

export function inspectProjectDefinition<TDefinition extends ProjectDefinition<unknown>>(
  definition: TDefinition,
): InspectedProjectDefinition<DefinitionReady<TDefinition>> {
  const stored =
    typeof definition === 'object' && definition !== null ? definitions.get(definition) : undefined;
  if (stored === undefined) throw new TypeError('Invalid or forged ProjectDefinition');
  const base = {
    kind: stored.kind,
    id: stored.id,
    storageSegment: stored.storageSegment,
    identity: stored.identity,
    files: frozenFileSnapshot(stored.files),
  } as const;
  if (stored.kind === 'node-server') {
    return Object.freeze({
      ...base,
      entryPath: stored.entryPath,
      port: stored.port,
    }) as InspectedProjectDefinition<DefinitionReady<TDefinition>>;
  }
  if (stored.kind === 'node-cli') {
    return Object.freeze({
      ...base,
      entryPath: stored.entryPath,
      args: Object.freeze([...stored.args]),
    }) as InspectedProjectDefinition<DefinitionReady<TDefinition>>;
  }
  return Object.freeze(base) as InspectedProjectDefinition<DefinitionReady<TDefinition>>;
}

/** Snapshot page-inspected intent into the sole clone-safe owner payload. */
export function projectDefinitionWire(
  definition: InspectedProjectDefinition,
): ProjectDefinitionWire {
  const base = {
    id: definition.id,
    identity: definition.identity,
    files: frozenFileSnapshot(definition.files),
  } as const;
  if (definition.kind === 'node-server') {
    return Object.freeze({
      ...base,
      kind: 'node-server' as const,
      entryPath: definition.entryPath,
      port: definition.port,
    });
  }
  if (definition.kind === 'node-cli') {
    return Object.freeze({
      ...base,
      kind: 'node-cli' as const,
      entryPath: definition.entryPath,
      args: Object.freeze([...definition.args]),
    });
  }
  return Object.freeze({ ...base, kind: 'vite' as const });
}

/**
 * Owner ingress for project intent. Derived values are born here; neither an
 * identity nor a storage path supplied by the page is trusted as authority.
 */
export function inspectProjectDefinitionWire(value: unknown): InspectedProjectDefinition {
  if (!isRecord(value)) throw new TypeError('Invalid project definition wire');
  const expectedKeys =
    value.kind === 'vite'
      ? ['kind', 'id', 'identity', 'files']
      : value.kind === 'node-server'
        ? ['kind', 'id', 'identity', 'files', 'entryPath', 'port']
        : value.kind === 'node-cli'
          ? ['kind', 'id', 'identity', 'files', 'entryPath', 'args']
          : null;
  if (expectedKeys === null) throw new TypeError('Invalid project definition wire kind');
  if (!hasExactKeys(value, expectedKeys)) throw new TypeError('Invalid project definition wire');
  const id = assertId(value.id);
  if (typeof value.identity !== 'string' || value.identity.length === 0) {
    throw new TypeError('Invalid project definition wire identity');
  }
  const files = cloneWireFiles(value.files);
  let identity: string;
  let runtimeFields:
    | { readonly kind: 'vite' }
    | { readonly kind: 'node-server'; readonly entryPath: string; readonly port: number }
    | { readonly kind: 'node-cli'; readonly entryPath: string; readonly args: readonly string[] };
  if (value.kind === 'node-server') {
    const entryPath = nodeEntryPath(value.entryPath, files);
    const port = nodeServerPort(value.port);
    identity = exactNodeIdentity('node-server', id, files, entryPath, [`port:${port}`]);
    runtimeFields = { kind: 'node-server', entryPath, port };
  } else if (value.kind === 'node-cli') {
    const entryPath = nodeEntryPath(value.entryPath, files);
    const args = nodeCliArgs(value.args);
    identity = exactNodeIdentity(
      'node-cli',
      id,
      files,
      entryPath,
      args.map((argument) => `arg:${utf16Hex(argument)}`),
    );
    runtimeFields = { kind: 'node-cli', entryPath, args };
  } else {
    identity = exactIdentity('vite', id, files);
    runtimeFields = { kind: 'vite' };
  }
  if (value.identity !== identity) {
    throw new TypeError('Project definition wire identity does not match exact received bytes');
  }
  const base = {
    id,
    storageSegment: projectStorageSegment(id),
    identity,
    files: frozenFileSnapshot(files),
  } as const;
  if (runtimeFields.kind === 'node-server') {
    return Object.freeze({ ...base, ...runtimeFields }) as InspectedProjectDefinition;
  }
  if (runtimeFields.kind === 'node-cli') {
    return Object.freeze({ ...base, ...runtimeFields }) as InspectedProjectDefinition;
  }
  return Object.freeze({ ...base, ...runtimeFields }) as InspectedProjectDefinition;
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Reflect.ownKeys(value);
  return (
    actual.length === expected.length &&
    actual.every((key) => typeof key === 'string' && expected.includes(key)) &&
    expected.every((key) => Object.prototype.hasOwnProperty.call(value, key))
  );
}
