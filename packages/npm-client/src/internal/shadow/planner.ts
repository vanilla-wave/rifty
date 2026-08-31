import { NotImplementedError } from '@riftydev/io';
import {
  type BuiltinShadowSubstitutionRecipe,
  type ShadowRecipeAcquisition,
  builtinShadowSubstitutionCatalog,
  canonicalShadowJson,
  decodeDenseDataArray,
} from '@riftydev/shadow-registry/internal';
import { type Vfs, joinPath } from '@riftydev/vfs';
import { matchesRange } from '../../semver.ts';
import { isSchemaOneBuiltinShadowSubstitutionIdentity } from './schema-one-identity.ts';

export interface AppliedShadowSubstitution {
  readonly catalog: Readonly<{ id: string; digest: string }>;
  readonly substitutionId: string;
  readonly recipeDigest: string;
  readonly trigger: Readonly<{ name: string; requestedRange: string | null; version: string }>;
  readonly acquisition:
    | Readonly<{ kind: 'synthetic' }>
    | Readonly<{
        kind: 'registry';
        name: string;
        version: string;
        resolved: string;
        integrity: string;
      }>;
  readonly materialization: Readonly<{
    installPath: string;
    name: string;
    version: string;
    files: readonly Readonly<{ path: string; sha256: string; bytes: number }>[];
  }>;
  readonly binding?: Readonly<{ adapterId: string }>;
}

export interface ShadowSubstitutionPlan {
  readonly substitutions: readonly Readonly<AppliedShadowSubstitution>[];
  readonly bindings: readonly Readonly<{ adapterId: string; packagePath: string }>[];
}

export interface RegistryShadowEmbeddedDependency {
  readonly name: string;
  readonly range: string;
  readonly version: string;
  readonly installPath: string;
}

export interface RegistryShadowEmbeddedSource {
  readonly acquisitionInstallPath: string;
  readonly dependencies: readonly RegistryShadowEmbeddedDependency[];
}

export interface AttestBuiltinShadowSubstitutionInput {
  readonly trigger: Readonly<{ name: string; requestedRange: string | null; version: string }>;
  readonly installPath: string;
  readonly acquisition:
    | Readonly<{ kind: 'synthetic' }>
    | Readonly<{
        kind: 'registry';
        name: string;
        version: string;
        resolved: string;
        integrity: string;
      }>;
}

const SHA = /^[0-9a-f]{64}$/;
const SRI = /^sha(?:256|384|512)-[A-Za-z0-9+/]+={0,2}$/;

function plain(value: unknown, label: string): Record<string, unknown> {
  if (
    value === null ||
    typeof value !== 'object' ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new TypeError(`${label} must be a plain object`);
  }
  if (Object.getOwnPropertySymbols(value).length > 0)
    throw new TypeError(`${label} has symbol fields`);
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
    if (!('value' in descriptor)) throw new TypeError(`${label} has accessors`);
  }
  return value as Record<string, unknown>;
}

function exact(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  const result = plain(value, label);
  const descriptors = Object.getOwnPropertyDescriptors(result);
  const actual = Object.keys(descriptors).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new TypeError(`${label} has extra or missing fields`);
  }
  if (Object.values(descriptors).some((descriptor) => descriptor.enumerable !== true)) {
    throw new TypeError(`${label} has non-enumerable fields`);
  }
  return result;
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0)
    throw new TypeError(`${label} must be a non-empty string`);
  return value;
}

function strictIntegrity(value: unknown, label: string): string {
  const result = text(value, label);
  if (!SRI.test(result)) throw new TypeError(`${label} is not canonical SRI`);
  const dash = result.indexOf('-');
  const algorithm = result.slice(0, dash);
  const encoded = result.slice(dash + 1);
  let decoded: string;
  try {
    decoded = atob(encoded);
  } catch {
    throw new TypeError(`${label} is not base64`);
  }
  const expected = algorithm === 'sha256' ? 32 : algorithm === 'sha384' ? 48 : 64;
  if (decoded.length !== expected || btoa(decoded) !== encoded) {
    throw new TypeError(`${label} has wrong-length or non-canonical base64`);
  }
  return result;
}

function freezeDeep<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeDeep(child);
    Object.freeze(value);
  }
  return value;
}

function recipeForTrigger(name: string, version: string): BuiltinShadowSubstitutionRecipe {
  const recipe = builtinShadowSubstitutionCatalog.recipes.find(
    (candidate) => candidate.trigger.name === name && candidate.trigger.version === version,
  );
  if (!recipe) throw new NotImplementedError(`shadow-registry.${name}@${version}`);
  return recipe;
}

function materializationFact(recipe: BuiltinShadowSubstitutionRecipe, installPath: string) {
  if (
    installPath.startsWith('/') ||
    installPath.includes('\\') ||
    !installPath.endsWith(`node_modules/${recipe.materialization.name}`) ||
    installPath.split('/').some((part) => part === '' || part === '.' || part === '..')
  ) {
    throw new TypeError(`invalid shadow materialization installPath ${installPath}`);
  }
  return {
    installPath,
    name: recipe.materialization.name,
    version: recipe.materialization.version,
    files: recipe.materialization.files.map(({ path, sha256, bytes }) => ({ path, sha256, bytes })),
  };
}

function acquisitionFact(
  recipe: BuiltinShadowSubstitutionRecipe,
  inputValue: unknown,
): AppliedShadowSubstitution['acquisition'] {
  const inputRecord = plain(inputValue, 'shadow acquisition');
  const kind = inputRecord.kind;
  const input =
    kind === 'synthetic'
      ? exact(inputValue, ['kind'], 'synthetic shadow acquisition')
      : exact(
          inputValue,
          ['integrity', 'kind', 'name', 'resolved', 'version'],
          'registry shadow acquisition',
        );
  if (recipe.acquisition.kind !== input.kind)
    throw new TypeError('shadow substitution acquisition kind drifted');
  if (input.kind === 'synthetic') return { kind: 'synthetic' };
  if (input.kind !== 'registry') throw new TypeError('shadow acquisition kind is unsupported');
  const expected = recipe.acquisition as Extract<ShadowRecipeAcquisition, { kind: 'registry' }>;
  const name = text(input.name, 'shadow acquisition name');
  const version = text(input.version, 'shadow acquisition version');
  if (name !== expected.name || version !== expected.version) {
    throw new TypeError('shadow substitution acquisition coordinates drifted');
  }
  const resolved = text(input.resolved, 'shadow acquisition resolved');
  return {
    kind: 'registry',
    name,
    version,
    resolved,
    integrity: strictIntegrity(input.integrity, 'shadow acquisition integrity'),
  };
}

export function attestBuiltinShadowSubstitution(
  inputValue: AttestBuiltinShadowSubstitutionInput,
): AppliedShadowSubstitution {
  const input = exact(inputValue, ['acquisition', 'installPath', 'trigger'], 'shadow attestation');
  const trigger = exact(input.trigger, ['name', 'requestedRange', 'version'], 'shadow trigger');
  const name = text(trigger.name, 'shadow trigger name');
  const version = text(trigger.version, 'shadow trigger version');
  const requestedRange = trigger.requestedRange;
  if (
    requestedRange !== null &&
    (typeof requestedRange !== 'string' || requestedRange.length === 0)
  ) {
    throw new TypeError('shadow requestedRange must be a non-empty string or null');
  }
  const recipe = recipeForTrigger(name, version);
  const fact: AppliedShadowSubstitution = {
    catalog: {
      id: builtinShadowSubstitutionCatalog.id,
      digest: builtinShadowSubstitutionCatalog.digest,
    },
    substitutionId: recipe.id,
    recipeDigest: recipe.digest,
    trigger: { name, requestedRange, version },
    acquisition: acquisitionFact(recipe, input.acquisition),
    materialization: materializationFact(recipe, text(input.installPath, 'shadow installPath')),
    ...(recipe.binding ? { binding: { adapterId: recipe.binding.adapterId } } : {}),
  };
  return freezeDeep(fact);
}

function decodeApplied(value: unknown): AppliedShadowSubstitution {
  const raw =
    value !== null && typeof value === 'object' && Object.hasOwn(value, 'binding')
      ? exact(
          value,
          [
            'acquisition',
            'binding',
            'catalog',
            'materialization',
            'recipeDigest',
            'substitutionId',
            'trigger',
          ],
          'applied shadow substitution',
        )
      : exact(
          value,
          [
            'acquisition',
            'catalog',
            'materialization',
            'recipeDigest',
            'substitutionId',
            'trigger',
          ],
          'applied shadow substitution',
        );
  const catalog = exact(raw.catalog, ['digest', 'id'], 'applied catalog identity');
  if (
    catalog.id !== builtinShadowSubstitutionCatalog.id ||
    catalog.digest !== builtinShadowSubstitutionCatalog.digest
  ) {
    throw new TypeError('applied shadow substitution catalog identity drifted');
  }
  const substitutionId = text(raw.substitutionId, 'substitutionId');
  const recipe = builtinShadowSubstitutionCatalog.recipes.find(
    (candidate) => candidate.id === substitutionId,
  );
  if (!recipe)
    throw new NotImplementedError(`shadow-registry.substitutionRecipe.${substitutionId}`);
  if (raw.recipeDigest !== recipe.digest)
    throw new TypeError('applied shadow substitution recipe digest drifted');
  const trigger = exact(raw.trigger, ['name', 'requestedRange', 'version'], 'applied trigger');
  const requestedRange = trigger.requestedRange;
  if (
    requestedRange !== null &&
    (typeof requestedRange !== 'string' || requestedRange.length === 0)
  ) {
    throw new TypeError('applied requestedRange is invalid');
  }
  const acquisition = acquisitionFact(recipe, raw.acquisition);
  const materialization = exact(
    raw.materialization,
    ['files', 'installPath', 'name', 'version'],
    'applied materialization',
  );
  const suppliedFiles = decodeDenseDataArray(
    materialization.files,
    'applied materialization files',
  ).map((value, index) => {
    const file = exact(value, ['bytes', 'path', 'sha256'], `applied materialization file ${index}`);
    const bytes = file.bytes;
    if (!Number.isSafeInteger(bytes) || (bytes as number) < 0) {
      throw new TypeError(`applied materialization file ${index} bytes is invalid`);
    }
    const sha256 = text(file.sha256, `applied materialization file ${index} sha256`);
    if (!SHA.test(sha256))
      throw new TypeError(`applied materialization file ${index} sha256 is invalid`);
    return {
      path: text(file.path, `applied materialization file ${index} path`),
      sha256,
      bytes: bytes as number,
    };
  });
  let suppliedBinding: Readonly<{ adapterId: string }> | undefined;
  if (raw.binding !== undefined) {
    const binding = exact(raw.binding, ['adapterId'], 'applied binding');
    suppliedBinding = { adapterId: text(binding.adapterId, 'applied binding adapterId') };
  }
  const installPath = text(materialization.installPath, 'applied installPath');
  const decoded = attestBuiltinShadowSubstitution({
    trigger: {
      name: text(trigger.name, 'applied trigger name'),
      requestedRange,
      version: text(trigger.version, 'applied trigger version'),
    },
    installPath,
    acquisition,
  });
  const supplied = {
    catalog: {
      id: text(catalog.id, 'applied catalog id'),
      digest: text(catalog.digest, 'applied catalog digest'),
    },
    substitutionId,
    recipeDigest: text(raw.recipeDigest, 'applied recipe digest'),
    trigger: {
      name: text(trigger.name, 'applied trigger name'),
      requestedRange,
      version: text(trigger.version, 'applied trigger version'),
    },
    acquisition,
    materialization: {
      installPath,
      name: text(materialization.name, 'applied materialization name'),
      version: text(materialization.version, 'applied materialization version'),
      files: suppliedFiles,
    },
    ...(suppliedBinding ? { binding: suppliedBinding } : {}),
  };
  if (canonicalShadowJson(decoded) !== canonicalShadowJson(supplied))
    throw new TypeError('applied shadow substitution is non-canonical or tampered');
  return decoded;
}

function finishPlan(substitutions: readonly AppliedShadowSubstitution[]): ShadowSubstitutionPlan {
  const bindings = substitutions
    .filter(
      (
        substitution,
      ): substitution is AppliedShadowSubstitution & {
        readonly binding: Readonly<{ adapterId: string }>;
      } => substitution.binding !== undefined,
    )
    .map((substitution) => {
      if (substitution.acquisition.kind !== 'registry') {
        throw new TypeError(
          `shadow adapter ${substitution.binding.adapterId} requires registry bytes`,
        );
      }
      return {
        adapterId: substitution.binding.adapterId,
        packagePath: registryAcquisitionInstallPath(substitution),
      };
    })
    .sort((left, right) => canonicalShadowJson(left).localeCompare(canonicalShadowJson(right)));
  return freezeDeep({
    substitutions: [...substitutions],
    bindings,
  });
}

function planDecodedShadowSubstitutions(
  values: readonly AppliedShadowSubstitution[],
): ShadowSubstitutionPlan {
  const decoded = [...values];
  decoded.sort((left, right) =>
    canonicalShadowJson(left).localeCompare(canonicalShadowJson(right)),
  );
  const seen = new Set<string>();
  for (const substitution of decoded) {
    const key = substitution.materialization.installPath;
    if (seen.has(key)) throw new TypeError(`duplicate shadow materialization ${key}`);
    seen.add(key);
  }
  return finishPlan(decoded);
}

export function planAppliedShadowSubstitutions(
  values: readonly AppliedShadowSubstitution[],
): ShadowSubstitutionPlan {
  return planDecodedShadowSubstitutions(
    decodeDenseDataArray(values, 'applied shadow substitutions').map(decodeApplied),
  );
}

/** Package-private core for facts already returned by this module's attester. */
export function planTrustedAppliedShadowSubstitutions(
  values: readonly AppliedShadowSubstitution[],
): ShadowSubstitutionPlan {
  if (!Array.isArray(values) || values.some((value) => !Object.isFrozen(value))) {
    throw new TypeError('trusted shadow substitutions invariant failed');
  }
  return planDecodedShadowSubstitutions(values);
}

export function decodeShadowSubstitutionPlan(value: unknown): ShadowSubstitutionPlan {
  const raw = exact(value, ['bindings', 'substitutions'], 'shadow substitution plan');
  const suppliedSubstitutions = decodeDenseDataArray(
    raw.substitutions,
    'shadow plan substitutions',
  ).map(decodeApplied);
  const suppliedBindings = decodeDenseDataArray(raw.bindings, 'shadow plan bindings').map(
    (value, index) => {
      const binding = exact(value, ['adapterId', 'packagePath'], `shadow plan binding ${index}`);
      return {
        adapterId: text(binding.adapterId, `shadow plan binding ${index} adapterId`),
        packagePath: text(binding.packagePath, `shadow plan binding ${index} packagePath`),
      };
    },
  );
  const plan = planTrustedAppliedShadowSubstitutions(suppliedSubstitutions);
  const supplied = {
    substitutions: suppliedSubstitutions,
    bindings: suppliedBindings,
  };
  if (canonicalShadowJson(plan) !== canonicalShadowJson(supplied))
    throw new TypeError('shadow substitution plan is non-canonical or tampered');
  return plan;
}

export const SHADOW_LOCKFILE_PROTOCOL = 'rifty.shadow-substitutions/v2' as const;
const SHADOW_RESOLVED_PREFIX = 'rifty:shadow-substitution/';

interface RegistryShadowTraceAcquisition {
  readonly kind: 'registry';
  readonly name: string;
  readonly version: string;
  readonly resolved: string;
  readonly integrity: string;
  readonly dependencies: Readonly<Record<string, string>>;
  readonly optionalDependencies: Readonly<Record<string, string>>;
  readonly peerDependencies: Readonly<Record<string, string>>;
  readonly bundleDependencies: readonly string[];
  readonly bundled: readonly Readonly<{
    name: string;
    version: string;
    inBundle: true;
  }>[];
}

interface ShadowSubstitutionLockfileTraceFact {
  readonly catalog: Readonly<{ id: string; digest: string }>;
  readonly substitutionId: string;
  readonly recipeDigest: string;
  readonly trigger: Readonly<{ name: string; requestedRange: string | null; version: string }>;
  readonly acquisition: Readonly<{ kind: 'synthetic' }> | RegistryShadowTraceAcquisition;
  readonly materialization: Readonly<{
    installPath: string;
    name: string;
    version: string;
    files: readonly Readonly<{ path: string; sha256: string; bytes: number }>[];
    bin: Readonly<Record<string, string>>;
  }>;
  readonly binding?: Readonly<{ adapterId: string }>;
}

export interface ShadowSubstitutionLockfileTrace {
  readonly protocol: typeof SHADOW_LOCKFILE_PROTOCOL;
  readonly applied: readonly ShadowSubstitutionLockfileTraceFact[];
}

export function createShadowSubstitutionLockfileTrace(
  plan: ShadowSubstitutionPlan,
  lockfile: { readonly packages: Readonly<Record<string, unknown>> },
): ShadowSubstitutionLockfileTrace {
  if (!Object.isFrozen(plan) || !Object.isFrozen(plan.substitutions)) {
    throw new TypeError('trusted shadow plan invariant failed');
  }
  const embeddedSources = registryShadowEmbeddedSourcesFromLockfile(lockfile, plan);
  const embeddedByAcquisitionPath = new Map(
    embeddedSources.map((source) => [source.acquisitionInstallPath, source]),
  );
  if (embeddedByAcquisitionPath.size !== embeddedSources.length) {
    throw new TypeError('shadow embedded source facts are ambiguous');
  }
  return freezeDeep({
    protocol: SHADOW_LOCKFILE_PROTOCOL,
    applied: plan.substitutions.map((substitution): ShadowSubstitutionLockfileTraceFact => {
      const recipe = builtinShadowSubstitutionCatalog.recipes.find(
        (candidate) => candidate.id === substitution.substitutionId,
      );
      if (!recipe) {
        throw new NotImplementedError(
          `shadow-registry.substitutionRecipe.${substitution.substitutionId}`,
        );
      }
      const acquisition =
        substitution.acquisition.kind === 'synthetic'
          ? ({ kind: 'synthetic' } as const)
          : registryTraceAcquisition(
              substitution,
              recipe,
              embeddedByAcquisitionPath.get(registryAcquisitionInstallPath(substitution)),
            );
      return {
        catalog: { ...substitution.catalog },
        substitutionId: substitution.substitutionId,
        recipeDigest: substitution.recipeDigest,
        trigger: { ...substitution.trigger },
        acquisition,
        materialization: {
          installPath: substitution.materialization.installPath,
          name: substitution.materialization.name,
          version: substitution.materialization.version,
          files: substitution.materialization.files.map((file) => ({ ...file })),
          bin: { ...recipe.materialization.bin },
        },
        ...(substitution.binding ? { binding: { adapterId: substitution.binding.adapterId } } : {}),
      };
    }),
  });
}

function registryTraceAcquisition(
  substitution: AppliedShadowSubstitution,
  recipe: BuiltinShadowSubstitutionRecipe,
  embeddedSource: RegistryShadowEmbeddedSource | undefined,
): RegistryShadowTraceAcquisition {
  if (substitution.acquisition.kind !== 'registry' || recipe.acquisition.kind !== 'registry') {
    throw new TypeError(`shadow substitution ${substitution.substitutionId} acquisition drifted`);
  }
  const projection = recipe.acquisition.dependencyProjection;
  const bundled = embeddedSource?.dependencies ?? [];
  if (bundled.length !== projection.bundledDependencies.length) {
    throw new TypeError(
      `shadow substitution ${substitution.substitutionId} embedded source count drifted`,
    );
  }
  return {
    kind: 'registry',
    name: substitution.acquisition.name,
    version: substitution.acquisition.version,
    resolved: substitution.acquisition.resolved,
    integrity: substitution.acquisition.integrity,
    dependencies: { ...projection.dependencies },
    optionalDependencies: { ...projection.optionalDependencies },
    peerDependencies: { ...projection.peerDependencies },
    bundleDependencies: [...projection.bundledDependencies],
    bundled: bundled.map(({ name, version }) => ({ name, version, inBundle: true })),
  };
}

function brokenShadowTrace(message: string, cause?: unknown): Error {
  const error =
    cause === undefined
      ? new Error(`EBROKENLOCK: ${message}`)
      : new Error(`EBROKENLOCK: ${message}`, { cause });
  return Object.assign(error, {
    code: 'EBROKENLOCK' as const,
    reason: 'shadow-trace-drift' as const,
  });
}

function isBrokenShadowTrace(error: unknown): boolean {
  return (
    error !== null && typeof error === 'object' && 'code' in error && error.code === 'EBROKENLOCK'
  );
}

function ownDataProperty(value: unknown, key: string): unknown {
  if (
    value === null ||
    typeof value !== 'object' ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    return undefined;
  }
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && 'value' in descriptor ? descriptor.value : undefined;
}

function schemaOneFactPackageName(value: unknown): string | null {
  const catalog = ownDataProperty(value, 'catalog');
  const substitutionId = ownDataProperty(value, 'substitutionId');
  if (
    !isSchemaOneBuiltinShadowSubstitutionIdentity(ownDataProperty(catalog, 'id'), substitutionId)
  ) {
    return null;
  }
  const packageName = ownDataProperty(ownDataProperty(value, 'trigger'), 'name');
  return typeof packageName === 'string' && packageName.length > 0 ? packageName : null;
}

function rejectSchemaOneTrace(applied: readonly unknown[]): void {
  const offenders = applied.flatMap((fact) => {
    const packageName = schemaOneFactPackageName(fact);
    return packageName === null
      ? []
      : [{ canonical: canonicalShadowJson(fact), packageName, fact }];
  });
  offenders.sort((left, right) =>
    left.canonical < right.canonical ? -1 : left.canonical > right.canonical ? 1 : 0,
  );
  const first = offenders[0];
  if (!first) return;
  throw Object.assign(
    brokenShadowTrace(`schema-1 shadow substitution for ${first.packageName} cannot replay as v2`),
    { packageName: first.packageName },
  );
}

function strictStringRecord(value: unknown, label: string): Record<string, string> {
  const record = plain(value, label);
  const descriptors = Object.getOwnPropertyDescriptors(record);
  if (Object.values(descriptors).some((descriptor) => descriptor.enumerable !== true)) {
    throw new TypeError(`${label} has non-enumerable fields`);
  }
  return Object.fromEntries(
    Object.entries(record).map(([name, range]) => [
      text(name, `${label} name`),
      text(range, `${label}.${name}`),
    ]),
  );
}

function optionalStringRecord(value: unknown, label: string): Record<string, string> {
  return value === undefined ? {} : strictStringRecord(value, label);
}

function matchesStringRecord(
  actual: Readonly<Record<string, string>>,
  expected: Readonly<Record<string, string>>,
): boolean {
  const entries = Object.entries(actual);
  return (
    entries.length === Object.keys(expected).length &&
    entries.every(([name, range]) => expected[name] === range)
  );
}

function decodeTraceAcquisition(value: unknown): Readonly<{
  applied: AppliedShadowSubstitution['acquisition'];
  trace: ShadowSubstitutionLockfileTraceFact['acquisition'];
}> {
  const raw = plain(value, 'shadow trace acquisition');
  if (raw.kind === 'synthetic') {
    exact(raw, ['kind'], 'synthetic shadow trace acquisition');
    const acquisition = { kind: 'synthetic' as const };
    return { applied: acquisition, trace: acquisition };
  }
  if (raw.kind !== 'registry') {
    throw new TypeError('shadow trace acquisition kind is unsupported');
  }
  const registry = exact(
    raw,
    [
      'bundleDependencies',
      'bundled',
      'dependencies',
      'integrity',
      'kind',
      'name',
      'optionalDependencies',
      'peerDependencies',
      'resolved',
      'version',
    ],
    'registry shadow trace acquisition',
  );
  const applied = {
    kind: 'registry' as const,
    name: text(registry.name, 'shadow trace acquisition name'),
    version: text(registry.version, 'shadow trace acquisition version'),
    resolved: text(registry.resolved, 'shadow trace acquisition resolved'),
    integrity: strictIntegrity(registry.integrity, 'shadow trace acquisition integrity'),
  };
  const dependencies = strictStringRecord(
    registry.dependencies,
    'shadow trace acquisition dependencies',
  );
  const optionalDependencies = strictStringRecord(
    registry.optionalDependencies,
    'shadow trace acquisition optionalDependencies',
  );
  const peerDependencies = strictStringRecord(
    registry.peerDependencies,
    'shadow trace acquisition peerDependencies',
  );
  const bundleDependencies = decodeDenseDataArray(
    registry.bundleDependencies,
    'shadow trace acquisition bundleDependencies',
  ).map((name, index) => text(name, `shadow trace acquisition bundleDependencies ${index}`));
  const bundled = decodeDenseDataArray(registry.bundled, 'shadow trace acquisition bundled').map(
    (value, index) => {
      const child = exact(
        value,
        ['inBundle', 'name', 'version'],
        `shadow trace acquisition bundled ${index}`,
      );
      if (child.inBundle !== true) {
        throw new TypeError(`shadow trace acquisition bundled ${index} inBundle must be true`);
      }
      return {
        name: text(child.name, `shadow trace acquisition bundled ${index} name`),
        version: text(child.version, `shadow trace acquisition bundled ${index} version`),
        inBundle: true as const,
      };
    },
  );
  return {
    applied,
    trace: {
      ...applied,
      dependencies,
      optionalDependencies,
      peerDependencies,
      bundleDependencies,
      bundled,
    },
  };
}

function decodeTraceApplied(value: unknown): Readonly<{
  applied: AppliedShadowSubstitution;
  trace: ShadowSubstitutionLockfileTraceFact;
}> {
  const hasBinding = value !== null && typeof value === 'object' && Object.hasOwn(value, 'binding');
  const raw = exact(
    value,
    [
      'acquisition',
      ...(hasBinding ? ['binding'] : []),
      'catalog',
      'materialization',
      'recipeDigest',
      'substitutionId',
      'trigger',
    ],
    'shadow trace applied substitution',
  );
  const acquisition = decodeTraceAcquisition(raw.acquisition);
  const materialization = exact(
    raw.materialization,
    ['bin', 'files', 'installPath', 'name', 'version'],
    'shadow trace materialization',
  );
  const bin = strictStringRecord(materialization.bin, 'shadow trace materialization bin');
  const applied = decodeApplied({
    catalog: raw.catalog,
    substitutionId: raw.substitutionId,
    recipeDigest: raw.recipeDigest,
    trigger: raw.trigger,
    acquisition: acquisition.applied,
    materialization: {
      installPath: materialization.installPath,
      name: materialization.name,
      version: materialization.version,
      files: materialization.files,
    },
    ...(hasBinding ? { binding: raw.binding } : {}),
  });
  return {
    applied,
    trace: freezeDeep({
      ...applied,
      acquisition: acquisition.trace,
      materialization: { ...applied.materialization, bin },
    }),
  };
}

function hasReservedShadowIdentity(value: unknown): boolean {
  if (value === null || typeof value !== 'object') return false;
  const descriptor = Object.getOwnPropertyDescriptor(value, 'resolved');
  return (
    descriptor !== undefined &&
    'value' in descriptor &&
    typeof descriptor.value === 'string' &&
    descriptor.value.startsWith(SHADOW_RESOLVED_PREFIX)
  );
}

export function registryAcquisitionInstallPath(substitution: AppliedShadowSubstitution): string {
  if (substitution.acquisition.kind !== 'registry') {
    throw new TypeError('registry acquisition path requires a registry substitution');
  }
  const suffix = `node_modules/${substitution.materialization.name}`;
  const installPath = substitution.materialization.installPath;
  if (!installPath.endsWith(suffix)) {
    throw new TypeError(`shadow materialization has invalid install path ${installPath}`);
  }
  return `${installPath.slice(0, installPath.length - substitution.materialization.name.length)}${
    substitution.acquisition.name
  }`;
}

export function registryShadowEmbeddedSourcesFromLockfile(
  lockfile: { readonly packages: Readonly<Record<string, unknown>> },
  plan: ShadowSubstitutionPlan,
): readonly RegistryShadowEmbeddedSource[] {
  try {
    const packages = plain(lockfile.packages, 'lockfile packages');
    const sources: RegistryShadowEmbeddedSource[] = [];
    for (const substitution of plan.substitutions) {
      if (substitution.acquisition.kind !== 'registry') continue;
      const recipe = builtinShadowSubstitutionCatalog.recipes.find(
        (candidate) => candidate.id === substitution.substitutionId,
      );
      if (!recipe || recipe.acquisition.kind !== 'registry') {
        throw brokenShadowTrace(
          `registry shadow substitution ${substitution.substitutionId} has no registry recipe`,
        );
      }
      const projection = recipe.acquisition.dependencyProjection;
      const acquisitionInstallPath = registryAcquisitionInstallPath(substitution);
      const acquisitionEntry = plain(
        packages[acquisitionInstallPath],
        `lockfile package ${acquisitionInstallPath}`,
      );
      const acquisitionDependencies = optionalStringRecord(
        acquisitionEntry.dependencies,
        `lockfile package ${acquisitionInstallPath} dependencies`,
      );
      if (!matchesStringRecord(acquisitionDependencies, projection.dependencies)) {
        throw brokenShadowTrace(
          `registry shadow substitution ${substitution.substitutionId} dependency projection drifted`,
        );
      }
      const acquisitionPeerDependencies = optionalStringRecord(
        acquisitionEntry.peerDependencies,
        `lockfile package ${acquisitionInstallPath} peerDependencies`,
      );
      if (!matchesStringRecord(acquisitionPeerDependencies, projection.peerDependencies)) {
        throw brokenShadowTrace(
          `registry shadow substitution ${substitution.substitutionId} peer dependency projection drifted`,
        );
      }
      const suppliedBundleDependencies = (
        acquisitionEntry.bundleDependencies === undefined
          ? []
          : decodeDenseDataArray(
              acquisitionEntry.bundleDependencies,
              `lockfile package ${acquisitionInstallPath} bundleDependencies`,
            )
      ).map((name, index) =>
        text(name, `lockfile package ${acquisitionInstallPath} bundleDependencies ${index}`),
      );
      if (
        suppliedBundleDependencies.length !== projection.bundledDependencies.length ||
        suppliedBundleDependencies.some(
          (name, index) => name !== projection.bundledDependencies[index],
        )
      ) {
        throw brokenShadowTrace(
          `registry shadow substitution ${substitution.substitutionId} bundle membership drifted`,
        );
      }
      if (projection.bundledDependencies.length === 0) continue;

      const dependencies: RegistryShadowEmbeddedDependency[] = [];
      for (const name of projection.bundledDependencies) {
        const range = projection.dependencies[name] ?? projection.optionalDependencies[name];
        if (range === undefined || acquisitionDependencies[name] !== range) {
          throw brokenShadowTrace(
            `registry shadow substitution ${substitution.substitutionId} bundled dependency ${name} range drifted`,
          );
        }
        const installPath = `${acquisitionInstallPath}/node_modules/${name}`;
        const child = exact(
          packages[installPath],
          ['inBundle', 'version'],
          `lockfile package ${installPath}`,
        );
        if (
          child.inBundle !== true ||
          typeof child.version !== 'string' ||
          !matchesRange(child.version, range)
        ) {
          throw brokenShadowTrace(
            `registry shadow substitution ${substitution.substitutionId} bundled dependency ${name} topology drifted`,
          );
        }
        dependencies.push({ name, range, version: child.version, installPath });
      }
      sources.push({ acquisitionInstallPath, dependencies });
    }
    return sources;
  } catch (error) {
    if (isBrokenShadowTrace(error)) throw error;
    throw brokenShadowTrace('registry shadow embedded-source topology is malformed', error);
  }
}

function validateLockfileEntryProvenance(
  packages: Record<string, unknown>,
  substitution: AppliedShadowSubstitution,
): void {
  const materializationPath = substitution.materialization.installPath;
  const entry = plain(
    packages[materializationPath],
    `lockfile package ${substitution.materialization.installPath}`,
  );
  if (
    entry.version !== substitution.materialization.version ||
    entry.riftyShadowRecipe !== substitution.substitutionId
  ) {
    throw brokenShadowTrace(
      `shadow substitution ${substitution.substitutionId} does not match its materialized lockfile entry`,
    );
  }

  if (substitution.acquisition.kind === 'synthetic') {
    const expectedResolved = `${SHADOW_RESOLVED_PREFIX}${substitution.substitutionId}@${substitution.recipeDigest}`;
    if (entry.resolved !== expectedResolved || Object.hasOwn(entry, 'integrity')) {
      throw brokenShadowTrace(
        `synthetic shadow substitution ${substitution.substitutionId} has forged lockfile provenance`,
      );
    }
    return;
  }

  const acquisitionPath = registryAcquisitionInstallPath(substitution);
  const acquisitionEntry = plain(packages[acquisitionPath], `lockfile package ${acquisitionPath}`);
  if (
    acquisitionEntry.version !== substitution.acquisition.version ||
    acquisitionEntry.resolved !== substitution.acquisition.resolved ||
    acquisitionEntry.integrity !== substitution.acquisition.integrity
  ) {
    throw brokenShadowTrace(
      `registry shadow substitution ${substitution.substitutionId} does not match its acquisition entry`,
    );
  }
  if (
    acquisitionPath !== materializationPath &&
    (Object.hasOwn(entry, 'resolved') || Object.hasOwn(entry, 'integrity'))
  ) {
    throw brokenShadowTrace(
      `registry shadow substitution ${substitution.substitutionId} materialization alias has forged provenance`,
    );
  }
}

export function planShadowSubstitutionsFromLockfile(value: unknown): ShadowSubstitutionPlan {
  const lockfile = plain(value, 'lockfile');
  if (lockfile.lockfileVersion !== 3)
    throw new TypeError('shadow substitution replay requires lockfile v3');
  const packages = plain(lockfile.packages, 'lockfile packages');
  const rifty = lockfile.rifty;
  if (rifty === undefined) {
    for (const entry of Object.values(packages)) {
      if (
        entry !== null &&
        typeof entry === 'object' &&
        (Object.hasOwn(entry, 'riftyShadowRecipe') || hasReservedShadowIdentity(entry))
      ) {
        throw new NotImplementedError('npm-client.lockfile.shadowSubstitutionTrace');
      }
    }
    return planAppliedShadowSubstitutions([]);
  }
  try {
    const metadata = exact(rifty, ['shadowSubstitutions'], 'lockfile rifty metadata');
    const trace = exact(
      metadata.shadowSubstitutions,
      ['applied', 'protocol'],
      'shadow lockfile trace',
    );
    const rawApplied = decodeDenseDataArray(trace.applied, 'shadow lockfile trace applied');
    rejectSchemaOneTrace(rawApplied);
    if (trace.protocol !== SHADOW_LOCKFILE_PROTOCOL)
      throw new TypeError('shadow lockfile trace protocol is unsupported');
    const decodedTrace = rawApplied.map(decodeTraceApplied);
    const suppliedApplied = decodedTrace.map(({ applied }) => applied);
    const plan = planTrustedAppliedShadowSubstitutions(suppliedApplied);
    for (const substitution of plan.substitutions) {
      validateLockfileEntryProvenance(packages, substitution);
    }
    for (const [installPath, entryValue] of Object.entries(packages)) {
      if (
        entryValue === null ||
        typeof entryValue !== 'object' ||
        (!Object.hasOwn(entryValue, 'riftyShadowRecipe') && !hasReservedShadowIdentity(entryValue))
      ) {
        continue;
      }
      const entry = plain(entryValue, `lockfile package ${installPath}`);
      const marker = Object.hasOwn(entry, 'riftyShadowRecipe')
        ? text(entry.riftyShadowRecipe, `lockfile package ${installPath} shadow marker`)
        : undefined;
      const matches = plan.substitutions.filter((substitution) => {
        if (substitution.materialization.installPath !== installPath) return false;
        if (marker !== undefined && substitution.substitutionId !== marker) return false;
        if (!hasReservedShadowIdentity(entry)) return true;
        return (
          substitution.acquisition.kind === 'synthetic' &&
          entry.resolved ===
            `${SHADOW_RESOLVED_PREFIX}${substitution.substitutionId}@${substitution.recipeDigest}`
        );
      });
      if (matches.length !== 1) {
        throw brokenShadowTrace(`shadow identity at ${installPath} has no unique trace fact`);
      }
    }
    const canonical = createShadowSubstitutionLockfileTrace(plan, { packages });
    const suppliedTrace = {
      protocol: trace.protocol,
      applied: decodedTrace.map(({ trace: fact }) => fact),
    };
    if (canonicalShadowJson(canonical) !== canonicalShadowJson(suppliedTrace))
      throw new TypeError('shadow lockfile trace is non-canonical');
    return plan;
  } catch (error) {
    if (isBrokenShadowTrace(error)) throw error;
    throw brokenShadowTrace('shadow lockfile trace is malformed or unsupported', error);
  }
}

export async function materializeRegistryShadowSubstitutions(
  vfs: Vfs,
  root: string,
  plan: ShadowSubstitutionPlan,
  report: (line: string) => void,
  checkpoint: () => void = () => {},
): Promise<void> {
  if (!Object.isFrozen(plan) || !Object.isFrozen(plan.substitutions)) {
    throw new TypeError('trusted shadow plan invariant failed');
  }
  for (const substitution of plan.substitutions) {
    checkpoint();
    if (substitution.acquisition.kind !== 'registry') continue;
    const recipe = builtinShadowSubstitutionCatalog.recipes.find(
      (candidate) => candidate.id === substitution.substitutionId,
    );
    if (!recipe)
      throw new NotImplementedError(
        `shadow-registry.substitutionRecipe.${substitution.substitutionId}`,
      );
    for (const file of recipe.materialization.files) {
      checkpoint();
      const path = joinPath(root, `${substitution.materialization.installPath}/${file.path}`);
      await vfs.mkdir(path.slice(0, path.lastIndexOf('/')), { recursive: true });
      checkpoint();
      await vfs.writeFile(path, new TextEncoder().encode(file.content));
      checkpoint();
    }
    report(
      `npm: ${substitution.trigger.name}@${substitution.trigger.requestedRange ?? '*'} materialized from shadow registry (${substitution.substitutionId})`,
    );
  }
}
