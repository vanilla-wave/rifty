import type { ShadowRegistryDependencyProjection } from '@riftydev/shadow-registry/internal';

/** Registry-owned metadata for a range recipe; never an admission allowlist. */
export function registryMetadataProjection(manifest: {
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly optionalDependencies?: Readonly<Record<string, string>>;
  readonly peerDependencies?: Readonly<Record<string, string>>;
  readonly bundleDependencies?: unknown;
  readonly bundledDependencies?: unknown;
}): ShadowRegistryDependencyProjection {
  const dependencies = { ...manifest.dependencies };
  const optionalDependencies = { ...manifest.optionalDependencies };
  const normalize = (value: unknown): string[] => {
    if (value === undefined || value === false) return [];
    if (value === true)
      return [
        ...new Set([...Object.keys(dependencies), ...Object.keys(optionalDependencies)]),
      ].sort();
    if (!Array.isArray(value) || value.some((name) => typeof name !== 'string'))
      throw new TypeError('registry bundleDependencies must be names or a boolean');
    const names = [...new Set(value as string[])].sort();
    if (names.some((name) => !(name in dependencies) && !(name in optionalDependencies)))
      throw new TypeError('registry bundled dependency has no dependency range');
    return names;
  };
  const aliases = [manifest.bundleDependencies, manifest.bundledDependencies]
    .filter((value) => value !== undefined)
    .map(normalize);
  if (aliases.length === 2 && JSON.stringify(aliases[0]) !== JSON.stringify(aliases[1]))
    throw new TypeError('registry bundled dependency aliases disagree');
  return {
    dependencies,
    optionalDependencies,
    peerDependencies: { ...manifest.peerDependencies },
    omittedOptionalDependencies: {},
    bundledDependencies: aliases[0] ?? [],
    unsupportedFeature: 'npm-client.registry.metadata',
  };
}
