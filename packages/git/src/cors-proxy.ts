/**
 * Git CORS-proxy URL — D-004 (ADR-0028) tiered env-config, mirroring
 * npm-client's getRegistryBaseUrl. Smart-HTTP git over the browser hits the
 * same cross-origin wall as the npm registry; the proxy host is therefore
 * NEVER hardcoded — it comes from env, and an empty default means "no proxy
 * configured" (the transport layer decides what to do with that).
 */

/**
 * Git CORS-proxy base URL, in priority order:
 *   1. `globalThis.__RIFTY_GIT_CORS_PROXY__` (playground bootstrap),
 *   2. `globalThis.import.meta.env.RIFTY_GIT_CORS_PROXY` (Vite-style build env),
 *   3. `process.env.RIFTY_GIT_CORS_PROXY` (Node-side test harness),
 *   4. `''` (default — no proxy configured).
 *
 * Never hardcode a proxy URL elsewhere (D-004 / ADR-0028).
 */
export function getGitCorsProxyUrl(): string {
  const g = globalThis as Record<string, unknown>;
  const fromBootstrap = g.__RIFTY_GIT_CORS_PROXY__;
  if (typeof fromBootstrap === 'string' && fromBootstrap.length > 0) return fromBootstrap;

  // Vite-style: globalThis.import?.meta?.env?.RIFTY_GIT_CORS_PROXY
  const importObj = g.import;
  if (importObj && typeof importObj === 'object') {
    const meta = (importObj as { meta?: unknown }).meta;
    if (meta && typeof meta === 'object') {
      const env = (meta as { env?: unknown }).env;
      if (env && typeof env === 'object') {
        const value = (env as Record<string, unknown>).RIFTY_GIT_CORS_PROXY;
        if (typeof value === 'string' && value.length > 0) return value;
      }
    }
  }

  // Node-side (vitest, harness).
  if (typeof process !== 'undefined' && process.env) {
    const fromEnv = process.env.RIFTY_GIT_CORS_PROXY;
    if (typeof fromEnv === 'string' && fromEnv.length > 0) return fromEnv;
  }

  return '';
}
