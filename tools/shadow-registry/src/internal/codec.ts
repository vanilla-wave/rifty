import generatedCatalog from '../../generated/shadow-substitution-catalog.json';
import { canonicalShadowJson, shadowDigest, shadowSha256 } from './canonical.ts';
import type {
  BuiltinShadowSubstitutionCatalog,
  BuiltinShadowSubstitutionRecipe,
  ShadowMaterializationFile,
  ShadowRecipeAcquisition,
  ShadowRecipeAdmission,
  ShadowRegistryDependencyProjection,
} from './model.ts';

const SHA = /^[0-9a-f]{64}$/;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._@/+-]*$/;
const UNSCOPED_KEY = /^[A-Za-z0-9][A-Za-z0-9._+-]*$/;
const PACKAGE_NAME =
  /^(?:[A-Za-z0-9][A-Za-z0-9._+-]*|@[A-Za-z0-9][A-Za-z0-9._+-]*\/[A-Za-z0-9][A-Za-z0-9._+-]*)$/;
const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

export class ShadowRegistryCodecError extends TypeError {
  readonly code = 'ESHADOWREGISTRYCODEC' as const;

  constructor(
    readonly path: string,
    detail: string,
  ) {
    super(`shadow registry ${path}: ${detail}`);
    this.name = 'ShadowRegistryCodecError';
  }
}

function plainObject(value: unknown, path: string): Record<string, unknown> {
  if (
    value === null ||
    typeof value !== 'object' ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new ShadowRegistryCodecError(path, 'must be a plain object');
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new ShadowRegistryCodecError(path, 'symbol members are forbidden');
  }
  const descriptors = Object.getOwnPropertyDescriptors(value) as Record<string, PropertyDescriptor>;
  if (Object.values(descriptors).some((descriptor) => !descriptor.enumerable)) {
    throw new ShadowRegistryCodecError(path, 'extra or missing fields');
  }
  if (Object.values(descriptors).some((descriptor) => !('value' in descriptor))) {
    throw new ShadowRegistryCodecError(path, 'accessors are forbidden');
  }
  return value as Record<string, unknown>;
}

function record(value: unknown, keys: readonly string[], path: string): Record<string, unknown> {
  const item = plainObject(value, path);
  const actual = Object.keys(Object.getOwnPropertyDescriptors(item)).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new ShadowRegistryCodecError(path, 'extra or missing fields');
  }
  return item;
}

function denseArray(value: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    throw new ShadowRegistryCodecError(path, 'must be a plain array');
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new ShadowRegistryCodecError(path, 'symbol members are forbidden');
  }
  const descriptors = Object.getOwnPropertyDescriptors(value) as Record<string, PropertyDescriptor>;
  const lengthDescriptor = descriptors.length;
  if (
    !lengthDescriptor ||
    !('value' in lengthDescriptor) ||
    typeof lengthDescriptor.value !== 'number' ||
    !Number.isSafeInteger(lengthDescriptor.value) ||
    lengthDescriptor.value < 0
  ) {
    throw new ShadowRegistryCodecError(path, 'must be dense and have no extra fields');
  }
  const length = lengthDescriptor.value;
  const expected = ['length', ...Array.from({ length }, (_, index) => String(index))].sort();
  const actual = Object.keys(descriptors).sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index]) ||
    Array.from({ length }, (_, index) => descriptors[String(index)]).some(
      (descriptor) => !descriptor?.enumerable,
    )
  ) {
    throw new ShadowRegistryCodecError(path, 'must be dense and have no extra fields');
  }
  const output: unknown[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !('value' in descriptor)) {
      throw new ShadowRegistryCodecError(path, `element ${index} must be a data property`);
    }
    output.push(descriptor.value);
  }
  return output;
}

function identifier(value: unknown, path: string): string {
  if (typeof value !== 'string' || !IDENTIFIER.test(value)) {
    throw new ShadowRegistryCodecError(path, 'invalid identifier');
  }
  return value;
}

function packageName(value: unknown, path: string): string {
  if (typeof value !== 'string' || !PACKAGE_NAME.test(value)) {
    throw new ShadowRegistryCodecError(path, 'invalid package name');
  }
  return value;
}

function exactVersion(value: unknown, path: string): string {
  if (typeof value !== 'string' || !EXACT_VERSION.test(value)) {
    throw new ShadowRegistryCodecError(path, 'invalid exact version');
  }
  return value;
}

function relativePath(value: unknown, path: string): string {
  if (typeof value !== 'string') {
    throw new ShadowRegistryCodecError(path, 'must be a normalized relative path');
  }
  const parts = value.split('/');
  if (
    value.startsWith('/') ||
    value.includes('\\') ||
    parts.some((part) => part === '' || part === '.' || part === '..')
  ) {
    throw new ShadowRegistryCodecError(path, 'must be a normalized relative path');
  }
  return value;
}

function sha(value: unknown, path: string): string {
  if (typeof value !== 'string' || !SHA.test(value)) {
    throw new ShadowRegistryCodecError(path, 'invalid sha256');
  }
  return value;
}

function positiveInteger(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new ShadowRegistryCodecError(path, 'must be a positive safe integer');
  }
  return value;
}

function nonNegativeInteger(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new ShadowRegistryCodecError(path, 'must be a non-negative safe integer');
  }
  return value;
}

function sortedUnique(values: readonly string[], path: string, subject: string): void {
  for (let index = 1; index < values.length; index += 1) {
    if (values[index - 1]! >= values[index]!) {
      throw new ShadowRegistryCodecError(path, `duplicate ${subject} or non-canonical ordering`);
    }
  }
}

function decodeStringMap(
  value: unknown,
  path: string,
  keyDecoder: (value: unknown, path: string) => string,
  valueDecoder: (value: unknown, path: string) => string,
): Readonly<Record<string, string>> {
  const item = plainObject(value, path);
  const output: Record<string, string> = {};
  for (const key of Object.keys(item)) {
    const decodedKey = keyDecoder(key, `${path} key`);
    output[decodedKey] = valueDecoder(item[key], `${path}.${key}`);
  }
  return output;
}

function dependencyRange(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new ShadowRegistryCodecError(path, 'must be a non-empty string');
  }
  return value;
}

function decodeDependencyMap(value: unknown, path: string): Readonly<Record<string, string>> {
  return decodeStringMap(value, path, packageName, dependencyRange);
}

function decodeDependencyProjection(
  value: unknown,
  path: string,
): ShadowRegistryDependencyProjection {
  const item = record(
    value,
    [
      'dependencies',
      'optionalDependencies',
      'omittedOptionalDependencies',
      'peerDependencies',
      'bundledDependencies',
      'unsupportedFeature',
    ],
    path,
  );
  const dependencies = decodeDependencyMap(item.dependencies, `${path}.dependencies`);
  const optionalDependencies = decodeDependencyMap(
    item.optionalDependencies,
    `${path}.optionalDependencies`,
  );
  const omittedOptionalDependencies = decodeDependencyMap(
    item.omittedOptionalDependencies,
    `${path}.omittedOptionalDependencies`,
  );
  const peerDependencies = decodeDependencyMap(item.peerDependencies, `${path}.peerDependencies`);
  const mapNames = [
    Object.keys(dependencies),
    Object.keys(optionalDependencies),
    Object.keys(omittedOptionalDependencies),
    Object.keys(peerDependencies),
  ];
  const seen = new Set<string>();
  const overlaps = new Set<string>();
  for (const names of mapNames) {
    for (const name of names) {
      if (seen.has(name)) overlaps.add(name);
      seen.add(name);
    }
  }
  const firstOverlap = [...overlaps].sort()[0];
  if (firstOverlap !== undefined) {
    throw new ShadowRegistryCodecError(path, `dependency maps overlap at ${firstOverlap}`);
  }
  const bundledDependencies = denseArray(
    item.bundledDependencies,
    `${path}.bundledDependencies`,
  ).map((name, index) => packageName(name, `${path}.bundledDependencies[${index}]`));
  sortedUnique(bundledDependencies, `${path}.bundledDependencies`, 'member');
  for (let index = 0; index < bundledDependencies.length; index += 1) {
    const name = bundledDependencies[index]!;
    if (!Object.hasOwn(dependencies, name) && !Object.hasOwn(optionalDependencies, name)) {
      throw new ShadowRegistryCodecError(
        `${path}.bundledDependencies[${index}]`,
        'bundled package must be retained by dependencies or optionalDependencies',
      );
    }
  }
  return {
    dependencies,
    optionalDependencies,
    omittedOptionalDependencies,
    peerDependencies,
    bundledDependencies,
    unsupportedFeature: identifier(item.unsupportedFeature, `${path}.unsupportedFeature`),
  };
}

function decodeAdmission(value: unknown, path: string): ShadowRecipeAdmission {
  const raw = plainObject(value, path);
  if (!Object.hasOwn(raw, 'kind')) {
    record(raw, ['kind', 'unsupportedFeature'], path);
  }
  const kind = raw.kind;
  if (kind !== 'semver-admits' && kind !== 'exact-only') {
    throw new ShadowRegistryCodecError(`${path}.kind`, 'unsupported admission');
  }
  const item = record(raw, ['kind', 'unsupportedFeature'], path);
  return {
    kind,
    unsupportedFeature: identifier(item.unsupportedFeature, `${path}.unsupportedFeature`),
  };
}

function decodeAcquisition(value: unknown, path: string): ShadowRecipeAcquisition {
  const raw = plainObject(value, path);
  const kind = raw.kind;
  if (kind === 'synthetic') {
    record(raw, ['kind'], path);
    return { kind };
  }
  if (kind === 'registry') {
    const item = record(raw, ['kind', 'name', 'version', 'dependencyProjection'], path);
    return {
      kind,
      name: packageName(item.name, `${path}.name`),
      version: exactVersion(item.version, `${path}.version`),
      dependencyProjection: decodeDependencyProjection(
        item.dependencyProjection,
        `${path}.dependencyProjection`,
      ),
    };
  }
  throw new ShadowRegistryCodecError(`${path}.kind`, 'unsupported acquisition');
}

function decodeMaterializationFiles(
  value: unknown,
  path: string,
): readonly ShadowMaterializationFile[] {
  const files = denseArray(value, path).map((candidate, index) => {
    const filePath = `${path}[${index}]`;
    const item = record(candidate, ['bytes', 'content', 'path', 'sha256'], filePath);
    if (typeof item.content !== 'string') {
      throw new ShadowRegistryCodecError(`${filePath}.content`, 'must be text');
    }
    const content = item.content;
    const bytes = nonNegativeInteger(item.bytes, `${filePath}.bytes`);
    const digest = sha(item.sha256, `${filePath}.sha256`);
    if (
      new TextEncoder().encode(content).byteLength !== bytes ||
      shadowSha256(content) !== digest
    ) {
      throw new ShadowRegistryCodecError(filePath, 'content identity mismatch');
    }
    return {
      path: relativePath(item.path, `${filePath}.path`),
      content,
      sha256: digest,
      bytes,
    };
  });
  sortedUnique(
    files.map((file) => file.path),
    path,
    'path',
  );
  return files;
}

function decodeBinMap(value: unknown, path: string): Readonly<Record<string, string>> {
  return decodeStringMap(
    value,
    path,
    (command, commandPath) => {
      if (typeof command !== 'string' || !UNSCOPED_KEY.test(command)) {
        throw new ShadowRegistryCodecError(
          commandPath.replace(/ key$/, `.${String(command)}`),
          'invalid bin command',
        );
      }
      return command;
    },
    relativePath,
  );
}

function normalizeManifestBinTarget(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const target = value.startsWith('./') ? value.slice(2) : value;
  const parts = target.split('/');
  if (
    target.startsWith('/') ||
    target.includes('\\') ||
    parts.some((part) => part === '' || part === '.' || part === '..')
  ) {
    return null;
  }
  return target;
}

function manifestBinMap(
  manifest: Record<string, unknown>,
  materializationName: string,
): Readonly<Record<string, string>> | null {
  if (!Object.hasOwn(manifest, 'bin')) return {};
  if (typeof manifest.bin === 'string') {
    const target = normalizeManifestBinTarget(manifest.bin);
    if (target === null) return null;
    const slash = materializationName.indexOf('/');
    const command = slash === -1 ? materializationName : materializationName.slice(slash + 1);
    return { [command]: target };
  }
  if (
    manifest.bin === null ||
    typeof manifest.bin !== 'object' ||
    Array.isArray(manifest.bin) ||
    Object.getPrototypeOf(manifest.bin) !== Object.prototype
  ) {
    return null;
  }
  const output: Record<string, string> = {};
  for (const [command, targetValue] of Object.entries(manifest.bin)) {
    if (!UNSCOPED_KEY.test(command)) return null;
    const target = normalizeManifestBinTarget(targetValue);
    if (target === null) return null;
    output[command] = target;
  }
  return output;
}

function equalStringMaps(
  left: Readonly<Record<string, string>>,
  right: Readonly<Record<string, string>>,
): boolean {
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every((key, index) => key === rightKeys[index] && left[key] === right[key])
  );
}

function validateMaterializationManifest(
  files: readonly ShadowMaterializationFile[],
  name: string,
  version: string,
  bin: Readonly<Record<string, string>>,
  path: string,
): void {
  const manifestFile = files.find((file) => file.path === 'package.json');
  if (!manifestFile) {
    throw new ShadowRegistryCodecError(`${path}.files`, 'package.json is missing');
  }
  const manifestPath = `${path}.files.package.json`;
  let parsed: unknown;
  try {
    parsed = JSON.parse(manifestFile.content) as unknown;
  } catch {
    throw new ShadowRegistryCodecError(manifestPath, 'invalid JSON');
  }
  if (
    parsed === null ||
    typeof parsed !== 'object' ||
    Array.isArray(parsed) ||
    Object.getPrototypeOf(parsed) !== Object.prototype
  ) {
    throw new ShadowRegistryCodecError(
      manifestPath,
      'package identity disagrees with materialization',
    );
  }
  const manifest = parsed as Record<string, unknown>;
  if (manifest.name !== name || manifest.version !== version) {
    throw new ShadowRegistryCodecError(
      manifestPath,
      'package identity disagrees with materialization',
    );
  }
  const manifestBins = manifestBinMap(manifest, name);
  if (manifestBins === null || !equalStringMaps(manifestBins, bin)) {
    throw new ShadowRegistryCodecError(
      `${manifestPath}.bin`,
      'package bin disagrees with materialization',
    );
  }
}

function decodeRecipe(value: unknown, path: string): BuiltinShadowSubstitutionRecipe {
  if (
    value === null ||
    typeof value !== 'object' ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new ShadowRegistryCodecError(path, 'must be a plain object');
  }
  const hasBinding = Object.hasOwn(value, 'binding');
  const item = record(
    value,
    hasBinding
      ? [
          'schema',
          'id',
          'digest',
          'trigger',
          'admission',
          'acquisition',
          'materialization',
          'binding',
        ]
      : ['schema', 'id', 'digest', 'trigger', 'admission', 'acquisition', 'materialization'],
    path,
  );
  if (item.schema !== 2) {
    throw new ShadowRegistryCodecError(`${path}.schema`, 'unsupported schema');
  }
  const trigger = record(item.trigger, ['name', 'version'], `${path}.trigger`);
  const materialization = record(
    item.materialization,
    ['files', 'name', 'version', 'bin'],
    `${path}.materialization`,
  );
  const files = decodeMaterializationFiles(materialization.files, `${path}.materialization.files`);
  const bin = decodeBinMap(materialization.bin, `${path}.materialization.bin`);
  const filePaths = new Set(files.map((file) => file.path));
  for (const [command, target] of Object.entries(bin)) {
    if (!filePaths.has(target)) {
      throw new ShadowRegistryCodecError(
        `${path}.materialization.bin.${command}`,
        `target ${target} is missing from materialization files`,
      );
    }
  }
  const materializationName = packageName(materialization.name, `${path}.materialization.name`);
  const materializationVersion = exactVersion(
    materialization.version,
    `${path}.materialization.version`,
  );
  validateMaterializationManifest(
    files,
    materializationName,
    materializationVersion,
    bin,
    `${path}.materialization`,
  );
  const recipeWithoutDigest = {
    schema: 2 as const,
    id: identifier(item.id, `${path}.id`),
    trigger: {
      name: packageName(trigger.name, `${path}.trigger.name`),
      version: exactVersion(trigger.version, `${path}.trigger.version`),
    },
    admission: decodeAdmission(item.admission, `${path}.admission`),
    acquisition: decodeAcquisition(item.acquisition, `${path}.acquisition`),
    materialization: {
      name: materializationName,
      version: materializationVersion,
      bin,
      files,
    },
    ...(hasBinding
      ? (() => {
          const binding = record(item.binding, ['adapterId'], `${path}.binding`);
          return {
            binding: { adapterId: identifier(binding.adapterId, `${path}.binding.adapterId`) },
          };
        })()
      : {}),
  };
  const digest = sha(item.digest, `${path}.digest`);
  if (shadowDigest(recipeWithoutDigest) !== digest) {
    throw new ShadowRegistryCodecError(`${path}.digest`, 'recipe digest mismatch');
  }
  return { ...recipeWithoutDigest, digest };
}

function freezeDeep<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeDeep(child);
    Object.freeze(value);
  }
  return value;
}

export function decodeShadowSubstitutionCatalog(value: unknown): BuiltinShadowSubstitutionCatalog {
  const item = record(value, ['digest', 'id', 'recipes', 'schema'], 'catalog');
  if (item.schema !== 2) {
    throw new ShadowRegistryCodecError('catalog.schema', 'unsupported schema');
  }
  const recipes = denseArray(item.recipes, 'catalog.recipes').map((recipe, index) =>
    decodeRecipe(recipe, `catalog.recipes[${index}]`),
  );
  sortedUnique(
    recipes.map((recipe) => recipe.id),
    'catalog.recipes',
    'identity',
  );
  const payload = {
    schema: 2 as const,
    id: identifier(item.id, 'catalog.id'),
    recipes,
  };
  const digest = sha(item.digest, 'catalog.digest');
  if (shadowDigest(payload) !== digest) {
    throw new ShadowRegistryCodecError('catalog.digest', 'catalog digest mismatch');
  }
  const decoded = { ...payload, digest };
  if (canonicalShadowJson(decoded) !== canonicalShadowJson(value)) {
    throw new ShadowRegistryCodecError('catalog', 'non-canonical representation');
  }
  return freezeDeep(decoded);
}

export const builtinShadowSubstitutionCatalog = decodeShadowSubstitutionCatalog(generatedCatalog);

export function decodeBuiltinShadowSubstitutionCatalog(
  value: unknown,
): BuiltinShadowSubstitutionCatalog {
  const decoded = decodeShadowSubstitutionCatalog(value);
  if (
    decoded.id !== builtinShadowSubstitutionCatalog.id ||
    decoded.digest !== builtinShadowSubstitutionCatalog.digest
  ) {
    throw new ShadowRegistryCodecError('catalog', 'not the admitted builtin catalog identity');
  }
  return decoded;
}
