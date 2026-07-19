export type ShadowAssetColdMeasurementOptions =
  | Readonly<{ mode: 'standard'; registryUrl: string }>
  | Readonly<{
      mode: 'eddy';
      registryUrl: string;
      resolverUrl: string;
      bundleBaseUrl: string;
    }>;

export interface ShadowAssetColdPackageAcquisition {
  readonly registryUrl: string;
  readonly eddy?: Readonly<{
    readonly resolverUrl: string;
    readonly bundleBaseUrl: string;
  }>;
}

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('shadow-asset cold options must be an object');
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): void {
  const keys = Object.keys(value).sort();
  const exact = [...expected].sort();
  if (keys.length !== exact.length || keys.some((key, index) => key !== exact[index])) {
    throw new TypeError('shadow-asset cold options have extra or missing fields');
  }
}

function absoluteHttpUrl(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new TypeError(`${label} must be an absolute http(s) URL`);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError(`${label} must be an absolute http(s) URL`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new TypeError(`${label} must be an absolute http(s) URL`);
  }
  return url.href.replace(/\/$/u, '');
}

/** Exact public Workbench package-acquisition input for one measured context. */
export function shadowAssetColdPackageAcquisition(
  input: unknown,
): ShadowAssetColdPackageAcquisition {
  const options = record(input);
  const registryUrl = absoluteHttpUrl(options.registryUrl, 'shadow-asset cold registry URL');
  if (options.mode === 'standard') {
    exactKeys(options, ['mode', 'registryUrl']);
    return Object.freeze({ registryUrl });
  }
  if (options.mode !== 'eddy') {
    throw new TypeError('shadow-asset cold mode must be standard|eddy');
  }
  exactKeys(options, ['bundleBaseUrl', 'mode', 'registryUrl', 'resolverUrl']);
  return Object.freeze({
    registryUrl,
    eddy: Object.freeze({
      resolverUrl: absoluteHttpUrl(options.resolverUrl, 'shadow-asset cold Eddy resolver URL'),
      bundleBaseUrl: absoluteHttpUrl(
        options.bundleBaseUrl,
        'shadow-asset cold Eddy bundle base URL',
      ),
    }),
  });
}
