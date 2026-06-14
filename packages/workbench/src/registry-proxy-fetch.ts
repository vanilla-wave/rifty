import type { Fetcher } from '@riftydev/npm-client';

export interface RegistryProxyFetchOptions {
  readonly upstreamPrefix?: string;
  readonly proxyPrefix: string;
  readonly fetch?: Fetcher;
}

export function createRegistryProxyFetch(opts: RegistryProxyFetchOptions): Fetcher {
  const upstreamPrefix = opts.upstreamPrefix ?? 'https://registry.npmjs.org';
  const fetcher = opts.fetch ?? ((url, init) => globalThis.fetch(url, init));
  return async (url, init) => {
    const rewritten = url.startsWith(upstreamPrefix)
      ? opts.proxyPrefix + url.slice(upstreamPrefix.length)
      : url;
    return fetcher(rewritten, init);
  };
}
