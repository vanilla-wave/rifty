import { shadowSha256 as sha256Hex } from './internal/sync-sha256.ts';

export interface EsbuildContractApi {
  readonly version: string;
  readonly default?: EsbuildContractApi;
  readonly build: (options: Record<string, unknown>) => Promise<ContractBuildResult>;
  readonly context: (options: Record<string, unknown>) => Promise<ContractBuildContext>;
  readonly transform: (
    input: string | Uint8Array,
    options?: Record<string, unknown>,
  ) => Promise<Record<string, unknown>>;
  readonly formatMessages: (
    messages: readonly Record<string, unknown>[],
    options: Record<string, unknown>,
  ) => Promise<readonly string[]>;
  readonly analyzeMetafile: (
    metafile: unknown,
    options?: Record<string, unknown>,
  ) => Promise<string>;
  readonly initialize: (options?: Record<string, unknown>) => Promise<void>;
  readonly stop: () => Promise<void>;
  readonly buildSync: (options: Record<string, unknown>) => ContractBuildResult;
  readonly transformSync: (
    input: string | Uint8Array,
    options?: Record<string, unknown>,
  ) => Record<string, unknown>;
  readonly formatMessagesSync: (
    messages: readonly Record<string, unknown>[],
    options?: Record<string, unknown>,
  ) => readonly string[];
  readonly analyzeMetafileSync: (metafile: unknown, options?: Record<string, unknown>) => string;
}

export interface EsbuildContractModules {
  readonly cjs: EsbuildContractApi;
  readonly esm: Readonly<Record<string, unknown>>;
  readonly esmDefaultIsCjsOuter?: boolean;
  readonly esmNamespaceStable?: boolean;
}

export interface EsbuildContractWorkspace {
  readonly root: string;
  readonly cwd: string;
  readonly relativeRoot: string;
  readonly rootAliases?: readonly string[];
  mkdir(path: string): Promise<void>;
  writeFile(path: string, contents: string): Promise<void>;
  readFile(path: string): Promise<string>;
  exists(path: string): boolean;
  listFiles(path: string): readonly string[];
}

export function explicitContractRelativePath(path: string): string {
  if (path === '.' || path.startsWith('./') || path.startsWith('../') || path.startsWith('/')) {
    return path;
  }
  return `./${path}`;
}

interface ContractBuildResult {
  readonly outputFiles?: readonly ContractOutputFile[];
  readonly errors?: readonly unknown[];
  readonly warnings?: readonly unknown[];
  readonly metafile?: unknown;
}

interface ContractOutputFile {
  readonly path?: string;
  readonly contents?: Uint8Array;
  readonly text?: string;
  readonly hash?: string;
}

interface ContractBuildContext {
  readonly rebuild: () => Promise<ContractBuildResult>;
  readonly cancel?: () => Promise<void>;
  readonly dispose: () => Promise<void>;
  readonly watch: (options?: Record<string, unknown>) => Promise<void>;
  readonly serve: (options?: Record<string, unknown>) => Promise<unknown>;
}

interface ContractResolveArgs {
  readonly path: string;
  readonly importer?: string;
  readonly namespace?: string;
  readonly resolveDir?: string;
  readonly kind?: string;
  readonly pluginData?: unknown;
  readonly with?: unknown;
}

interface ContractLoadArgs {
  readonly path: string;
  readonly namespace?: string;
  readonly suffix?: string;
  readonly pluginData?: unknown;
  readonly with?: unknown;
}

interface ContractPluginBuild {
  readonly initialOptions?: Record<string, unknown>;
  readonly esbuild?: EsbuildContractApi;
  readonly onResolve: (
    options: Record<string, unknown>,
    callback: (args: ContractResolveArgs) => unknown,
  ) => void;
  readonly onLoad: (
    options: Record<string, unknown>,
    callback: (args: ContractLoadArgs) => unknown,
  ) => void;
  readonly onEnd?: (callback: (result: ContractBuildResult) => unknown) => void;
}

interface ContractPlugin {
  readonly name: string;
  readonly setup: (this: unknown, build: ContractPluginBuild) => void;
  readonly bogus?: boolean;
}

type JsonPrimitive = null | boolean | number | string;
export type JsonValue = JsonPrimitive | readonly JsonValue[] | object;

interface ContractSuccess {
  readonly ok: true;
  readonly value: JsonValue;
}

interface ContractFailure {
  readonly ok: false;
  readonly error: JsonValue;
}

export type ContractOutcome = ContractSuccess | ContractFailure;

export const ESBUILD_CONTRACT_ROW_IDS = [
  'module',
  'transform',
  'transform-large',
  'format-messages',
  'plugin-validation',
  'default-wd',
  'config-build',
  'dep-scan',
  'dep-prebundle',
  'dep-prebundle-write-failure',
] as const;

export type EsbuildContractRowId = (typeof ESBUILD_CONTRACT_ROW_IDS)[number];

interface ModuleMethodRelation {
  readonly cjsOuterToDefault: boolean;
  readonly esmNamedToCjs: boolean;
  readonly esmDefaultToCjs: boolean;
}

export interface ModuleRow {
  readonly cjsOuterDiffersFromDefault: boolean;
  readonly cjsDefaultSelf: boolean;
  readonly esmDefaultIsCjsOuter: boolean;
  readonly esmNamespaceStable: boolean;
  readonly namedMethodRelations: Readonly<
    Record<'build' | 'context' | 'transform' | 'formatMessages', ModuleMethodRelation>
  >;
  readonly pluginBuildIsCjsDefault: boolean;
  readonly pluginBuildMethodRefsMatch: boolean;
  readonly build: ContractOutcome;
}

interface PluginValidationRow {
  readonly invalidSetupCalled: boolean;
  readonly invalid: ContractOutcome;
  readonly valid: ContractOutcome;
}

interface ConfigBuildRow {
  readonly trace: readonly JsonValue[];
  readonly outcome: ContractOutcome;
}

interface DefaultWorkingDirectoryRow {
  readonly setupCalled: boolean;
  readonly initialOptionsIdentity: boolean;
  readonly callerOwnAbsWorkingDirBefore: boolean;
  readonly initialOwnAbsWorkingDir: boolean;
  readonly callerOwnAbsWorkingDirAfter: boolean;
  readonly outcome: ContractOutcome;
}

interface ContextRow extends ConfigBuildRow {
  readonly disposed: boolean;
}

interface DepScanRow extends ContextRow {
  readonly cancelled: boolean;
}

interface DepPrebundleRow extends ContextRow {
  readonly onEndCalled: boolean;
  readonly onEndDisk: JsonValue;
  readonly onEndResult: JsonValue;
}

interface DepPrebundleFailureRow {
  readonly result: DepPrebundleRow;
  readonly blockerContents: string;
  readonly falseOutputMarker: boolean;
}

interface EsbuildContractRowMap {
  readonly module: ModuleRow;
  readonly transform: ContractOutcome;
  readonly 'transform-large': ContractOutcome;
  readonly 'format-messages': ContractOutcome;
  readonly 'plugin-validation': PluginValidationRow;
  readonly 'default-wd': DefaultWorkingDirectoryRow;
  readonly 'config-build': ConfigBuildRow;
  readonly 'dep-scan': DepScanRow;
  readonly 'dep-prebundle': DepPrebundleRow;
  readonly 'dep-prebundle-write-failure': DepPrebundleFailureRow;
}

type EsbuildContractRows = Readonly<{
  [RowId in EsbuildContractRowId]: EsbuildContractRowMap[RowId];
}>;

export interface EsbuildContractTranscript {
  readonly schema: 3;
  readonly oracle: 'esbuild@0.28.0';
  readonly version: string;
  readonly rows: EsbuildContractRows;
}

export const ESBUILD_GUEST_POLICY_ROW_IDS = [
  'gap-initialize',
  'gap-stop',
  'gap-analyze-metafile',
  'gap-sync-family',
  'gap-context-watch',
  'gap-context-serve',
  'gap-build-effective-write',
] as const;

export type EsbuildGuestPolicyRowId = (typeof ESBUILD_GUEST_POLICY_ROW_IDS)[number];

export type EsbuildInvocationOutcome =
  | { readonly phase: 'missing' }
  | { readonly phase: 'sync-return' | 'async-resolve'; readonly value: JsonValue }
  | { readonly phase: 'sync-throw' | 'async-reject'; readonly error: JsonValue };

export interface EsbuildGuestPolicyCase {
  readonly outcome: EsbuildInvocationOutcome;
  readonly evidence: JsonValue;
}

type EsbuildGuestPolicyCases = Readonly<Record<string, EsbuildGuestPolicyCase>>;

export type EsbuildGuestPolicyRows = Readonly<
  Record<EsbuildGuestPolicyRowId, EsbuildGuestPolicyCases>
>;

export interface EsbuildGuestPolicyTranscript {
  readonly schema: 1;
  readonly version: string;
  readonly rows: EsbuildGuestPolicyRows;
}

export type EsbuildGuestPolicyExpectation =
  | { readonly mode: 'native-prerequisite' }
  | {
      readonly mode: 'guest-gap';
      readonly outcome: EsbuildInvocationOutcome;
      readonly evidence?: JsonValue;
    };

type EsbuildGuestPolicyExpectationRows = Readonly<
  Record<EsbuildGuestPolicyRowId, Readonly<Record<string, EsbuildGuestPolicyExpectation>>>
>;

function gapExpectation(
  phase: 'sync-throw' | 'async-reject',
  feature: string,
  evidence?: JsonValue,
): EsbuildGuestPolicyExpectation {
  return {
    mode: 'guest-gap',
    outcome: { phase, error: { name: 'NotImplementedError', feature } },
    ...(evidence === undefined ? {} : { evidence }),
  };
}

export const ESBUILD_GUEST_POLICY_EXPECTATIONS = {
  'gap-initialize': {
    'unknown-option': { mode: 'native-prerequisite' },
    'worker-type': { mode: 'native-prerequisite' },
    'worker-node-only': { mode: 'native-prerequisite' },
    'valid-worker-false': gapExpectation('async-reject', 'esbuild.initialize', {
      postTransformOk: true,
    }),
  },
  'gap-stop': {
    valid: gapExpectation('async-reject', 'esbuild.stop', { postTransformOk: true }),
  },
  'gap-analyze-metafile': {
    'unknown-option': { mode: 'native-prerequisite' },
    'undefined-metafile': { mode: 'native-prerequisite' },
    'malformed-string': gapExpectation('async-reject', 'esbuild.analyzeMetafile'),
    'valid-object': gapExpectation('async-reject', 'esbuild.analyzeMetafile'),
  },
  'gap-sync-family': {
    'build-invalid': { mode: 'native-prerequisite' },
    'build-plugin-invalid': { mode: 'native-prerequisite' },
    'build-valid': gapExpectation('sync-throw', 'esbuild.buildSync'),
    'transform-invalid': { mode: 'native-prerequisite' },
    'transform-valid': gapExpectation('sync-throw', 'esbuild.transformSync'),
    'format-messages-invalid': { mode: 'native-prerequisite' },
    'format-messages-valid': gapExpectation('sync-throw', 'esbuild.formatMessagesSync'),
    'analyze-options-invalid': { mode: 'native-prerequisite' },
    'analyze-undefined': { mode: 'native-prerequisite' },
    'analyze-malformed-string': gapExpectation('sync-throw', 'esbuild.analyzeMetafileSync'),
    'analyze-valid-object': gapExpectation('sync-throw', 'esbuild.analyzeMetafileSync'),
  },
  'gap-context-watch': {
    invalid: { mode: 'native-prerequisite' },
    valid: gapExpectation('async-reject', 'esbuild.context.watch', {
      rebuildAfterGapOk: true,
      disposed: true,
    }),
  },
  'gap-context-serve': {
    invalid: { mode: 'native-prerequisite' },
    valid: gapExpectation('async-reject', 'esbuild.context.serve', {
      rebuildAfterGapOk: true,
      disposed: true,
    }),
  },
  'gap-build-effective-write': {
    'invalid-plugin-default-write': { mode: 'native-prerequisite' },
    'invalid-write-type': { mode: 'native-prerequisite' },
    omitted: gapExpectation('async-reject', 'esbuild.build.write', {
      setupCalled: true,
      callerWriteAfter: '<undefined>',
      onEndCalled: false,
      diskOutputExists: false,
    }),
    'explicit-true': gapExpectation('async-reject', 'esbuild.build.write', {
      setupCalled: true,
      callerWriteAfter: true,
      onEndCalled: false,
      diskOutputExists: false,
    }),
    'explicit-false': { mode: 'native-prerequisite' },
    'true-to-false': { mode: 'native-prerequisite' },
    'omitted-to-false': { mode: 'native-prerequisite' },
    'false-to-invalid': { mode: 'native-prerequisite' },
    'omitted-to-invalid': { mode: 'native-prerequisite' },
    'false-to-true': gapExpectation('async-reject', 'esbuild.build.write', {
      setupCalled: true,
      callerWriteAfter: true,
      onEndCalled: false,
      diskOutputExists: false,
    }),
    'false-delete': gapExpectation('async-reject', 'esbuild.build.write', {
      setupCalled: true,
      callerWriteAfter: '<undefined>',
      onEndCalled: false,
      diskOutputExists: false,
    }),
  },
} as const satisfies EsbuildGuestPolicyExpectationRows;

function isRecord(value: unknown): value is Record<PropertyKey, unknown> {
  return typeof value === 'object' && value !== null;
}

function propertyKey(key: PropertyKey): string {
  return typeof key === 'symbol' ? `[${String(key)}]` : String(key);
}

function createNormalizer(workspace: EsbuildContractWorkspace): (value: string) => string {
  const aliases = [
    ...new Set([
      workspace.root,
      ...(workspace.rootAliases ?? []),
      workspace.relativeRoot,
      workspace.relativeRoot.startsWith('./') ? workspace.relativeRoot.slice(2) : '',
      workspace.relativeRoot.replaceAll('\\', '/'),
      workspace.relativeRoot.replaceAll('/', '\\'),
    ]),
  ]
    .filter((alias) => alias !== '' && alias !== '.')
    .sort((a, b) => b.length - a.length);
  return (value) => {
    let normalized = value;
    for (const alias of aliases) {
      normalized = normalized.replaceAll(alias, '<root>');
    }
    normalized = normalized.replace(/(?:\.\.[\\/])*\.\.<root>/g, '<root>');
    normalized = normalized.replace(/(?:\.\.[\\/])+<root>/g, '<root>');
    normalized = normalized.replace(/\n\s+at [\s\S]*$/, '');
    normalized = normalized.replace(
      /(?:[A-Za-z]:)?[^:\n]*[\\/]node_modules[\\/](?:\.pnpm[\\/][^\\/]+[\\/]node_modules[\\/])?esbuild[\\/]lib[\\/]main\.js/g,
      '<esbuild>/lib/main.js',
    );
    return normalized;
  };
}

function normalizedPath(value: string, normalize: (value: string) => string): string {
  const normalized = normalize(value);
  const root = normalized.indexOf('<root>');
  return root === -1 ? normalized : normalized.slice(root);
}

function assertSha256Implementation(): void {
  if (sha256Hex('abc') !== 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad') {
    throw new Error('esbuild contract probe: SHA-256 implementation failed its fixed vector');
  }
}

function jsonValue(
  value: unknown,
  normalize: (value: string) => string,
  seen = new WeakSet<object>(),
): JsonValue {
  if (value === undefined) return '<undefined>';
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') return normalize(value);
  if (typeof value === 'bigint') return `${String(value)}n`;
  if (typeof value === 'symbol') return String(value);
  if (typeof value === 'function') return `<function:${value.name || 'anonymous'}>`;
  if (value instanceof RegExp) return String(value);
  if (value instanceof Uint8Array) return { type: 'Uint8Array' };
  if (value instanceof Error) return errorValue(value, normalize);
  if (Array.isArray(value)) return value.map((entry) => jsonValue(entry, normalize, seen));
  if (!isRecord(value)) return normalize(String(value));
  if (seen.has(value)) return '<cycle>';
  seen.add(value);
  const result: Record<string, JsonValue> = {};
  for (const key of Reflect.ownKeys(value).sort((a, b) =>
    propertyKey(a).localeCompare(propertyKey(b)),
  )) {
    if (key === 'stack') continue;
    const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
    if (!descriptor) continue;
    result[normalize(propertyKey(key))] =
      'value' in descriptor
        ? jsonValue(descriptor.value, normalize, seen)
        : `<accessor:${descriptor.get ? 'get' : ''}${descriptor.set ? '+set' : ''}>`;
  }
  seen.delete(value);
  return result;
}

function errorValue(error: unknown, normalize: (value: string) => string): JsonValue {
  const record = isRecord(error) ? error : undefined;
  const name =
    error instanceof Error
      ? error.name
      : typeof record?.name === 'string'
        ? record.name
        : typeof error;
  const message =
    error instanceof Error
      ? error.message
      : typeof record?.message === 'string'
        ? record.message
        : String(error);
  return {
    name,
    message: normalize(message),
    errors: jsonValue(record?.errors, normalize),
    warnings: jsonValue(record?.warnings, normalize),
    code: jsonValue(record?.code, normalize),
  };
}

async function capture(
  run: () => Promise<JsonValue>,
  normalize: (value: string) => string,
): Promise<ContractOutcome> {
  try {
    return { ok: true, value: await run() };
  } catch (error) {
    return { ok: false, error: errorValue(error, normalize) };
  }
}

function policyErrorValue(error: unknown, normalize: (value: string) => string): JsonValue {
  if (
    isRecord(error) &&
    error.name === 'NotImplementedError' &&
    typeof error.feature === 'string'
  ) {
    return { name: 'NotImplementedError', feature: error.feature };
  }
  return errorValue(error, normalize);
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return isRecord(value) && typeof value.then === 'function';
}

async function captureInvocation(
  invoke: () => unknown,
  normalize: (value: string) => string,
  shape: (value: unknown) => JsonValue = (value) => jsonValue(value, normalize),
): Promise<EsbuildInvocationOutcome> {
  let returned: unknown;
  try {
    returned = invoke();
  } catch (error) {
    return { phase: 'sync-throw', error: policyErrorValue(error, normalize) };
  }
  if (!isPromiseLike(returned)) return { phase: 'sync-return', value: shape(returned) };
  try {
    return { phase: 'async-resolve', value: shape(await returned) };
  } catch (error) {
    return { phase: 'async-reject', error: policyErrorValue(error, normalize) };
  }
}

async function captureMethodInvocation(
  owner: object,
  method: PropertyKey,
  args: readonly unknown[],
  normalize: (value: string) => string,
  shape?: (value: unknown) => JsonValue,
): Promise<EsbuildInvocationOutcome> {
  const callable = Reflect.get(owner, method) as unknown;
  if (typeof callable !== 'function') return { phase: 'missing' };
  return captureInvocation(() => Reflect.apply(callable, owner, args) as unknown, normalize, shape);
}

function descriptorShape(value: object): JsonValue {
  const result: Record<string, JsonValue> = {};
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
    if (!descriptor) continue;
    const shape: Record<string, JsonValue> = {
      enumerable: descriptor.enumerable === true,
      configurable: descriptor.configurable === true,
    };
    if ('value' in descriptor) {
      shape.writable = descriptor.writable === true;
      const entry = descriptor.value;
      shape.value =
        entry === undefined
          ? '<undefined>'
          : entry instanceof Uint8Array
            ? 'Uint8Array'
            : Array.isArray(entry)
              ? `Array(${entry.length})`
              : entry === null
                ? 'null'
                : typeof entry;
    } else {
      shape.get = descriptor.get ? descriptor.get.name || '<anonymous>' : '<none>';
      shape.set = descriptor.set ? descriptor.set.name || '<anonymous>' : '<none>';
    }
    result[propertyKey(key)] = shape;
  }
  return result;
}

function normalizedMetafileString(value: string, normalize: (value: string) => string): string {
  const normalized = normalize(value);
  const root = normalized.indexOf('<root>');
  if (root === -1) return normalized;
  const namespace = /([A-Za-z0-9_-]+:)$/.exec(normalized.slice(0, root));
  return `${namespace?.[1] ?? ''}${normalized.slice(root)}`;
}

function rootedMetafilePath(value: string, normalize: (value: string) => string): string {
  const normalized = normalizedMetafileString(value, normalize);
  if (normalized.includes('<root>')) return normalized;
  const namespace = /^([A-Za-z0-9_-]+:)(.*)$/.exec(normalized);
  if (namespace) {
    if (namespace[1] !== 'contract:') return normalized;
    return `contract:<root>/${(namespace[2] ?? '').replace(/^\.\//, '')}`;
  }
  if (normalized.startsWith('<')) return normalized;
  return `<root>/${normalized.replace(/^\.\//, '')}`;
}

function metafileKeys(
  metafile: unknown,
  key: 'inputs' | 'outputs',
  normalize: (value: string) => string,
): readonly string[] {
  if (!isRecord(metafile) || !isRecord(metafile[key])) return [];
  return Object.keys(metafile[key])
    .map((value) => rootedMetafilePath(value, normalize))
    .sort();
}

function metafileShape(
  value: unknown,
  normalize: (value: string) => string,
  normalizedOutputBytes: ReadonlyMap<string, number>,
  path: readonly string[] = [],
): JsonValue {
  if (Array.isArray(value)) {
    return value.map((entry, index) =>
      metafileShape(entry, normalize, normalizedOutputBytes, [...path, String(index)]),
    );
  }
  if (!isRecord(value)) {
    if (typeof value === 'string' && path.at(-1) === 'entryPoint') {
      return rootedMetafilePath(value, normalize);
    }
    return jsonValue(value, (entry) => normalizedMetafileString(entry, normalize));
  }
  const result: Record<string, JsonValue> = {};
  for (const key of Object.keys(value).sort()) {
    if (key === 'bytes' && path[0] === 'outputs' && path.length === 2) {
      const outputPath = rootedMetafilePath(path[1] ?? '', normalize);
      const bytes = normalizedOutputBytes.get(outputPath);
      result.bytes = bytes ?? jsonValue(value[key], normalize);
      continue;
    }
    const pathBearingKey =
      (path[0] === 'inputs' && path.length === 1) ||
      (path[0] === 'outputs' && path.length === 1) ||
      (path[0] === 'outputs' && path.length === 3 && path[2] === 'inputs');
    const normalizedKey = pathBearingKey
      ? rootedMetafilePath(key, normalize)
      : normalizedMetafileString(key, normalize);
    result[normalizedKey] = metafileShape(value[key], normalize, normalizedOutputBytes, [
      ...path,
      key,
    ]);
  }
  return result;
}

function resultShape(
  result: ContractBuildResult,
  normalize: (value: string) => string,
  normalizeOutputText: (value: string) => string = normalize,
): JsonValue {
  const files = result.outputFiles ?? [];
  const outputFiles = files.map((file) => {
    const rawText = file.text ?? '';
    const text = normalizeOutputText(rawText);
    const normalizedBytes = new TextEncoder().encode(text).byteLength;
    return {
      path: normalizedPath(file.path ?? '', normalize),
      descriptors: descriptorShape(file),
      bytes: file.contents === undefined ? null : normalizedBytes,
      // Upstream hash covers raw path-bearing bytes; normalized SHA-256 is the portable value.
      hashPresent: typeof file.hash === 'string',
      text,
      textSha256: sha256Hex(text),
    };
  });
  const normalizedOutputBytes = new Map<string, number>();
  for (const file of outputFiles) {
    if (typeof file.bytes !== 'number') continue;
    normalizedOutputBytes.set(file.path, file.bytes);
    if (file.path.startsWith('<root>/')) {
      normalizedOutputBytes.set(file.path.slice('<root>/'.length), file.bytes);
    }
  }
  return {
    descriptors: descriptorShape(result),
    errors: jsonValue(result.errors ?? [], normalize),
    warnings: jsonValue(result.warnings ?? [], normalize),
    metafile: metafileShape(result.metafile, normalize, normalizedOutputBytes),
    metafileInputs: metafileKeys(result.metafile, 'inputs', normalize),
    metafileOutputs: metafileKeys(result.metafile, 'outputs', normalize),
    outputFiles,
  };
}

function outputText(result: ContractBuildResult): string {
  return result.outputFiles?.map((file) => file.text ?? '').join('\n') ?? '';
}

function graphFiles(root: string): {
  readonly entry: string;
  readonly helper: string;
  readonly identity: string;
  readonly scanOut: string;
  readonly prebundleOut: string;
  readonly blocked: string;
} {
  return {
    entry: `${root}/vite.config.ts`,
    helper: `${root}/config-helper.ts`,
    identity: `${root}/identity.ts`,
    scanOut: `${root}/scan-out`,
    prebundleOut: `${root}/deps`,
    blocked: `${root}/blocked`,
  };
}

async function prepareWorkspace(workspace: EsbuildContractWorkspace): Promise<void> {
  const files = graphFiles(workspace.root);
  await workspace.mkdir(workspace.root);
  await workspace.writeFile(`${workspace.root}/package.json`, '{"type":"module"}\n');
  await workspace.writeFile(
    `${workspace.root}/tsconfig.json`,
    '{"compilerOptions":{"strict":true}}\n',
  );
  await workspace.writeFile(
    files.entry,
    `import { marker } from './config-helper.ts';\nimport { defineConfig } from 'vite';\nexport default defineConfig({ define: { __MARKER__: JSON.stringify(marker) } });\n`,
  );
  await workspace.writeFile(files.helper, `export const marker = 'config-helper-marker';\n`);
  await workspace.writeFile(files.identity, `export const identity = 'identity-marker';\n`);
}

async function probeModule(
  modules: EsbuildContractModules,
  workspace: EsbuildContractWorkspace,
  normalize: (value: string) => string,
): Promise<ModuleRow> {
  const cjsDefault = modules.cjs.default;
  const esmDefault = modules.esm.default;
  let pluginBuildIsCjsDefault = false;
  let pluginBuildMethodRefsMatch = false;
  let setupCalled = false;
  const plugin: ContractPlugin = {
    name: 'contract-module-identity',
    setup(build): void {
      setupCalled = true;
      pluginBuildIsCjsDefault = build.esbuild === cjsDefault;
      pluginBuildMethodRefsMatch =
        build.esbuild?.build === modules.cjs.build &&
        build.esbuild?.context === modules.cjs.context &&
        build.esbuild?.transform === modules.cjs.transform &&
        build.esbuild?.formatMessages === modules.cjs.formatMessages;
      build.onLoad({ filter: /identity\.ts$/ }, () => ({
        contents: `export const identity = 'identity-marker';`,
        loader: 'ts',
      }));
    },
  };
  const build = await capture(async () => {
    const result = await modules.cjs.build({
      entryPoints: [graphFiles(workspace.root).identity],
      bundle: true,
      write: false,
      logLevel: 'silent',
      plugins: [plugin],
    });
    return {
      setupCalled,
      outputContainsMarker: outputText(result).includes('identity-marker'),
      result: resultShape(result, normalize),
    };
  }, normalize);
  const methodRelation = (
    method: 'build' | 'context' | 'transform' | 'formatMessages',
  ): ModuleMethodRelation => ({
    cjsOuterToDefault: modules.cjs[method] === cjsDefault?.[method],
    esmNamedToCjs: modules.esm[method] === modules.cjs[method],
    esmDefaultToCjs: isRecord(esmDefault) && esmDefault[method] === modules.cjs[method],
  });
  return {
    cjsOuterDiffersFromDefault: modules.cjs !== cjsDefault,
    cjsDefaultSelf: cjsDefault?.default === cjsDefault,
    esmDefaultIsCjsOuter: modules.esmDefaultIsCjsOuter ?? esmDefault === modules.cjs,
    esmNamespaceStable: modules.esmNamespaceStable ?? false,
    namedMethodRelations: {
      build: methodRelation('build'),
      context: methodRelation('context'),
      transform: methodRelation('transform'),
      formatMessages: methodRelation('formatMessages'),
    },
    pluginBuildIsCjsDefault,
    pluginBuildMethodRefsMatch,
    build,
  };
}

async function probeTransform(
  api: EsbuildContractApi,
  normalize: (value: string) => string,
): Promise<ContractOutcome> {
  return capture(async () => {
    const result = await api.transform(
      '/*! contract-legal-comment */\nconst answer: number = 42;\n',
      {
        loader: 'ts',
        format: 'esm',
        sourcefile: 'contract-input.ts',
        sourcemap: 'external',
        legalComments: 'external',
      },
    );
    const code = normalize(typeof result.code === 'string' ? result.code : '');
    const map = normalize(typeof result.map === 'string' ? result.map : '');
    const legalComments = normalize(
      typeof result.legalComments === 'string' ? result.legalComments : '',
    );
    return {
      descriptors: descriptorShape(result),
      code,
      codeSha256: sha256Hex(code),
      map,
      mapSha256: sha256Hex(map),
      legalComments,
      legalCommentsSha256: sha256Hex(legalComments),
      warnings: jsonValue(result.warnings ?? [], normalize),
      mangleCache: jsonValue(result.mangleCache, normalize),
    };
  }, normalize);
}

async function probeLargeTransform(
  api: EsbuildContractApi,
  normalize: (value: string) => string,
): Promise<ContractOutcome> {
  const inputLength = 1024 * 1024 + 1;
  const prefix = 'export const payload = "';
  const suffix = '";\n';
  const payload = 'x'.repeat(inputLength - prefix.length - suffix.length);
  const input = `${prefix}${payload}${suffix}`;
  return capture(async () => {
    const result = await api.transform(input, {
      loader: 'js',
      format: 'esm',
      sourcemap: false,
      legalComments: 'none',
    });
    const code = typeof result.code === 'string' ? result.code : '';
    const map = typeof result.map === 'string' ? result.map : '';
    return {
      descriptors: descriptorShape(result),
      inputLength,
      overThresholdBy: inputLength - 1024 * 1024,
      outputOverThreshold: code.length > 1024 * 1024,
      payloadPreserved: code.includes(payload),
      inputSha256: sha256Hex(input),
      codeLength: code.length,
      codeSha256: sha256Hex(code),
      warnings: jsonValue(result.warnings ?? [], normalize),
      mapLength: map.length,
      mapSha256: sha256Hex(map),
      legalComments: jsonValue(result.legalComments, normalize),
    };
  }, normalize);
}

async function probeFormatMessages(
  api: EsbuildContractApi,
  workspace: EsbuildContractWorkspace,
  normalize: (value: string) => string,
): Promise<ContractOutcome> {
  return capture(async () => {
    const lineText =
      'export const deliberatelyLongContractBindingNameThatPushesTheMarkerPastColumnEighty = contractWarningMarker;';
    const noteLineText =
      'export const deliberatelyLongHelperBindingNameThatAlsoCrossesTheTerminalBoundary = helperNoteMarker;';
    const messages = await api.formatMessages(
      [
        {
          text: 'contract warning with enough diagnostic detail to make terminal-width wrapping observable instead of accidental',
          location: {
            file: graphFiles(workspace.root).entry,
            namespace: 'file',
            line: 1,
            column: lineText.indexOf('contractWarningMarker'),
            length: 'contractWarningMarker'.length,
            lineText,
            suggestion: '',
          },
          notes: [
            {
              text: 'contract note with enough explanatory detail to cross the configured terminal width and require deterministic wrapping',
              location: null,
            },
            {
              text: 'located helper note',
              location: {
                file: graphFiles(workspace.root).helper,
                namespace: 'file',
                line: 1,
                column: noteLineText.indexOf('helperNoteMarker'),
                length: 'helperNoteMarker'.length,
                lineText: noteLineText,
                suggestion: '',
              },
            },
          ],
          detail: undefined,
        },
      ],
      { kind: 'warning', color: false, terminalWidth: 80 },
    );
    return messages.map(normalize);
  }, normalize);
}

async function probeDefaultWorkingDirectory(
  api: EsbuildContractApi,
  workspace: EsbuildContractWorkspace,
  normalize: (value: string) => string,
): Promise<DefaultWorkingDirectoryRow> {
  const entryPath = `${workspace.root}/default-wd-entry.ts`;
  const outputPath = `${workspace.root}/default-wd-out/default-wd-entry.js`;
  await workspace.writeFile(entryPath, `export const marker: string = 'default-wd-marker';\n`);
  let setupCalled = false;
  let initialOptionsIdentity = false;
  let initialOwnAbsWorkingDir = false;
  const plugin: ContractPlugin = {
    name: 'default-wd-observer',
    setup(build): void {
      setupCalled = true;
      initialOptionsIdentity = build.initialOptions === options;
      initialOwnAbsWorkingDir = Object.hasOwn(build.initialOptions ?? {}, 'absWorkingDir');
    },
  };
  const options: Record<string, unknown> = {
    entryPoints: [`${workspace.relativeRoot}/default-wd-entry.ts`],
    outdir: `${workspace.relativeRoot}/default-wd-out`,
    bundle: false,
    write: false,
    metafile: true,
    logLevel: 'silent',
    plugins: [plugin],
  };
  const callerOwnAbsWorkingDirBefore = Object.hasOwn(options, 'absWorkingDir');
  const outcome = await capture(async () => {
    const result = await api.build(options);
    return {
      result: resultShape(result, normalize),
      outputPaths: (result.outputFiles ?? []).map((file) =>
        normalizedPath(file.path ?? '', normalize),
      ),
      containsMarker: outputText(result).includes('default-wd-marker'),
      diskOutputExists: workspace.exists(outputPath),
    };
  }, normalize);
  return {
    setupCalled,
    initialOptionsIdentity,
    callerOwnAbsWorkingDirBefore,
    initialOwnAbsWorkingDir,
    callerOwnAbsWorkingDirAfter: Object.hasOwn(options, 'absWorkingDir'),
    outcome,
  };
}

async function probePluginValidation(
  api: EsbuildContractApi,
  workspace: EsbuildContractWorkspace,
  normalize: (value: string) => string,
): Promise<PluginValidationRow> {
  const files = graphFiles(workspace.root);
  let invalidSetupCalled = false;
  const invalidPlugin: ContractPlugin = {
    name: 'contract-invalid-plugin',
    bogus: true,
    setup(build): void {
      invalidSetupCalled = true;
      build.onLoad({ filter: /.*/ }, () => ({ contents: 'export default 1', loader: 'js' }));
    },
  };
  const invalid = await capture(async () => {
    const result = await api.build({
      entryPoints: [files.identity],
      bundle: true,
      write: false,
      logLevel: 'silent',
      plugins: [invalidPlugin],
    });
    return resultShape(result, normalize);
  }, normalize);

  let setupThis = 'not-called';
  let optionsIdentity = false;
  let pluginsIdentity = false;
  const validPlugin: ContractPlugin = {
    name: 'contract-valid-plugin',
    setup: function setup(build): void {
      setupThis = this === undefined ? 'undefined' : this === validPlugin ? 'plugin' : 'other';
      optionsIdentity = build.initialOptions === options;
      pluginsIdentity = build.initialOptions?.plugins === plugins;
      build.onLoad({ filter: /identity\.ts$/ }, () => ({
        contents: `export const identity = 'identity-marker';`,
        loader: 'ts',
      }));
    },
  };
  const plugins = [validPlugin];
  const options: Record<string, unknown> = {
    entryPoints: [files.identity],
    bundle: true,
    write: false,
    logLevel: 'silent',
    plugins,
  };
  const valid = await capture(async () => {
    const result = await api.build(options);
    return {
      setupThis,
      optionsIdentity,
      pluginsIdentity,
      outputContainsMarker: outputText(result).includes('identity-marker'),
      result: resultShape(result, normalize),
    };
  }, normalize);

  return { invalidSetupCalled, invalid, valid };
}

function configPlugin(
  workspace: EsbuildContractWorkspace,
  normalize: (value: string) => string,
  trace: JsonValue[],
): ContractPlugin {
  const files = graphFiles(workspace.root);
  return {
    name: 'vite-config-contract',
    setup(build): void {
      trace.push({ event: 'setup' });
      build.onResolve({ filter: /.*/ }, async (args) => {
        trace.push({ event: 'resolve', args: jsonValue(args, normalize) });
        if (args.kind === 'entry-point') {
          return { path: files.entry, namespace: 'contract', pluginData: { from: 'entry' } };
        }
        if (args.path === './config-helper.ts') {
          return { path: files.helper, namespace: 'contract', pluginData: { from: 'helper' } };
        }
        if (args.path === 'vite') return { path: 'vite', external: true };
        return null;
      });
      build.onLoad({ filter: /.*/, namespace: 'contract' }, async (args) => {
        trace.push({ event: 'load', args: jsonValue(args, normalize) });
        return {
          contents: await workspace.readFile(args.path),
          loader: args.path.endsWith('.ts') ? 'ts' : 'js',
          resolveDir: workspace.root,
        };
      });
    },
  };
}

async function probeConfigBuild(
  api: EsbuildContractApi,
  workspace: EsbuildContractWorkspace,
  normalize: (value: string) => string,
): Promise<ConfigBuildRow> {
  const files = graphFiles(workspace.root);
  const trace: JsonValue[] = [];
  const outputPath = `${workspace.root}/config-output.mjs`;
  const outcome = await capture(async () => {
    const result = await api.build({
      absWorkingDir: workspace.root,
      entryPoints: [files.entry],
      outfile: outputPath,
      bundle: true,
      write: false,
      platform: 'node',
      format: 'esm',
      metafile: true,
      logLevel: 'silent',
      plugins: [configPlugin(workspace, normalize, trace)],
    });
    const text = outputText(result);
    return {
      result: resultShape(result, normalize),
      containsHelperMarker: text.includes('config-helper-marker'),
      keepsViteExternal: /from\s+["']vite["']/.test(text),
      diskOutputExists: workspace.exists(outputPath),
    };
  }, normalize);
  return { trace, outcome };
}

function dependencyPlugin(
  workspace: EsbuildContractWorkspace,
  normalize: (value: string) => string,
  trace: JsonValue[],
  onEnd?: (result: ContractBuildResult) => unknown,
): ContractPlugin {
  return {
    name: 'vite-dependency-contract',
    setup(build): void {
      trace.push({ event: 'setup' });
      build.onResolve({ filter: /^picocolors$/ }, async (args) => {
        trace.push({ event: 'resolve', args: jsonValue(args, normalize) });
        return { path: 'picocolors', namespace: 'dep', pluginData: { source: 'contract' } };
      });
      build.onLoad({ filter: /.*/, namespace: 'dep' }, async (args) => {
        trace.push({ event: 'load', args: jsonValue(args, normalize) });
        return {
          contents:
            'module.exports = { green: function green(value) { return "green:" + value } };',
          loader: 'js',
        };
      });
      if (onEnd && build.onEnd) {
        build.onEnd((result) => onEnd(result));
      }
    },
  };
}

async function prebundleDiskEvidence(
  workspace: EsbuildContractWorkspace,
  outdir: string,
  normalize: (value: string) => string,
): Promise<JsonValue> {
  const files = workspace.listFiles(outdir);
  const jsPath = files.find((path) => path.endsWith('.js'));
  const mapPath = files.find((path) => path.endsWith('.js.map'));
  const js = jsPath ? await workspace.readFile(jsPath) : '';
  const map = mapPath ? await workspace.readFile(mapPath) : '';
  const normalizedJs = normalize(js);
  const normalizedMap = normalize(map);
  let mapSources: readonly string[] = [];
  let mapParseable = false;
  try {
    const parsed = JSON.parse(map) as unknown;
    if (isRecord(parsed) && Array.isArray(parsed.sources)) {
      mapSources = parsed.sources.filter((source): source is string => typeof source === 'string');
      mapParseable = true;
    }
  } catch {
    mapParseable = false;
  }
  return {
    files: files.map((path) => normalizedPath(path, normalize)),
    jsBytes: new TextEncoder().encode(normalizedJs).byteLength,
    jsContainsDependency: js.includes('green:'),
    jsText: normalizedJs,
    jsSha256: sha256Hex(normalizedJs),
    mapBytes: new TextEncoder().encode(normalizedMap).byteLength,
    mapParseable,
    mapSources: mapSources.map((source) => normalizedPath(source, normalize)),
    mapText: normalizedMap,
    mapSha256: sha256Hex(normalizedMap),
  };
}

async function probeDepScan(
  api: EsbuildContractApi,
  workspace: EsbuildContractWorkspace,
  normalize: (value: string) => string,
): Promise<DepScanRow> {
  const files = graphFiles(workspace.root);
  const trace: JsonValue[] = [];
  let cancelled = false;
  let disposed = false;
  const outcome = await capture(async () => {
    const context = await api.context({
      absWorkingDir: workspace.root,
      stdin: {
        contents: `import pc from 'picocolors'; console.log(pc.green('scan'));`,
        resolveDir: workspace.root,
        sourcefile: 'dep-scan.js',
        loader: 'js',
      },
      outdir: files.scanOut,
      bundle: true,
      write: false,
      platform: 'browser',
      format: 'esm',
      metafile: true,
      logLevel: 'silent',
      plugins: [dependencyPlugin(workspace, normalize, trace)],
    });
    try {
      const result = await context.rebuild();
      if (context.cancel) {
        await context.cancel();
        cancelled = true;
      }
      return {
        // WASM reports the cwd-resolved stdin comment; preserve metafile paths,
        // normalize only this temp-root spelling to Node's logical sourcefile.
        result: resultShape(result, normalize, (value) =>
          normalize(value).replaceAll('// <root>/dep-scan.js', '// dep-scan.js'),
        ),
        outputContainsDependency: outputText(result).includes('green:'),
        diskFiles: workspace.listFiles(files.scanOut).map(normalize),
      };
    } finally {
      await context.dispose();
      disposed = true;
    }
  }, normalize);
  return { trace, cancelled, disposed, outcome };
}

async function runPrebundle(
  api: EsbuildContractApi,
  workspace: EsbuildContractWorkspace,
  normalize: (value: string) => string,
  outdir: string,
): Promise<DepPrebundleRow> {
  const trace: JsonValue[] = [];
  let disposed = false;
  let onEndCalled = false;
  let onEndDisk: JsonValue = '<not-called>';
  let onEndResult: JsonValue = '<not-called>';
  let onEndResultObject: ContractBuildResult | undefined;
  const plugin = dependencyPlugin(workspace, normalize, trace, async (result) => {
    onEndCalled = true;
    onEndResultObject = result;
    onEndDisk = await prebundleDiskEvidence(workspace, outdir, normalize);
    onEndResult = resultShape(result, normalize);
    trace.push({ event: 'onEnd', disk: onEndDisk });
  });
  const outcome = await capture(async () => {
    const context = await api.context({
      absWorkingDir: workspace.root,
      entryPoints: ['picocolors'],
      outdir,
      entryNames: '[name]',
      bundle: true,
      splitting: true,
      sourcemap: true,
      platform: 'browser',
      format: 'esm',
      metafile: true,
      logLevel: 'silent',
      plugins: [plugin],
    });
    try {
      const result = await context.rebuild();
      return {
        resolvedResultSameAsOnEnd: result === onEndResultObject,
        disk: await prebundleDiskEvidence(workspace, outdir, normalize),
      };
    } finally {
      await context.dispose();
      disposed = true;
    }
  }, normalize);
  return { trace, onEndCalled, onEndDisk, onEndResult, disposed, outcome };
}

async function probePrebundleWriteFailure(
  api: EsbuildContractApi,
  workspace: EsbuildContractWorkspace,
  normalize: (value: string) => string,
): Promise<DepPrebundleFailureRow> {
  const files = graphFiles(workspace.root);
  await workspace.writeFile(files.blocked, 'blocker-marker');
  const result = await runPrebundle(api, workspace, normalize, `${files.blocked}/deps`);
  return {
    result,
    blockerContents: await workspace.readFile(files.blocked),
    falseOutputMarker: workspace.exists(`${files.blocked}/deps/picocolors.js`),
  };
}

function policyCase(
  outcome: EsbuildInvocationOutcome,
  evidence: JsonValue = {},
): EsbuildGuestPolicyCase {
  return { outcome, evidence };
}

async function probeInitializePolicy(
  api: EsbuildContractApi,
  normalize: (value: string) => string,
): Promise<EsbuildGuestPolicyCases> {
  const unknownOption = await captureMethodInvocation(
    api,
    'initialize',
    [{ bogus: true }],
    normalize,
  );
  const workerType = await captureMethodInvocation(
    api,
    'initialize',
    [{ worker: 'yes' }],
    normalize,
  );
  const workerNodeOnly = await captureMethodInvocation(
    api,
    'initialize',
    [{ worker: true }],
    normalize,
  );
  const validWorkerFalse = await captureMethodInvocation(
    api,
    'initialize',
    [{ worker: false }],
    normalize,
  );
  const postTransform = await captureMethodInvocation(
    api,
    'transform',
    ['export const afterInitialize = true', { loader: 'js' }],
    normalize,
  );
  return {
    'unknown-option': policyCase(unknownOption),
    'worker-type': policyCase(workerType),
    'worker-node-only': policyCase(workerNodeOnly),
    'valid-worker-false': policyCase(validWorkerFalse, {
      postTransformOk: postTransform.phase === 'async-resolve',
    }),
  };
}

async function probeStopPolicy(
  api: EsbuildContractApi,
  normalize: (value: string) => string,
): Promise<EsbuildGuestPolicyCases> {
  const outcome = await captureMethodInvocation(api, 'stop', [], normalize);
  const postTransform = await captureMethodInvocation(
    api,
    'transform',
    ['export const afterStop = true', { loader: 'js' }],
    normalize,
  );
  return {
    valid: policyCase(outcome, { postTransformOk: postTransform.phase === 'async-resolve' }),
  };
}

async function probeAnalyzePolicy(
  api: EsbuildContractApi,
  normalize: (value: string) => string,
): Promise<EsbuildGuestPolicyCases> {
  return {
    'unknown-option': policyCase(
      await captureMethodInvocation(
        api,
        'analyzeMetafile',
        [{ inputs: {}, outputs: {} }, { bogus: true }],
        normalize,
      ),
    ),
    'undefined-metafile': policyCase(
      await captureMethodInvocation(api, 'analyzeMetafile', [undefined], normalize),
    ),
    'malformed-string': policyCase(
      await captureMethodInvocation(api, 'analyzeMetafile', ['{'], normalize),
    ),
    'valid-object': policyCase(
      await captureMethodInvocation(
        api,
        'analyzeMetafile',
        [{ inputs: {}, outputs: {} }, { color: false }],
        normalize,
      ),
    ),
  };
}

async function probeSyncPolicy(
  api: EsbuildContractApi,
  normalize: (value: string) => string,
): Promise<EsbuildGuestPolicyCases> {
  const syncPlugin = { name: 'sync-invalid-plugin', setup(): void {} };
  return {
    'build-invalid': policyCase(
      await captureMethodInvocation(
        api,
        'buildSync',
        [
          {
            stdin: { contents: 'export default 1' },
            write: false,
            logLevel: 'silent',
            bogus: true,
          },
        ],
        normalize,
      ),
    ),
    'build-plugin-invalid': policyCase(
      await captureMethodInvocation(
        api,
        'buildSync',
        [
          {
            stdin: { contents: 'export default 1' },
            write: false,
            logLevel: 'silent',
            plugins: [syncPlugin],
          },
        ],
        normalize,
      ),
    ),
    'build-valid': policyCase(
      await captureMethodInvocation(
        api,
        'buildSync',
        [{ stdin: { contents: 'export default 1' }, write: false, logLevel: 'silent' }],
        normalize,
        (value) => resultShape(value as ContractBuildResult, normalize),
      ),
    ),
    'transform-invalid': policyCase(
      await captureMethodInvocation(api, 'transformSync', ['let x', { bogus: true }], normalize),
    ),
    'transform-valid': policyCase(
      await captureMethodInvocation(
        api,
        'transformSync',
        ['const value: number = 1', { loader: 'ts' }],
        normalize,
      ),
    ),
    'format-messages-invalid': policyCase(
      await captureMethodInvocation(
        api,
        'formatMessagesSync',
        [[], { kind: 'warning', bogus: true }],
        normalize,
      ),
    ),
    'format-messages-valid': policyCase(
      await captureMethodInvocation(
        api,
        'formatMessagesSync',
        [[], { kind: 'warning', color: false }],
        normalize,
      ),
    ),
    'analyze-options-invalid': policyCase(
      await captureMethodInvocation(
        api,
        'analyzeMetafileSync',
        [{ inputs: {}, outputs: {} }, { bogus: true }],
        normalize,
      ),
    ),
    'analyze-undefined': policyCase(
      await captureMethodInvocation(api, 'analyzeMetafileSync', [undefined], normalize),
    ),
    'analyze-malformed-string': policyCase(
      await captureMethodInvocation(api, 'analyzeMetafileSync', ['{'], normalize),
    ),
    'analyze-valid-object': policyCase(
      await captureMethodInvocation(
        api,
        'analyzeMetafileSync',
        [{ inputs: {}, outputs: {} }, { color: false }],
        normalize,
      ),
    ),
  };
}

async function probeContextMethodPolicyCase(
  api: EsbuildContractApi,
  workspace: EsbuildContractWorkspace,
  normalize: (value: string) => string,
  method: 'watch' | 'serve',
  options: Record<string, unknown>,
): Promise<EsbuildGuestPolicyCase> {
  let context: ContractBuildContext | undefined;
  const creation = await captureInvocation(
    () =>
      api.context({
        absWorkingDir: workspace.root,
        entryPoints: [graphFiles(workspace.root).identity],
        bundle: true,
        write: false,
        outdir: `${workspace.root}/policy-context-out`,
        logLevel: 'silent',
      }),
    normalize,
    (value) => {
      context = value as ContractBuildContext;
      return '<context>';
    },
  );
  if (!context) return policyCase(creation, { rebuildAfterGapOk: false, disposed: false });
  let rebuildAfterGapOk = false;
  let outcome: EsbuildInvocationOutcome;
  try {
    outcome = await captureMethodInvocation(
      context,
      method,
      [options],
      normalize,
      method === 'serve'
        ? (value) => ({
            hosts: isRecord(value) ? jsonValue(value.hosts, normalize) : '<missing>',
            portPositive: isRecord(value) && typeof value.port === 'number' && value.port > 0,
          })
        : undefined,
    );
    try {
      await context.rebuild();
      rebuildAfterGapOk = true;
    } catch {
      rebuildAfterGapOk = false;
    }
  } finally {
    await context.dispose();
  }
  return policyCase(outcome, { rebuildAfterGapOk, disposed: true });
}

async function probeContextPolicy(
  api: EsbuildContractApi,
  workspace: EsbuildContractWorkspace,
  normalize: (value: string) => string,
  method: 'watch' | 'serve',
): Promise<EsbuildGuestPolicyCases> {
  const invalidOptions = method === 'watch' ? { delay: '1' } : { port: '0' };
  const validOptions =
    method === 'watch' ? {} : { host: '127.0.0.1', port: 0, servedir: workspace.root };
  return {
    invalid: await probeContextMethodPolicyCase(api, workspace, normalize, method, invalidOptions),
    valid: await probeContextMethodPolicyCase(api, workspace, normalize, method, validOptions),
  };
}

type WriteMutation = 'none' | 'set-true' | 'set-false' | 'set-invalid' | 'delete';

async function probeInvalidPluginDefaultWritePolicyCase(
  api: EsbuildContractApi,
  workspace: EsbuildContractWorkspace,
  normalize: (value: string) => string,
): Promise<EsbuildGuestPolicyCase> {
  const outfile = `${workspace.root}/write-policy/invalid-plugin-default-write.js`;
  let setupCalled = false;
  const invalidPlugin: ContractPlugin = {
    name: 'write-policy-invalid-plugin',
    bogus: true,
    setup(): void {
      setupCalled = true;
    },
  };
  const outcome = await captureMethodInvocation(
    api,
    'build',
    [
      {
        entryPoints: [graphFiles(workspace.root).identity],
        outfile,
        bundle: true,
        logLevel: 'silent',
        plugins: [invalidPlugin],
      },
    ],
    normalize,
    (value) => resultShape(value as ContractBuildResult, normalize),
  );
  return policyCase(outcome, {
    setupCalled,
    diskOutputExists: workspace.exists(outfile),
  });
}

async function probeBuildWritePolicyCase(
  api: EsbuildContractApi,
  workspace: EsbuildContractWorkspace,
  normalize: (value: string) => string,
  caseId: string,
  initialWrite: unknown,
  mutation: WriteMutation,
): Promise<EsbuildGuestPolicyCase> {
  const outfile = `${workspace.root}/write-policy/${caseId}.js`;
  let setupCalled = false;
  let onEndCalled = false;
  const plugin: ContractPlugin = {
    name: `write-policy-${caseId}`,
    setup(build): void {
      setupCalled = true;
      if (build.initialOptions) {
        if (mutation === 'set-true') build.initialOptions.write = true;
        if (mutation === 'set-false') build.initialOptions.write = false;
        if (mutation === 'set-invalid') build.initialOptions.write = 'yes';
        if (mutation === 'delete') Reflect.deleteProperty(build.initialOptions, 'write');
      }
      build.onEnd?.(() => {
        onEndCalled = true;
      });
    },
  };
  const options: Record<string, unknown> = {
    entryPoints: [graphFiles(workspace.root).identity],
    outfile,
    bundle: true,
    logLevel: 'silent',
    plugins: [plugin],
  };
  if (initialWrite !== undefined) options.write = initialWrite;
  const outcome = await captureMethodInvocation(api, 'build', [options], normalize, (value) =>
    resultShape(value as ContractBuildResult, normalize),
  );
  return policyCase(outcome, {
    setupCalled,
    callerWriteAfter: jsonValue(options.write, normalize),
    onEndCalled,
    diskOutputExists: workspace.exists(outfile),
  });
}

async function probeBuildWritePolicy(
  api: EsbuildContractApi,
  workspace: EsbuildContractWorkspace,
  normalize: (value: string) => string,
): Promise<EsbuildGuestPolicyCases> {
  return {
    'invalid-plugin-default-write': await probeInvalidPluginDefaultWritePolicyCase(
      api,
      workspace,
      normalize,
    ),
    'invalid-write-type': await probeBuildWritePolicyCase(
      api,
      workspace,
      normalize,
      'invalid-write-type',
      'yes',
      'none',
    ),
    omitted: await probeBuildWritePolicyCase(
      api,
      workspace,
      normalize,
      'omitted',
      undefined,
      'none',
    ),
    'explicit-true': await probeBuildWritePolicyCase(
      api,
      workspace,
      normalize,
      'explicit-true',
      true,
      'none',
    ),
    'explicit-false': await probeBuildWritePolicyCase(
      api,
      workspace,
      normalize,
      'explicit-false',
      false,
      'none',
    ),
    'true-to-false': await probeBuildWritePolicyCase(
      api,
      workspace,
      normalize,
      'true-to-false',
      true,
      'set-false',
    ),
    'omitted-to-false': await probeBuildWritePolicyCase(
      api,
      workspace,
      normalize,
      'omitted-to-false',
      undefined,
      'set-false',
    ),
    'false-to-invalid': await probeBuildWritePolicyCase(
      api,
      workspace,
      normalize,
      'false-to-invalid',
      false,
      'set-invalid',
    ),
    'omitted-to-invalid': await probeBuildWritePolicyCase(
      api,
      workspace,
      normalize,
      'omitted-to-invalid',
      undefined,
      'set-invalid',
    ),
    'false-to-true': await probeBuildWritePolicyCase(
      api,
      workspace,
      normalize,
      'false-to-true',
      false,
      'set-true',
    ),
    'false-delete': await probeBuildWritePolicyCase(
      api,
      workspace,
      normalize,
      'false-delete',
      false,
      'delete',
    ),
  };
}

export async function probeEsbuildModuleContract(
  modules: EsbuildContractModules,
  workspace: EsbuildContractWorkspace,
): Promise<ModuleRow> {
  assertSha256Implementation();
  await prepareWorkspace(workspace);
  return probeModule(modules, workspace, createNormalizer(workspace));
}

export async function probeEsbuildContract(
  modules: EsbuildContractModules,
  workspace: EsbuildContractWorkspace,
): Promise<EsbuildContractTranscript> {
  assertSha256Implementation();
  await prepareWorkspace(workspace);
  const normalize = createNormalizer(workspace);
  const rows: EsbuildContractRows = {
    module: await probeModule(modules, workspace, normalize),
    transform: await probeTransform(modules.cjs, normalize),
    'transform-large': await probeLargeTransform(modules.cjs, normalize),
    'format-messages': await probeFormatMessages(modules.cjs, workspace, normalize),
    'plugin-validation': await probePluginValidation(modules.cjs, workspace, normalize),
    'default-wd': await probeDefaultWorkingDirectory(modules.cjs, workspace, normalize),
    'config-build': await probeConfigBuild(modules.cjs, workspace, normalize),
    'dep-scan': await probeDepScan(modules.cjs, workspace, normalize),
    'dep-prebundle': await runPrebundle(
      modules.cjs,
      workspace,
      normalize,
      graphFiles(workspace.root).prebundleOut,
    ),
    'dep-prebundle-write-failure': await probePrebundleWriteFailure(
      modules.cjs,
      workspace,
      normalize,
    ),
  };
  return {
    schema: 3,
    oracle: 'esbuild@0.28.0',
    version: modules.cjs.version,
    rows,
  };
}

export async function probeEsbuildGuestPolicy(
  modules: EsbuildContractModules,
  workspace: EsbuildContractWorkspace,
): Promise<EsbuildGuestPolicyTranscript> {
  assertSha256Implementation();
  await prepareWorkspace(workspace);
  const normalize = createNormalizer(workspace);
  const rows: EsbuildGuestPolicyRows = {
    'gap-initialize': await probeInitializePolicy(modules.cjs, normalize),
    'gap-stop': await probeStopPolicy(modules.cjs, normalize),
    'gap-analyze-metafile': await probeAnalyzePolicy(modules.cjs, normalize),
    'gap-sync-family': await probeSyncPolicy(modules.cjs, normalize),
    'gap-context-watch': await probeContextPolicy(modules.cjs, workspace, normalize, 'watch'),
    'gap-context-serve': await probeContextPolicy(modules.cjs, workspace, normalize, 'serve'),
    'gap-build-effective-write': await probeBuildWritePolicy(modules.cjs, workspace, normalize),
  };
  return { schema: 1, version: modules.cjs.version, rows };
}
