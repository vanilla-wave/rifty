import type {
  NodeCliPlaygroundPlan,
  NodeServerPlaygroundPlan,
  PlaygroundFirstMaterialization,
  PlaygroundProjectPlan,
  VitePlaygroundPlan,
} from '../playground.ts';
import type { PreviewHandle } from '../preview-readiness.ts';
import {
  type InspectedProjectDefinition,
  type ProjectDefinition,
  type ProjectDefinitionWire,
  defineNodeCliProject,
  defineNodeServerProject,
  inspectProjectDefinition,
  inspectProjectDefinitionWire,
  projectDefinitionWire,
  projects,
} from '../project-definition.ts';

export interface CapturedPlaygroundUrlContext {
  readonly apiBaseUrl: string;
  readonly clientUrl: string;
}

type PlaygroundDefinitionMetadata = {
  readonly scope: CapturedPlaygroundUrlContext;
  readonly starterId: string;
  readonly templateId: string;
  readonly baselineFingerprint: string;
  readonly identity: string;
  readonly firstMaterialization: PlaygroundFirstMaterialization;
  readonly plan: PlaygroundProjectPlan;
  readonly port?: number;
};

export interface PlaygroundProjectDefinitionWire {
  readonly definition: ProjectDefinitionWire;
  readonly plan: PlaygroundProjectPlan;
}

export type InspectedPlaygroundProjectDefinition<TReady = unknown> =
  InspectedProjectDefinition<TReady> & {
    readonly identity: string;
    readonly starterId: string;
    readonly templateId: string;
    readonly baselineFingerprint: string;
    readonly firstMaterialization: PlaygroundFirstMaterialization;
    readonly port?: number;
  };

const metadataByDefinition = new WeakMap<object, PlaygroundDefinitionMetadata>();

function fail(path: string, detail: string): never {
  throw new TypeError(`${path} ${detail}`);
}

function isPlainObject(value: unknown): value is object {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function dataProperties(
  value: unknown,
  path: string,
  expectedKeys: readonly string[],
): Readonly<Record<string, unknown>> {
  if (!isPlainObject(value)) fail(path, 'must be a plain object');
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== expectedKeys.length ||
    keys.some((key) => typeof key !== 'string' || !expectedKeys.includes(key)) ||
    expectedKeys.some((key) => !Object.prototype.hasOwnProperty.call(value, key))
  ) {
    fail(path, `must have exactly ${expectedKeys.join(', ')}`);
  }
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of expectedKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      descriptor === undefined ||
      descriptor.enumerable !== true ||
      descriptor.get !== undefined ||
      descriptor.set !== undefined ||
      !Object.prototype.hasOwnProperty.call(descriptor, 'value')
    ) {
      fail(`${path}.${key}`, 'must be an enumerable data property');
    }
    result[key] = descriptor.value;
  }
  return result;
}

function optionalKeys(value: object, required: readonly string[], optional: readonly string[]) {
  const actual = Reflect.ownKeys(value);
  if (actual.some((key) => typeof key !== 'string')) fail('plan', 'must not have symbol keys');
  const strings = actual as string[];
  for (const key of required) {
    if (!strings.includes(key)) fail('plan', `is missing ${key}`);
  }
  for (const key of strings) {
    if (!required.includes(key) && !optional.includes(key)) fail('plan', `has unknown key ${key}`);
  }
  return strings;
}

function stringValue(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\0')) {
    fail(path, 'must be a non-empty NUL-free string');
  }
  return value;
}

function portValue(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > 65_535) {
    throw new TypeError(`${path} must be an integer from 1 to 65535`);
  }
  return value as number;
}

function projectPath(value: unknown, path: string): string {
  const candidate = stringValue(value, path);
  if (!candidate.startsWith('/') || candidate === '/') {
    fail(path, 'must be an absolute project-rooted file path');
  }
  const segments = candidate.split('/');
  if (segments.some((segment, index) => index > 0 && (segment === '' || segment === '.'))) {
    fail(path, 'must be normalized');
  }
  if (segments.includes('..')) fail(path, 'must not traverse the project root');
  if (candidate === '/.rifty' || candidate.startsWith('/.rifty/')) {
    fail(path, 'uses reserved Workbench metadata');
  }
  return candidate;
}

function exactByteView(value: unknown, path: string): Uint8Array {
  if (!(value instanceof Uint8Array) || Object.getPrototypeOf(value) !== Uint8Array.prototype) {
    fail(path, 'must be a string or plain Uint8Array');
  }
  const expectedKeys = Array.from({ length: value.length }, (_unused, index) => String(index));
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== expectedKeys.length ||
    keys.some((key, index) => key !== expectedKeys[index])
  ) {
    fail(path, 'must be an exact Uint8Array without extra properties');
  }
  for (const key of expectedKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      descriptor === undefined ||
      descriptor.enumerable !== true ||
      descriptor.get !== undefined ||
      descriptor.set !== undefined ||
      typeof descriptor.value !== 'number'
    ) {
      fail(`${path}[${key}]`, 'must be an enumerable byte data property');
    }
  }
  return value.slice();
}

function recordEntries(value: unknown, path: string): readonly [string, unknown][] {
  if (!isPlainObject(value)) fail(path, 'must be a plain object');
  const entries: [string, unknown][] = [];
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string') fail(path, 'must not have symbol keys');
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      descriptor === undefined ||
      descriptor.enumerable !== true ||
      descriptor.get !== undefined ||
      descriptor.set !== undefined ||
      !Object.prototype.hasOwnProperty.call(descriptor, 'value')
    ) {
      fail(`${path}.${key}`, 'must be an enumerable data property');
    }
    entries.push([key, descriptor.value]);
  }
  return entries;
}

function ownedFiles(value: unknown): Readonly<Record<string, string | Uint8Array>> {
  const files: Record<string, string | Uint8Array> = {};
  for (const [rawPath, contents] of recordEntries(value, 'plan.files')) {
    const path = projectPath(rawPath, `plan.files.${rawPath}`);
    if (typeof contents === 'string') files[path] = contents;
    else files[path] = exactByteView(contents, `plan.files.${rawPath}`);
  }
  return Object.freeze(files);
}

function ownedStringMap(
  value: unknown,
  path: string,
): Readonly<Record<string, string>> | undefined {
  if (value === undefined) return undefined;
  const result: Record<string, string> = {};
  for (const [name, version] of recordEntries(value, path)) {
    if (name.length === 0 || name.includes('\0')) fail(path, 'has an invalid empty or NUL key');
    result[name] = stringValue(version, `${path}.${name}`);
  }
  return Object.freeze(result);
}

function ownedStringArray(value: unknown, path: string): readonly string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    fail(path, 'must be a plain array');
  }
  const expectedIndexKeys = Array.from({ length: value.length }, (_unused, index) => String(index));
  const expectedKeys = [...expectedIndexKeys, 'length'];
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== expectedKeys.length ||
    keys.some((key, index) => key !== expectedKeys[index])
  ) {
    fail(path, 'must be a dense array without extra properties');
  }
  const result: string[] = [];
  for (const key of expectedIndexKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      descriptor === undefined ||
      descriptor.enumerable !== true ||
      descriptor.get !== undefined ||
      descriptor.set !== undefined
    ) {
      fail(`${path}[${key}]`, 'must be an enumerable data property');
    }
    result.push(stringValue(descriptor.value, `${path}[${key}]`));
  }
  return Object.freeze(result);
}

function capturedContext(value: CapturedPlaygroundUrlContext): {
  readonly apiBaseUrl: URL;
  readonly clientUrl: URL;
} {
  const record = dataProperties(value, 'urlContext', ['apiBaseUrl', 'clientUrl']);
  const apiBaseUrl = new URL(stringValue(record.apiBaseUrl, 'urlContext.apiBaseUrl'));
  const clientUrl = new URL(stringValue(record.clientUrl, 'urlContext.clientUrl'));
  for (const [name, url] of [
    ['apiBaseUrl', apiBaseUrl],
    ['clientUrl', clientUrl],
  ] as const) {
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password) {
      fail(`urlContext.${name}`, 'must be a credential-free HTTP(S) URL');
    }
  }
  return { apiBaseUrl, clientUrl };
}

function ownedMaterialization(
  value: unknown,
  urlContext: CapturedPlaygroundUrlContext,
): PlaygroundFirstMaterialization {
  if (!isPlainObject(value)) fail('plan.firstMaterialization', 'must be a plain object');
  const kindDescriptor = Object.getOwnPropertyDescriptor(value, 'kind');
  if (
    kindDescriptor === undefined ||
    kindDescriptor.enumerable !== true ||
    kindDescriptor.get !== undefined ||
    kindDescriptor.set !== undefined
  ) {
    fail('plan.firstMaterialization.kind', 'must be an enumerable data property');
  }
  if (kindDescriptor.value === 'install') {
    dataProperties(value, 'plan.firstMaterialization', ['kind']);
    return Object.freeze({ kind: 'install' as const });
  }
  if (kindDescriptor.value !== 'snapshot') {
    fail('plan.firstMaterialization.kind', 'must be install or snapshot');
  }
  const materialization = dataProperties(value, 'plan.firstMaterialization', ['kind', 'snapshot']);
  const snapshot = dataProperties(materialization.snapshot, 'plan.firstMaterialization.snapshot', [
    'snapshotId',
    'assetUrl',
    'templateId',
  ]);
  const snapshotId = stringValue(
    snapshot.snapshotId,
    'plan.firstMaterialization.snapshot.snapshotId',
  );
  if (!/^sha256:[0-9a-f]{64}$/.test(snapshotId)) {
    fail(
      'plan.firstMaterialization.snapshot.snapshotId',
      'must be lowercase sha256:<64 hexadecimal digits>',
    );
  }
  const templateId = stringValue(
    snapshot.templateId,
    'plan.firstMaterialization.snapshot.templateId',
  );
  const { apiBaseUrl, clientUrl } = capturedContext(urlContext);
  let assetUrl: URL;
  try {
    assetUrl = new URL(
      stringValue(snapshot.assetUrl, 'plan.firstMaterialization.snapshot.assetUrl'),
      apiBaseUrl,
    );
  } catch (error) {
    throw new TypeError('plan.firstMaterialization.snapshot.assetUrl must be a valid URL', {
      cause: error,
    });
  }
  if (
    (assetUrl.protocol !== 'http:' && assetUrl.protocol !== 'https:') ||
    assetUrl.username !== '' ||
    assetUrl.password !== '' ||
    assetUrl.hash !== '' ||
    assetUrl.origin !== clientUrl.origin
  ) {
    fail(
      'plan.firstMaterialization.snapshot.assetUrl',
      'must be credential-free, fragment-free, client-same-origin HTTP(S)',
    );
  }
  return Object.freeze({
    kind: 'snapshot' as const,
    snapshot: Object.freeze({ snapshotId, assetUrl: assetUrl.href, templateId }),
  });
}

const BASE_KEYS = [
  'kind',
  'id',
  'starterId',
  'templateId',
  'files',
  'firstMaterialization',
] as const;
const BASE_OPTIONAL_KEYS = ['dependencies', 'devDependencies'] as const;

export function ownPlaygroundProjectPlan(
  value: PlaygroundProjectPlan,
  urlContext: CapturedPlaygroundUrlContext,
): PlaygroundProjectPlan {
  capturedContext(urlContext);
  if (!isPlainObject(value)) fail('plan', 'must be a plain object');
  const kindDescriptor = Object.getOwnPropertyDescriptor(value, 'kind');
  if (
    kindDescriptor === undefined ||
    kindDescriptor.enumerable !== true ||
    kindDescriptor.get !== undefined ||
    kindDescriptor.set !== undefined
  ) {
    fail('plan.kind', 'must be an enumerable data property');
  }
  const kind = kindDescriptor.value;
  const runtimeRequired =
    kind === 'vite'
      ? (['port'] as const)
      : kind === 'node-server'
        ? (['entryPath', 'port'] as const)
        : kind === 'node-cli'
          ? (['entryPath'] as const)
          : fail('plan.kind', 'must be vite, node-server, or node-cli');
  const runtimeOptional =
    kind === 'vite' ? (['viteVersion'] as const) : kind === 'node-cli' ? (['args'] as const) : [];
  const keys = optionalKeys(
    value,
    [...BASE_KEYS, ...runtimeRequired],
    [...BASE_OPTIONAL_KEYS, ...runtimeOptional],
  );
  const properties = dataProperties(value, 'plan', keys);
  const common = {
    kind,
    id: stringValue(properties.id, 'plan.id'),
    starterId: stringValue(properties.starterId, 'plan.starterId'),
    templateId: stringValue(properties.templateId, 'plan.templateId'),
    files: ownedFiles(properties.files),
    ...(properties.dependencies === undefined
      ? {}
      : { dependencies: ownedStringMap(properties.dependencies, 'plan.dependencies') }),
    ...(properties.devDependencies === undefined
      ? {}
      : { devDependencies: ownedStringMap(properties.devDependencies, 'plan.devDependencies') }),
    firstMaterialization: ownedMaterialization(properties.firstMaterialization, urlContext),
  } as const;
  if (kind === 'vite') {
    const viteVersion =
      properties.viteVersion === undefined
        ? undefined
        : stringValue(properties.viteVersion, 'plan.viteVersion');
    return Object.freeze({
      ...common,
      kind: 'vite',
      port: portValue(properties.port, 'plan.port'),
      ...(viteVersion === undefined ? {} : { viteVersion }),
    }) satisfies VitePlaygroundPlan;
  }
  if (kind === 'node-server') {
    return Object.freeze({
      ...common,
      kind: 'node-server',
      entryPath: projectPath(properties.entryPath, 'plan.entryPath'),
      port: portValue(properties.port, 'plan.port'),
    }) satisfies NodeServerPlaygroundPlan;
  }
  const args = ownedStringArray(properties.args, 'plan.args');
  return Object.freeze({
    ...common,
    kind: 'node-cli',
    entryPath: projectPath(properties.entryPath, 'plan.entryPath'),
    ...(args === undefined ? {} : { args }),
  }) satisfies NodeCliPlaygroundPlan;
}

function bytesHex(bytes: Uint8Array): string {
  let result = '';
  for (const byte of bytes) result += byte.toString(16).padStart(2, '0');
  return result;
}

function field(value: string): string {
  return `${String(value.length)}:${value}`;
}

function mapIdentity(
  name: string,
  value: Readonly<Record<string, string>> | undefined,
): readonly string[] {
  if (value === undefined) return [`${name}:absent`];
  return [
    `${name}:present`,
    ...Object.keys(value)
      .sort()
      .flatMap((key) => [`${name}-key:${key}`, `${name}-value:${value[key] as string}`]),
  ];
}

function identityFields(
  plan: PlaygroundProjectPlan,
  inspected: InspectedProjectDefinition,
  includeId: boolean,
): readonly string[] {
  const fields = [
    `kind:${plan.kind}`,
    ...(includeId ? [`id:${plan.id}`] : []),
    `starter:${plan.starterId}`,
    `template:${plan.templateId}`,
    ...mapIdentity('dependencies', plan.dependencies),
    ...mapIdentity('devDependencies', plan.devDependencies),
  ];
  if (plan.kind === 'vite') {
    fields.push(
      `port:${String(plan.port)}`,
      plan.viteVersion === undefined ? 'vite-version:absent' : `vite-version:${plan.viteVersion}`,
    );
  } else if (plan.kind === 'node-server') {
    fields.push(`entry:${plan.entryPath}`, `port:${String(plan.port)}`);
  } else {
    fields.push(`entry:${plan.entryPath}`, `args-count:${String(plan.args?.length ?? 0)}`);
    for (const argument of plan.args ?? []) fields.push(`arg:${argument}`);
  }
  if (plan.firstMaterialization.kind === 'install') {
    fields.push('materialization:install');
  } else {
    fields.push(
      'materialization:snapshot',
      `snapshot-id:${plan.firstMaterialization.snapshot.snapshotId}`,
      `snapshot-template:${plan.firstMaterialization.snapshot.templateId}`,
    );
  }
  for (const path of Object.keys(inspected.files).sort()) {
    fields.push(`path:${path}`, `bytes:${bytesHex(inspected.files[path] as Uint8Array)}`);
  }
  return fields;
}

function exactIdentity(prefix: string, fields: readonly string[]): string {
  return `${prefix}:${fields.map(field).join('')}`;
}

function createRootDefinition(plan: VitePlaygroundPlan): ProjectDefinition<PreviewHandle>;
function createRootDefinition(plan: NodeServerPlaygroundPlan): ProjectDefinition<PreviewHandle>;
function createRootDefinition(plan: NodeCliPlaygroundPlan): ProjectDefinition<void>;
function createRootDefinition(plan: PlaygroundProjectPlan): ProjectDefinition<unknown>;
function createRootDefinition(plan: PlaygroundProjectPlan): ProjectDefinition<unknown> {
  const common = {
    id: plan.id,
    files: plan.files,
    dependencies: plan.dependencies,
    devDependencies: plan.devDependencies,
  };
  if (plan.kind === 'vite') return projects.vite({ ...common, viteVersion: plan.viteVersion });
  if (plan.kind === 'node-server') {
    return defineNodeServerProject({ ...common, entryPath: plan.entryPath, port: plan.port });
  }
  return defineNodeCliProject({ ...common, entryPath: plan.entryPath, args: plan.args });
}

export function definePlaygroundProject(
  plan: VitePlaygroundPlan,
  urlContext: CapturedPlaygroundUrlContext,
): ProjectDefinition<PreviewHandle>;
export function definePlaygroundProject(
  plan: NodeServerPlaygroundPlan,
  urlContext: CapturedPlaygroundUrlContext,
): ProjectDefinition<PreviewHandle>;
export function definePlaygroundProject(
  plan: NodeCliPlaygroundPlan,
  urlContext: CapturedPlaygroundUrlContext,
): ProjectDefinition<void>;
export function definePlaygroundProject(
  plan: PlaygroundProjectPlan,
  urlContext: CapturedPlaygroundUrlContext,
): ProjectDefinition<unknown>;
export function definePlaygroundProject(
  plan: PlaygroundProjectPlan,
  urlContext: CapturedPlaygroundUrlContext,
): ProjectDefinition<unknown> {
  const owned = ownPlaygroundProjectPlan(plan, urlContext);
  const definition = createRootDefinition(owned);
  const inspected = inspectProjectDefinition(definition);
  metadataByDefinition.set(
    definition,
    Object.freeze({
      scope: urlContext,
      starterId: owned.starterId,
      templateId: owned.templateId,
      baselineFingerprint: exactIdentity(
        'playground-baseline:v1',
        identityFields(owned, inspected, false),
      ),
      identity: exactIdentity('playground-definition:v1', identityFields(owned, inspected, true)),
      firstMaterialization: owned.firstMaterialization,
      plan: owned,
      ...(owned.kind === 'vite' ? { port: owned.port } : {}),
    }),
  );
  return definition;
}

/** Sole clone-safe companion payload; the owner recomputes every identity from it. */
export function playgroundProjectDefinitionWire(
  definition: ProjectDefinition<unknown>,
): PlaygroundProjectDefinitionWire {
  const metadata = metadataByDefinition.get(definition as object);
  if (metadata === undefined) throw new TypeError('Invalid or forged Playground ProjectDefinition');
  return Object.freeze({
    definition: projectDefinitionWire(inspectProjectDefinition(definition)),
    plan: metadata.plan,
  });
}

/** Owner ingress: exact-validate plan + core bytes, then mint owner-local authority. */
export function recreatePlaygroundProjectDefinition(
  value: unknown,
  ownerUrlContext: CapturedPlaygroundUrlContext,
): ProjectDefinition<unknown> {
  const wire = dataProperties(value, 'playgroundDefinitionWire', ['definition', 'plan']);
  const receivedCore = inspectProjectDefinitionWire(wire.definition);
  const ownedPlan = ownPlaygroundProjectPlan(wire.plan as PlaygroundProjectPlan, ownerUrlContext);
  const definition = definePlaygroundProject(ownedPlan, ownerUrlContext);
  const expectedCore = inspectProjectDefinition(definition);
  if (receivedCore.identity !== expectedCore.identity) {
    throw new TypeError('Playground definition wire plan does not match exact received core bytes');
  }
  return definition;
}

/** Owner ingress inspection shares the exact local-mint validation path. */
export function inspectPlaygroundProjectDefinitionWire(
  value: unknown,
  ownerUrlContext: CapturedPlaygroundUrlContext,
): InspectedPlaygroundProjectDefinition {
  return inspectPlaygroundProjectDefinition(
    recreatePlaygroundProjectDefinition(value, ownerUrlContext),
    ownerUrlContext,
  );
}

export function inspectPlaygroundProjectDefinition<TReady>(
  definition: ProjectDefinition<TReady>,
  expectedScope?: CapturedPlaygroundUrlContext,
): InspectedPlaygroundProjectDefinition<TReady> {
  const metadata =
    typeof definition === 'object' && definition !== null
      ? metadataByDefinition.get(definition)
      : undefined;
  if (metadata === undefined || (expectedScope !== undefined && metadata.scope !== expectedScope)) {
    throw new TypeError('Invalid, forged, or foreign Playground ProjectDefinition');
  }
  const inspected = inspectProjectDefinition(definition);
  return Object.freeze({
    ...inspected,
    identity: metadata.identity,
    starterId: metadata.starterId,
    templateId: metadata.templateId,
    baselineFingerprint: metadata.baselineFingerprint,
    firstMaterialization: metadata.firstMaterialization,
    ...(metadata.port === undefined ? {} : { port: metadata.port }),
  }) as InspectedPlaygroundProjectDefinition<TReady>;
}

/** Package-private companion instance identity used to reject foreign definitions. */
export function playgroundProjectDefinitionScope(
  definition: ProjectDefinition<unknown>,
): CapturedPlaygroundUrlContext {
  const metadata =
    typeof definition === 'object' && definition !== null
      ? metadataByDefinition.get(definition)
      : undefined;
  if (metadata === undefined) {
    throw new TypeError('Invalid or forged Playground ProjectDefinition');
  }
  return metadata.scope;
}

export function isPlaygroundProjectDefinition(
  definition: ProjectDefinition<unknown>,
  expectedScope: CapturedPlaygroundUrlContext,
): boolean {
  return metadataByDefinition.get(definition as object)?.scope === expectedScope;
}
