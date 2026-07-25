import { NotImplementedError } from '@riftydev/io';
import {
  type BuiltinShadowSubstitutionRecipe,
  type ShadowRecipeAcquisition,
  type ShadowRuntimeAsset,
  builtinShadowSubstitutionCatalog,
  canonicalShadowJson,
  decodeDenseDataArray,
  shadowDigest,
} from '@riftydev/shadow-registry/internal';
import { type Vfs, joinPath } from '@riftydev/vfs';

export type ShadowSubstitutionCatalog = typeof builtinShadowSubstitutionCatalog;

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
  readonly binding?: Readonly<{ adapterId: string; assets: readonly string[] }>;
}

export interface ShadowAssetPlan {
  readonly requiredSetDigest: string;
  readonly substitutions: readonly Readonly<AppliedShadowSubstitution>[];
  readonly assets: readonly Readonly<ShadowRuntimeAsset>[];
  readonly bindings: readonly Readonly<{ adapterId: string; assets: readonly string[] }>[];
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

function recipeForTrigger(
  catalog: ShadowSubstitutionCatalog,
  name: string,
  version: string,
): BuiltinShadowSubstitutionRecipe {
  const recipe = catalog.recipes.find(
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
  catalog: ShadowSubstitutionCatalog = builtinShadowSubstitutionCatalog,
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
  const recipe = recipeForTrigger(catalog, name, version);
  const fact: AppliedShadowSubstitution = {
    catalog: {
      id: catalog.id,
      digest: catalog.digest,
    },
    substitutionId: recipe.id,
    recipeDigest: recipe.digest,
    trigger: { name, requestedRange, version },
    acquisition: acquisitionFact(recipe, input.acquisition),
    materialization: materializationFact(recipe, text(input.installPath, 'shadow installPath')),
    ...(recipe.binding
      ? { binding: { adapterId: recipe.binding.adapterId, assets: [...recipe.binding.assets] } }
      : {}),
  };
  return freezeDeep(fact);
}

function decodeApplied(
  value: unknown,
  catalogAuthority: ShadowSubstitutionCatalog,
): AppliedShadowSubstitution {
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
  if (catalog.id !== catalogAuthority.id || catalog.digest !== catalogAuthority.digest) {
    throw new TypeError('applied shadow substitution catalog identity drifted');
  }
  const substitutionId = text(raw.substitutionId, 'substitutionId');
  const recipe = catalogAuthority.recipes.find((candidate) => candidate.id === substitutionId);
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
  let suppliedBinding: Readonly<{ adapterId: string; assets: readonly string[] }> | undefined;
  if (raw.binding !== undefined) {
    const binding = exact(raw.binding, ['adapterId', 'assets'], 'applied binding');
    const assets = decodeDenseDataArray(binding.assets, 'applied binding assets');
    suppliedBinding = {
      adapterId: text(binding.adapterId, 'applied binding adapterId'),
      assets: assets.map((asset, index) => text(asset, `applied binding asset ${index}`)),
    };
  }
  const installPath = text(materialization.installPath, 'applied installPath');
  const decoded = attestBuiltinShadowSubstitution(
    {
      trigger: {
        name: text(trigger.name, 'applied trigger name'),
        requestedRange,
        version: text(trigger.version, 'applied trigger version'),
      },
      installPath,
      acquisition,
    },
    catalogAuthority,
  );
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

function finishPlan(
  substitutions: readonly AppliedShadowSubstitution[],
  catalog: ShadowSubstitutionCatalog,
): ShadowAssetPlan {
  const assetsById = new Map(catalog.assets.map((asset) => [asset.id, asset]));
  const required = new Map<string, ShadowRuntimeAsset>();
  const bindings = new Map<string, { adapterId: string; assets: readonly string[] }>();
  for (const substitution of substitutions) {
    if (!substitution.binding) continue;
    const existing = bindings.get(substitution.binding.adapterId);
    if (
      existing &&
      canonicalShadowJson(existing.assets) !== canonicalShadowJson(substitution.binding.assets)
    ) {
      throw new TypeError(`shadow adapter ${substitution.binding.adapterId} has divergent assets`);
    }
    bindings.set(substitution.binding.adapterId, {
      adapterId: substitution.binding.adapterId,
      assets: [...substitution.binding.assets],
    });
    for (const id of substitution.binding.assets) {
      const asset = assetsById.get(id);
      if (!asset) throw new TypeError(`shadow binding names unknown asset ${id}`);
      required.set(id, asset);
    }
  }
  const projectedBindings = [...bindings.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, value]) => value);
  const assets = [...required.values()]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((asset) => structuredClone(asset));
  const payload = { schema: 1, substitutions, assets, bindings: projectedBindings };
  return freezeDeep({
    requiredSetDigest: shadowDigest(payload),
    substitutions: [...substitutions],
    assets,
    bindings: projectedBindings,
  });
}

function planDecodedShadowSubstitutions(
  values: readonly AppliedShadowSubstitution[],
  catalog: ShadowSubstitutionCatalog,
): ShadowAssetPlan {
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
  return finishPlan(decoded, catalog);
}

export function planAppliedShadowSubstitutions(
  values: readonly AppliedShadowSubstitution[],
  catalog: ShadowSubstitutionCatalog = builtinShadowSubstitutionCatalog,
): ShadowAssetPlan {
  return planDecodedShadowSubstitutions(
    decodeDenseDataArray(values, 'applied shadow substitutions').map((value) =>
      decodeApplied(value, catalog),
    ),
    catalog,
  );
}

/** Package-private core for facts already returned by this module's attester. */
export function planTrustedAppliedShadowSubstitutions(
  values: readonly AppliedShadowSubstitution[],
  catalog: ShadowSubstitutionCatalog = builtinShadowSubstitutionCatalog,
): ShadowAssetPlan {
  if (!Array.isArray(values) || values.some((value) => !Object.isFrozen(value))) {
    throw new TypeError('trusted shadow substitutions invariant failed');
  }
  return planDecodedShadowSubstitutions(values, catalog);
}

export function decodeShadowAssetPlan(
  value: unknown,
  catalog: ShadowSubstitutionCatalog = builtinShadowSubstitutionCatalog,
): ShadowAssetPlan {
  const raw = exact(
    value,
    ['assets', 'bindings', 'requiredSetDigest', 'substitutions'],
    'shadow asset plan',
  );
  const suppliedSubstitutions = decodeDenseDataArray(
    raw.substitutions,
    'shadow plan substitutions',
  ).map((entry) => decodeApplied(entry, catalog));
  const suppliedAssets = decodeDenseDataArray(raw.assets, 'shadow plan assets').map(
    (value, index) => {
      const asset = exact(
        value,
        [
          'id',
          'maxTarballBytes',
          'maxUnpackedBytes',
          'member',
          'memberSha256',
          'memberSize',
          'source',
        ],
        `shadow plan asset ${index}`,
      );
      const source = exact(
        asset.source,
        ['integrity', 'name', 'version'],
        `shadow plan asset ${index} source`,
      );
      return {
        id: text(asset.id, `shadow plan asset ${index} id`),
        source: {
          name: text(source.name, `shadow plan asset ${index} source name`),
          version: text(source.version, `shadow plan asset ${index} source version`),
          integrity: strictIntegrity(
            source.integrity,
            `shadow plan asset ${index} source integrity`,
          ),
        },
        member: text(asset.member, `shadow plan asset ${index} member`),
        memberSha256: text(asset.memberSha256, `shadow plan asset ${index} memberSha256`),
        memberSize: asset.memberSize,
        maxTarballBytes: asset.maxTarballBytes,
        maxUnpackedBytes: asset.maxUnpackedBytes,
      };
    },
  );
  const suppliedBindings = decodeDenseDataArray(raw.bindings, 'shadow plan bindings').map(
    (value, index) => {
      const binding = exact(value, ['adapterId', 'assets'], `shadow plan binding ${index}`);
      const assets = decodeDenseDataArray(binding.assets, `shadow plan binding ${index} assets`);
      return {
        adapterId: text(binding.adapterId, `shadow plan binding ${index} adapterId`),
        assets: assets.map((asset, assetIndex) =>
          text(asset, `shadow plan binding ${index} asset ${assetIndex}`),
        ),
      };
    },
  );
  const requiredSetDigest = text(raw.requiredSetDigest, 'shadow plan requiredSetDigest');
  if (!SHA.test(requiredSetDigest)) throw new TypeError('shadow plan requiredSetDigest is invalid');
  const plan = planTrustedAppliedShadowSubstitutions(suppliedSubstitutions, catalog);
  const supplied = {
    requiredSetDigest,
    substitutions: suppliedSubstitutions,
    assets: suppliedAssets,
    bindings: suppliedBindings,
  };
  if (canonicalShadowJson(plan) !== canonicalShadowJson(supplied))
    throw new TypeError('shadow asset plan is non-canonical or tampered');
  return plan;
}

export const SHADOW_LOCKFILE_PROTOCOL = 'rifty.shadow-substitutions/v1' as const;
const SHADOW_RESOLVED_PREFIX = 'rifty:shadow-substitution/';

export interface ShadowSubstitutionLockfileTrace {
  readonly protocol: typeof SHADOW_LOCKFILE_PROTOCOL;
  readonly applied: readonly AppliedShadowSubstitution[];
}

export function createShadowSubstitutionLockfileTrace(
  plan: ShadowAssetPlan,
): ShadowSubstitutionLockfileTrace {
  if (!Object.isFrozen(plan) || !Object.isFrozen(plan.substitutions)) {
    throw new TypeError('trusted shadow plan invariant failed');
  }
  return freezeDeep({
    protocol: SHADOW_LOCKFILE_PROTOCOL,
    applied: structuredClone(plan.substitutions),
  });
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

function registryAcquisitionInstallPath(substitution: AppliedShadowSubstitution): string {
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

export function planShadowSubstitutionsFromLockfile(
  value: unknown,
  catalog: ShadowSubstitutionCatalog = builtinShadowSubstitutionCatalog,
): ShadowAssetPlan {
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
    return planAppliedShadowSubstitutions([], catalog);
  }
  try {
    const metadata = exact(rifty, ['shadowSubstitutions'], 'lockfile rifty metadata');
    const trace = exact(
      metadata.shadowSubstitutions,
      ['applied', 'protocol'],
      'shadow lockfile trace',
    );
    if (trace.protocol !== SHADOW_LOCKFILE_PROTOCOL)
      throw new TypeError('shadow lockfile trace protocol is unsupported');
    const suppliedApplied = decodeDenseDataArray(
      trace.applied,
      'shadow lockfile trace applied',
    ).map((entry) => decodeApplied(entry, catalog));
    const plan = planTrustedAppliedShadowSubstitutions(suppliedApplied, catalog);
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
    const canonical = createShadowSubstitutionLockfileTrace(plan);
    const suppliedTrace = { protocol: trace.protocol, applied: suppliedApplied };
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
  plan: ShadowAssetPlan,
  report: (line: string) => void,
  catalog: ShadowSubstitutionCatalog = builtinShadowSubstitutionCatalog,
): Promise<void> {
  if (!Object.isFrozen(plan) || !Object.isFrozen(plan.substitutions)) {
    throw new TypeError('trusted shadow plan invariant failed');
  }
  for (const substitution of plan.substitutions) {
    if (substitution.acquisition.kind !== 'registry') continue;
    const recipe = catalog.recipes.find(
      (candidate) => candidate.id === substitution.substitutionId,
    );
    if (!recipe)
      throw new NotImplementedError(
        `shadow-registry.substitutionRecipe.${substitution.substitutionId}`,
      );
    for (const file of recipe.materialization.files) {
      const path = joinPath(root, `${substitution.materialization.installPath}/${file.path}`);
      await vfs.mkdir(path.slice(0, path.lastIndexOf('/')), { recursive: true });
      await vfs.writeFile(path, new TextEncoder().encode(file.content));
    }
    report(
      `npm: ${substitution.trigger.name}@${substitution.trigger.requestedRange ?? '*'} materialized from shadow registry (${substitution.substitutionId})`,
    );
  }
}
