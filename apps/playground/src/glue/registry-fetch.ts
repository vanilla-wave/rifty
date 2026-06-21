/**
 * Fetcher for `@riftydev/npm-client.RegistryClient` that routes every request
 * through the configured npm-registry proxy.
 *
 * Without rewriting, the registry returns `dist.tarball` as a fully-qualified
 * `https://registry.npmjs.org/...` URL. Fetching that from the browser
 * succeeds for the packument (CORS-friendly JSON), but routing both metadata
 * and tarballs through one configured proxy keeps COEP/CORP behavior explicit.
 */
import { type Fetcher, getRegistryBaseUrl } from '@riftydev/npm-client';

const UPSTREAM_PREFIX = 'https://registry.npmjs.org';

interface ProxiedRegistryFetchOptions {
  readonly proxyPrefix?: string;
  readonly fetcher?: Fetcher;
}

function viteRegistryBaseUrl(): string | undefined {
  const value = import.meta.env.VITE_RIFTY_REGISTRY_URL;
  if (typeof value === 'string' && value.length > 0) return value;
  return undefined;
}

function registryProxyPrefix(override: string | undefined): string {
  return (override ?? viteRegistryBaseUrl() ?? getRegistryBaseUrl()).replace(/\/$/, '');
}

export function proxiedRegistryFetch(options: ProxiedRegistryFetchOptions = {}): Fetcher {
  const proxyPrefix = registryProxyPrefix(options.proxyPrefix);
  const fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis);

  return async (url: string, init?: RequestInit) => {
    const rewritten = url.startsWith(UPSTREAM_PREFIX)
      ? proxyPrefix + url.slice(UPSTREAM_PREFIX.length)
      : url;
    return fetcher(rewritten, init);
  };
}
