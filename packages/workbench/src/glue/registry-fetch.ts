import { type Fetcher, RegistryClient } from '@riftydev/npm-client';

export interface RegistryEndpointOptions {
  readonly registryUrl: string;
  readonly baseUrl?: string;
}

export interface ProxiedRegistryFetchOptions extends RegistryEndpointOptions {
  readonly fetcher?: Fetcher;
}

export interface ProxiedRegistryClientOptions extends ProxiedRegistryFetchOptions {
  readonly stallTimeoutMs?: number;
}

function defaultBaseUrl(): string | undefined {
  const location = (globalThis as { readonly location?: { readonly href?: string } }).location;
  return location?.href;
}

/** Validate and absolutize the required host-owned registry proxy endpoint. */
export function validateRegistryUrl(options: RegistryEndpointOptions): string {
  if (typeof options.registryUrl !== 'string' || options.registryUrl.trim().length === 0) {
    throw new TypeError('workbench registryUrl is required');
  }
  let url: URL;
  try {
    const base = options.baseUrl ?? defaultBaseUrl();
    url = base ? new URL(options.registryUrl, base) : new URL(options.registryUrl);
  } catch {
    throw new TypeError(`workbench registryUrl is malformed: ${options.registryUrl}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new TypeError(`workbench registryUrl must use http or https: ${url.protocol}`);
  }
  if (url.username || url.password) {
    throw new TypeError('workbench registryUrl must not contain credentials');
  }
  return url.href.replace(/\/$/, '');
}

/**
 * Route metadata and absolute tarball URLs through one explicit host endpoint.
 * Registry packuments often name their upstream origin; only the path/query is
 * meaningful to a same-origin proxy, so no external origin is baked here.
 */
export function proxiedRegistryFetch(options: ProxiedRegistryFetchOptions): Fetcher {
  const proxy = validateRegistryUrl(options);
  const proxyUrl = new URL(proxy);
  const fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis);

  return async (rawUrl: string, init?: RequestInit) => {
    const requested = new URL(rawUrl, `${proxy}/`);
    const target =
      requested.origin === proxyUrl.origin && requested.pathname.startsWith(proxyUrl.pathname)
        ? requested.href
        : `${proxy}${requested.pathname.startsWith('/') ? '' : '/'}${requested.pathname}${requested.search}`;
    return fetcher(target, init);
  };
}

export function createProxiedRegistryClient(options: ProxiedRegistryClientOptions): RegistryClient {
  const baseUrl = validateRegistryUrl(options);
  return new RegistryClient({
    baseUrl,
    fetch: proxiedRegistryFetch({ ...options, registryUrl: baseUrl }),
    stallTimeoutMs: options.stallTimeoutMs,
  });
}
