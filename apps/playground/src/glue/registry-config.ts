import { getRegistryBaseUrl } from '@riftydev/npm-client';

/** Resolve deploy-time App configuration before constructing registry clients. */
export function resolveRegistryProxyPrefix(
  viteRegistryUrl: unknown,
  defaultRegistryUrl: () => string,
): string {
  const configured =
    typeof viteRegistryUrl === 'string' && viteRegistryUrl.length > 0
      ? viteRegistryUrl
      : defaultRegistryUrl();
  return configured.replace(/\/$/, '');
}

/** Registry base used by App composition and its preconnect (ADR-0195). */
export function getRegistryProxyPrefix(): string {
  return resolveRegistryProxyPrefix(import.meta.env.VITE_RIFTY_REGISTRY_URL, getRegistryBaseUrl);
}
