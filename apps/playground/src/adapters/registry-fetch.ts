/**
 * Fetcher for `@rifty/npm-client.RegistryClient` that routes every request
 * through the playground's `/npm-registry` proxy.
 *
 * Without rewriting, the registry returns `dist.tarball` as a fully-qualified
 * `https://registry.npmjs.org/...` URL. Fetching that from the browser
 * succeeds for the packument (CORS-friendly JSON) but tarballs are served as
 * application/octet-stream — fine for CORS, but going through the proxy keeps
 * traffic on one origin and avoids surprises. So we rewrite both packument
 * URLs and tarball URLs to the proxied origin.
 */
import type { Fetcher } from '@rifty/npm-client';

const UPSTREAM_PREFIX = 'https://registry.npmjs.org';
const PROXY_PREFIX = '/npm-registry';

export function proxiedRegistryFetch(): Fetcher {
  return async (url: string, init?: RequestInit) => {
    const rewritten = url.startsWith(UPSTREAM_PREFIX)
      ? PROXY_PREFIX + url.slice(UPSTREAM_PREFIX.length)
      : url;
    return globalThis.fetch(rewritten, init);
  };
}
