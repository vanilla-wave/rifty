import type { FsSync } from '@riftydev/vfs';
import { isAbsolute, normalizePath } from '@riftydev/vfs';
import type { TransformHelperNames, TransformResult } from './esm-ast.ts';
import { type EsmFactory, createEsmFactory } from './esm-factory.ts';
import type { ModuleKind, ResolvedModule } from './resolver.ts';

/** One host-owned lexical import set exposed only to one exact ESM artifact. */
export interface ExactEsmModuleBinding {
  readonly path: string;
  /** Raw installed bytes captured by the host's artifact attestation. */
  readonly sourceBytes: Uint8Array;
  /** Identifier to host value. Values never enter source text or a global. */
  readonly imports: Readonly<Record<string, unknown>>;
}

interface ExactEsmClassification {
  readonly kind: ModuleKind;
  readonly packageRoot: string | null;
}

interface ExactEsmAttestation extends ExactEsmClassification {
  readonly sourceBytes: Uint8Array;
  readonly source: string;
}

export interface PreparedExactEsmModuleBinding {
  readonly path: string;
  readonly sourceBytes: Uint8Array;
  readonly source: string;
  readonly transformed: TransformResult;
  readonly importNames: readonly string[];
  readonly importValues: readonly unknown[];
  readonly factory: EsmFactory;
  readonly classification: ExactEsmClassification;
  attest(): ExactEsmAttestation;
}

export interface SelectedExactEsmModuleBinding {
  readonly source: string;
  readonly transformed: TransformResult;
  readonly importValues: readonly unknown[];
  readonly factory: EsmFactory;
  readonly resolved: ResolvedModule;
}

const SafeArray = Array;
const SafeSet = Set;
const SafeUint8Array = Uint8Array;
const safeArrayIsArray = Array.isArray.bind(Array);
const safeObjectCreate = Object.create.bind(Object);
const safeObjectFreeze = Object.freeze.bind(Object);
const safeGetOwnPropertyDescriptors = Object.getOwnPropertyDescriptors.bind(Object);
const safeGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor.bind(Object);
const safeReflectApply = Reflect.apply.bind(Reflect);
const safeReflectOwnKeys = Reflect.ownKeys.bind(Reflect);
const setHasPrimordial = SafeSet.prototype.has;
const stringCharCodeAtPrimordial = String.prototype.charCodeAt;
const stringEndsWithPrimordial = String.prototype.endsWith;
const stringIndexOfPrimordial = String.prototype.indexOf;
const stringLastIndexOfPrimordial = String.prototype.lastIndexOf;
const stringSlicePrimordial = String.prototype.slice;
const jsonParsePrimordial = JSON.parse;
const typedArrayPrototype = Object.getPrototypeOf(SafeUint8Array.prototype) as object;
const typedArrayByteLength = safeGetOwnPropertyDescriptor(typedArrayPrototype, 'byteLength')?.get;
const utf8 = new TextDecoder('utf-8');
const textDecoderDecodePrimordial = TextDecoder.prototype.decode;

const identifier = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const reserved = new SafeSet([
  'arguments',
  'await',
  'break',
  'case',
  'catch',
  'class',
  'const',
  'continue',
  'debugger',
  'default',
  'delete',
  'do',
  'else',
  'enum',
  'eval',
  'export',
  'extends',
  'false',
  'finally',
  'for',
  'function',
  'if',
  'implements',
  'import',
  'in',
  'instanceof',
  'interface',
  'let',
  'new',
  'null',
  'package',
  'private',
  'protected',
  'public',
  'return',
  'static',
  'super',
  'switch',
  'this',
  'throw',
  'true',
  'try',
  'typeof',
  'var',
  'void',
  'while',
  'with',
  'yield',
]);

function byteLength(bytes: Uint8Array): number {
  if (typedArrayByteLength === undefined) {
    throw new Error('runtime-js: Uint8Array byteLength primordial is unavailable');
  }
  return safeReflectApply(typedArrayByteLength, bytes, []) as number;
}

function copyBytes(bytes: Uint8Array): Uint8Array {
  const length = byteLength(bytes);
  const copy = new SafeUint8Array(length);
  for (let index = 0; index < length; index += 1) copy[index] = bytes[index] as number;
  return copy;
}

function copyArray<T>(values: readonly T[]): readonly T[] {
  const copy: T[] = new SafeArray(values.length);
  for (let index = 0; index < values.length; index += 1) copy[index] = values[index] as T;
  return safeObjectFreeze(copy);
}

function snapshotHelpers(helpers: TransformHelperNames): TransformHelperNames {
  const copy = safeObjectCreate(null) as {
    dynamicImport: string;
    importStatic: string;
    slots: string;
    rebuildExports: string;
    importMeta: string;
    importMetaUrl: string;
    metaDirname: string;
    metaFilename: string;
    assetPath: string;
    metaResolve: string;
    runtimeObject: string;
  };
  copy.dynamicImport = helpers.dynamicImport;
  copy.importStatic = helpers.importStatic;
  copy.slots = helpers.slots;
  copy.rebuildExports = helpers.rebuildExports;
  copy.importMeta = helpers.importMeta;
  copy.importMetaUrl = helpers.importMetaUrl;
  copy.metaDirname = helpers.metaDirname;
  copy.metaFilename = helpers.metaFilename;
  copy.assetPath = helpers.assetPath;
  copy.metaResolve = helpers.metaResolve;
  copy.runtimeObject = helpers.runtimeObject;
  return safeObjectFreeze(copy);
}

function snapshotTransformResult(result: TransformResult): TransformResult {
  const copy = safeObjectCreate(null) as {
    body: string;
    lineMap: readonly number[];
    staticImports: readonly string[];
    helpers: TransformHelperNames;
    moduleBindings: readonly string[];
  };
  copy.body = result.body;
  copy.lineMap = copyArray(result.lineMap);
  copy.staticImports = copyArray(result.staticImports);
  copy.helpers = snapshotHelpers(result.helpers);
  copy.moduleBindings = copyArray(result.moduleBindings);
  return safeObjectFreeze(copy);
}

function safeDecode(bytes: Uint8Array): string {
  return safeReflectApply(textDecoderDecodePrimordial, utf8, [bytes]) as string;
}

function safeCharCodeAt(value: string, index: number): number {
  return safeReflectApply(stringCharCodeAtPrimordial, value, [index]) as number;
}

function decodedModuleSource(sourceBytes: Uint8Array): string {
  const raw = safeDecode(sourceBytes);
  if (safeCharCodeAt(raw, 0) !== 0x23 || safeCharCodeAt(raw, 1) !== 0x21) return raw;
  const newline = safeReflectApply(stringIndexOfPrimordial, raw, ['\n']) as number;
  if (newline === -1) return '';
  return `\n${safeReflectApply(stringSlicePrimordial, raw, [newline + 1]) as string}`;
}

function ownDataValue(descriptors: PropertyDescriptorMap, name: string, owner: string): unknown {
  const descriptor = descriptors[name];
  if (descriptor === undefined || !('value' in descriptor)) {
    throw new TypeError(`Exact ESM module binding ${owner} must be an own data property`);
  }
  return descriptor.value;
}

function snapshotImports(
  imports: unknown,
): Readonly<{ importNames: readonly string[]; importValues: readonly unknown[] }> {
  if (typeof imports !== 'object' || imports === null || safeArrayIsArray(imports)) {
    throw new TypeError('Exact ESM module binding imports must be an object');
  }
  const descriptors = safeGetOwnPropertyDescriptors(imports);
  const keys = safeReflectOwnKeys(descriptors);
  const names: string[] = new SafeArray(keys.length);
  const values: unknown[] = new SafeArray(keys.length);
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    if (
      typeof key !== 'string' ||
      !identifier.test(key) ||
      (safeReflectApply(setHasPrimordial, reserved, [key]) as boolean)
    ) {
      throw new TypeError(
        `Exact ESM module binding import is not a safe identifier: ${String(key)}`,
      );
    }
    const descriptor = descriptors[key];
    if (descriptor === undefined || !('value' in descriptor)) {
      throw new TypeError(`Exact ESM module binding import must be a data property: ${key}`);
    }
    names[index] = key;
    values[index] = descriptor.value;
  }
  if (names.length === 0) {
    throw new TypeError('Exact ESM module binding imports must not be empty');
  }
  return safeObjectFreeze({
    importNames: safeObjectFreeze(names),
    importValues: safeObjectFreeze(values),
  });
}

function safeEndsWith(value: string, suffix: string): boolean {
  return safeReflectApply(stringEndsWithPrimordial, value, [suffix]) as boolean;
}

function parentDirectory(path: string): string {
  const separator = safeReflectApply(stringLastIndexOfPrimordial, path, ['/']) as number;
  if (separator <= 0) return '/';
  return safeReflectApply(stringSlicePrimordial, path, [0, separator]) as string;
}

function packageType(pkg: unknown): string | undefined {
  if (typeof pkg !== 'object' || pkg === null) return undefined;
  const descriptor = safeGetOwnPropertyDescriptor(pkg, 'type');
  if (descriptor === undefined || !('value' in descriptor)) return undefined;
  return typeof descriptor.value === 'string' ? descriptor.value : undefined;
}

function detectKind(path: string, scopeType: string | undefined): ModuleKind {
  if (safeEndsWith(path, '.json')) return 'json';
  if (
    safeEndsWith(path, '.txt') ||
    safeEndsWith(path, '.sql') ||
    safeEndsWith(path, '.md') ||
    safeEndsWith(path, '.prompt')
  ) {
    return 'text';
  }
  if (safeEndsWith(path, '.mjs')) return 'esm';
  if (safeEndsWith(path, '.cjs')) return 'cjs';
  if (
    safeEndsWith(path, '.js') ||
    safeEndsWith(path, '.ts') ||
    safeEndsWith(path, '.tsx') ||
    safeEndsWith(path, '.jsx')
  ) {
    return scopeType === 'module' ? 'esm' : 'cjs';
  }
  return 'cjs';
}

function createAttestor(vfs: FsSync, path: string): () => ExactEsmAttestation {
  const readFileBytesSync = vfs.readFileBytesSync;
  const statSyncOrNull = vfs.statSyncOrNull;
  const readBytes = (target: string): Uint8Array =>
    safeReflectApply(readFileBytesSync, vfs, [target]) as Uint8Array;
  const stat = (target: string): ReturnType<FsSync['statSyncOrNull']> =>
    safeReflectApply(statSyncOrNull, vfs, [target]) as ReturnType<FsSync['statSyncOrNull']>;

  return (): ExactEsmAttestation => {
    const sourceBytes = copyBytes(readBytes(path));
    let dir = parentDirectory(path);
    let packageRoot: string | null = null;
    let scopeType: string | undefined;
    while (true) {
      const packagePath = dir === '/' ? '/package.json' : `${dir}/package.json`;
      if (stat(packagePath)?.isFile) {
        packageRoot = dir;
        try {
          const parsed = safeReflectApply(jsonParsePrimordial, undefined, [
            safeDecode(copyBytes(readBytes(packagePath))),
          ]);
          scopeType = packageType(parsed);
        } catch {
          scopeType = undefined;
        }
        break;
      }
      if (dir === '/') break;
      const parent = parentDirectory(dir);
      if (parent === dir) break;
      dir = parent;
    }
    return safeObjectFreeze({
      sourceBytes,
      source: decodedModuleSource(sourceBytes),
      kind: detectKind(path, scopeType),
      packageRoot,
    });
  };
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  const leftLength = byteLength(left);
  if (leftLength !== byteLength(right)) return false;
  for (let index = 0; index < leftLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

/** Snapshot, transform, and compile the descriptor before any guest module runs. */
export function prepareExactEsmModuleBinding(
  vfs: FsSync,
  binding: ExactEsmModuleBinding | undefined,
  prepareTransform: (source: string, id: string) => TransformResult,
): PreparedExactEsmModuleBinding | undefined {
  if (binding === undefined) return undefined;
  if (typeof binding !== 'object' || binding === null) {
    throw new TypeError('Exact ESM module binding must be an object');
  }
  const descriptors = safeGetOwnPropertyDescriptors(binding);
  const path = ownDataValue(descriptors, 'path', 'path');
  const rawSourceBytes = ownDataValue(descriptors, 'sourceBytes', 'sourceBytes');
  const rawImports = ownDataValue(descriptors, 'imports', 'imports');
  if (typeof path !== 'string' || !isAbsolute(path) || normalizePath(path) !== path) {
    throw new TypeError('Exact ESM module binding path must be absolute and normalized');
  }
  if (typeof rawSourceBytes !== 'object' || rawSourceBytes === null) {
    throw new TypeError('Exact ESM module binding sourceBytes must be a Uint8Array');
  }
  let sourceBytes: Uint8Array;
  try {
    sourceBytes = copyBytes(rawSourceBytes as Uint8Array);
  } catch {
    throw new TypeError('Exact ESM module binding sourceBytes must be a Uint8Array');
  }
  const imports = snapshotImports(rawImports);
  const source = decodedModuleSource(sourceBytes);
  const transformed = snapshotTransformResult(prepareTransform(source, path));
  const factory = createEsmFactory(transformed, path, imports.importNames);
  const attest = createAttestor(vfs, path);
  const admitted = attest();
  const classification = safeObjectFreeze({
    kind: admitted.kind,
    packageRoot: admitted.packageRoot,
  });
  const prepared = safeObjectCreate(null) as {
    path: string;
    sourceBytes: Uint8Array;
    source: string;
    transformed: TransformResult;
    importNames: readonly string[];
    importValues: readonly unknown[];
    factory: EsmFactory;
    classification: ExactEsmClassification;
    attest: () => ExactEsmAttestation;
  };
  prepared.path = path;
  prepared.sourceBytes = sourceBytes;
  prepared.source = source;
  prepared.transformed = transformed;
  prepared.importNames = imports.importNames;
  prepared.importValues = imports.importValues;
  prepared.factory = factory;
  prepared.classification = classification;
  prepared.attest = attest;
  return safeObjectFreeze(prepared);
}

/** Select only the normalized path whose current bytes and package kind still match. */
export function selectExactEsmModuleBinding(
  binding: PreparedExactEsmModuleBinding | undefined,
  resolved: ResolvedModule,
): SelectedExactEsmModuleBinding | undefined {
  if (binding === undefined || resolved.id !== binding.path) return undefined;
  const actual = binding.attest();
  if (
    actual.kind !== binding.classification.kind ||
    actual.packageRoot !== binding.classification.packageRoot
  ) {
    throw new Error(
      `Exact ESM module binding classification mismatch: expected ${binding.classification.kind} in ${binding.classification.packageRoot ?? '<root>'}, got ${actual.kind} in ${actual.packageRoot ?? '<root>'}: ${binding.path}`,
    );
  }
  if (binding.classification.kind !== 'esm') {
    throw new Error(
      `Exact ESM module binding path must resolve as ESM, got ${binding.classification.kind}: ${binding.path}`,
    );
  }
  if (!sameBytes(actual.sourceBytes, binding.sourceBytes)) {
    throw new Error(`Exact ESM module binding source mismatch: ${binding.path}`);
  }
  return safeObjectFreeze({
    source: binding.source,
    transformed: binding.transformed,
    importValues: binding.importValues,
    factory: binding.factory,
    resolved: safeObjectFreeze({
      id: binding.path,
      kind: 'esm',
      source: actual.source,
      packageRoot: actual.packageRoot,
    }),
  });
}
