import {
  type RegistryClient,
  type ShadowAssetSource,
  type TarballCache,
  createBuiltinEddyShadowAssetSource,
  createStandardShadowAssetSource,
} from '@riftydev/npm-client';

interface EddySourceConfig {
  readonly resolverUrl: string;
  readonly bundleBaseUrl: string;
}

interface WorkbenchShadowAssetSourceOptions {
  readonly registry: RegistryClient;
  readonly tarballCache: TarballCache;
  readonly eddy?: EddySourceConfig;
  readonly fetchImpl?: typeof fetch;
  readonly warn?: (line: string) => void;
}

/** One owner-lifetime source and learned-pin state feeding the one manager. */
export function createWorkbenchShadowAssetSource(
  options: WorkbenchShadowAssetSourceOptions,
): ShadowAssetSource {
  const standardSource = createStandardShadowAssetSource({
    registry: options.registry,
    tarballCache: options.tarballCache,
  });
  if (options.eddy === undefined) return standardSource;
  return createBuiltinEddyShadowAssetSource({
    resolverUrl: options.eddy.resolverUrl,
    bundleBaseUrl: options.eddy.bundleBaseUrl,
    standardSource,
    learnedPins: new Map(),
    ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
    ...(options.warn === undefined ? {} : { warn: options.warn }),
  });
}
