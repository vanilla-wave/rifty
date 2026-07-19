const SHADOW_ASSET_COLD_OPTION = '--shadow-asset-cold';

function optionValues(args, name) {
  const values = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== name) continue;
    values.push(args[index + 1] ?? '');
  }
  return values;
}

function absoluteHttpUrl(value) {
  if (typeof value !== 'string' || value.length === 0) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? value : null;
  } catch {
    return null;
  }
}

/** Validate the dedicated measurement phase before a server or Chromium exists. */
export function parseShadowAssetColdOptions({ args, env, runs, transport }) {
  const values = optionValues(args, SHADOW_ASSET_COLD_OPTION);
  if (values.length > 1) throw new TypeError(`${SHADOW_ASSET_COLD_OPTION} may appear only once`);
  const mode = values[0] ?? 'off';
  if (mode !== 'off' && mode !== 'standard' && mode !== 'eddy') {
    throw new TypeError(
      `${SHADOW_ASSET_COLD_OPTION} must be off|standard|eddy; received ${JSON.stringify(mode)}`,
    );
  }
  if (mode === 'off') return { mode: 'off' };
  const registryUrl = absoluteHttpUrl(env.VITE_RIFTY_REGISTRY_URL);
  if (registryUrl === null) {
    throw new TypeError(
      `${SHADOW_ASSET_COLD_OPTION} ${mode} requires an absolute http(s) VITE_RIFTY_REGISTRY_URL`,
    );
  }
  if (runs !== 5) {
    throw new TypeError(`${SHADOW_ASSET_COLD_OPTION} ${mode} requires exactly 5 runs`);
  }
  if (transport !== 'auto') {
    throw new TypeError(`${SHADOW_ASSET_COLD_OPTION} ${mode} requires --transport auto`);
  }
  if (mode === 'standard') return { mode, registryUrl };

  const resolverUrl = absoluteHttpUrl(env.VITE_RIFTY_RESOLVER_URL);
  if (resolverUrl === null) {
    throw new TypeError(
      `${SHADOW_ASSET_COLD_OPTION} eddy requires an absolute http(s) VITE_RIFTY_RESOLVER_URL`,
    );
  }
  const configuredBundleUrl = env.VITE_RIFTY_EDDY_BUNDLE_URL;
  const bundleUrl =
    configuredBundleUrl === undefined || configuredBundleUrl === ''
      ? resolverUrl
      : absoluteHttpUrl(configuredBundleUrl);
  if (bundleUrl === null) {
    throw new TypeError(
      `${SHADOW_ASSET_COLD_OPTION} eddy requires an absolute http(s) VITE_RIFTY_EDDY_BUNDLE_URL when configured`,
    );
  }
  return { mode, registryUrl, resolverUrl, bundleUrl };
}

/** Measured host environment: standard strips Eddy; Eddy uses only parsed endpoints. */
export function shadowAssetColdHostEnv(env, options = { mode: 'standard' }) {
  const clean = { ...env };
  if (options.mode === 'eddy') {
    clean.VITE_RIFTY_REGISTRY_URL = options.registryUrl;
    clean.VITE_RIFTY_RESOLVER_URL = options.resolverUrl;
    clean.VITE_RIFTY_EDDY_BUNDLE_URL = options.bundleUrl;
    return clean;
  }
  // biome-ignore lint/performance/noDelete: spawn env must omit inherited Eddy configuration.
  delete clean.VITE_RIFTY_RESOLVER_URL;
  // biome-ignore lint/performance/noDelete: spawn env must omit inherited Eddy configuration.
  delete clean.VITE_RIFTY_EDDY_BUNDLE_URL;
  return clean;
}

function plainRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Reuse the exact measured standard input that the schema-v3 artifact recorded. */
export function preserveStandardShadowAssetColdInput(artifact, eddyOptions) {
  if (!plainRecord(eddyOptions) || eddyOptions.mode !== 'eddy') {
    throw new TypeError('shadow asset cold standard preservation requires parsed Eddy options');
  }
  if (!plainRecord(artifact) || artifact.schemaVersion !== 3) {
    throw new TypeError('Eddy shadow asset cold measurement requires a schema-v3 artifact');
  }
  if (!plainRecord(artifact.runner) || artifact.runner.runs !== 5) {
    throw new TypeError('schema-v3 standard artifact must record exactly 5 runs');
  }
  const standard = artifact.metrics?.shadowAssetColdFillMs?.standard;
  if (!plainRecord(standard) || standard.status !== 'measured') {
    throw new TypeError('schema-v3 artifact must contain a measured standard shadow asset row');
  }
  if (
    standard.count !== 5 ||
    !Array.isArray(standard.samples) ||
    standard.samples.length !== 5 ||
    !Array.isArray(standard.runs) ||
    standard.runs.length !== 5
  ) {
    throw new TypeError('schema-v3 measured standard shadow asset row must contain exactly 5 runs');
  }
  if (standard.registryUrl !== eddyOptions.registryUrl) {
    throw new TypeError(
      'schema-v3 measured standard registry URL must exactly match the Eddy registry URL',
    );
  }
  return standard;
}

/** Refuse an Eddy artifact if aggregation changed even the serialized STD row. */
export function assertPreservedStandardShadowAssetColdOutput(artifact, preservedStandard) {
  const output = artifact?.metrics?.shadowAssetColdFillMs?.standard;
  if (
    !plainRecord(output) ||
    !plainRecord(preservedStandard) ||
    JSON.stringify(output) !== JSON.stringify(preservedStandard)
  ) {
    throw new Error('Eddy shadow asset cold output must preserve the standard row verbatim');
  }
}
