const ABSOLUTE_HTTP_URL = /^https?:\/\//i;

interface ResolvedPlaygroundUrl {
  readonly isRootRelative: boolean;
  readonly url: URL;
}

function resolvePlaygroundUrl(configuredBaseUrl: string | undefined): ResolvedPlaygroundUrl {
  const baseUrl = configuredBaseUrl?.trim();
  if (!baseUrl) {
    throw new Error(
      'VITE_RIFTY_PLAYGROUND_URL must be configured as an absolute http(s) URL or a root-relative path',
    );
  }
  const isRootRelative = baseUrl.startsWith('/') && !baseUrl.startsWith('//');

  if (!isRootRelative && !ABSOLUTE_HTTP_URL.test(baseUrl)) {
    throw new Error(
      'VITE_RIFTY_PLAYGROUND_URL must be an absolute http(s) URL or a root-relative path',
    );
  }

  return {
    isRootRelative,
    url: new URL(baseUrl, 'https://self-hosted.invalid/'),
  };
}

function serializePlaygroundUrl(resolved: ResolvedPlaygroundUrl): string {
  const { isRootRelative, url } = resolved;
  return isRootRelative ? `${url.pathname}${url.search}${url.hash}` : url.href;
}

/** Build the direct playground exit from an absolute deployment URL or same-origin route. */
export function buildPlaygroundHref(configuredBaseUrl: string | undefined): string {
  return serializePlaygroundUrl(resolvePlaygroundUrl(configuredBaseUrl));
}

/** Build a preset deeplink through the same validated playground URL seam. */
export function buildPresetHref(preset: string, configuredBaseUrl: string | undefined): string {
  const resolved = resolvePlaygroundUrl(configuredBaseUrl);
  resolved.url.searchParams.set('preset', preset);
  resolved.url.searchParams.set('autorun', '1');
  return serializePlaygroundUrl(resolved);
}
