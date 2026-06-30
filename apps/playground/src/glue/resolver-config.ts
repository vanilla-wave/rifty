/**
 * Eddy fast-install resolver URL (ADR-0182), env-config only (D-004): default
 * OFF, never a baked default. When `VITE_RIFTY_RESOLVER_URL` is set, the
 * playground's `npm install` uses the opt-in fast path (with auto-fallback to
 * the standard verifying install). Mirrors the `VITE_RIFTY_REGISTRY_URL`
 * pattern in `registry-fetch.ts`.
 */
export function getResolverUrl(): string | undefined {
  const value = import.meta.env.VITE_RIFTY_RESOLVER_URL;
  if (typeof value === 'string' && value.length > 0) return value;
  return undefined;
}
