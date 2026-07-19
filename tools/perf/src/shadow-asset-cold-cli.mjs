const SHADOW_ASSET_COLD_OPTION = '--shadow-asset-cold';

function optionValues(args, name) {
  const values = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== name) continue;
    values.push(args[index + 1] ?? '');
  }
  return values;
}

function absoluteRegistryUrl(value) {
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
  if (mode !== 'off' && mode !== 'standard') {
    throw new TypeError(
      `${SHADOW_ASSET_COLD_OPTION} must be off|standard; received ${JSON.stringify(mode)}`,
    );
  }
  if (mode === 'off') return { mode: 'off' };
  const registryUrl = absoluteRegistryUrl(env.VITE_RIFTY_REGISTRY_URL);
  if (registryUrl === null) {
    throw new TypeError(
      `${SHADOW_ASSET_COLD_OPTION} standard requires an absolute http(s) VITE_RIFTY_REGISTRY_URL`,
    );
  }
  if (runs !== 5) {
    throw new TypeError(`${SHADOW_ASSET_COLD_OPTION} standard requires exactly 5 runs`);
  }
  if (transport !== 'auto') {
    throw new TypeError(`${SHADOW_ASSET_COLD_OPTION} standard requires --transport auto`);
  }
  return { mode: 'standard', registryUrl };
}

/** Standard host environment: inherited Eddy configuration cannot reach Vite. */
export function shadowAssetColdHostEnv(env) {
  const clean = { ...env };
  delete clean.VITE_RIFTY_RESOLVER_URL;
  delete clean.VITE_RIFTY_EDDY_BUNDLE_URL;
  return clean;
}
