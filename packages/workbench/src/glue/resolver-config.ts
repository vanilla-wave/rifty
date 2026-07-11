/**
 * Eddy fast-install resolver URL (ADR-0182), env-config only (D-004): default
 * OFF, never a baked default. When `VITE_RIFTY_RESOLVER_URL` is set, the
 * playground's `npm install` uses the opt-in fast path (with auto-fallback to
 * the standard verifying install). Mirrors the `VITE_RIFTY_REGISTRY_URL`
 * pattern in `registry-fetch.ts`.
 */
export function getResolverUrl(value?: unknown): string | undefined {
  if (typeof value === 'string' && value.length > 0) return value;
  return undefined;
}

/**
 * CDN base for pinned bundle GETs (ADR-0195): the edge won't proxy the POST
 * resolve, so GET-by-hash may ride a separate CDN hostname while POST stays on
 * `VITE_RIFTY_RESOLVER_URL`. Default absent → GETs use the resolver URL.
 */
export function getEddyBundleBaseUrl(value?: unknown): string | undefined {
  if (typeof value === 'string' && value.length > 0) return value;
  return undefined;
}

let warnedMalformedPins = false;

/**
 * Per-template pinned closure hash (ADR-0195 §5). `VITE_RIFTY_EDDY_PINS` is a
 * JSON map `template-id → closureHash` set at deploy time (D-004, default
 * absent) — keyed on the TEMPLATE id because the template owns the dep-set
 * (the runtime slug is the root id, ADR-0165). A pin turns the preset's
 * bundle fetch into a cacheable `GET /bundle/<hash>` (browser HTTP cache +
 * CDN); a stale pin degrades to POST via the client's verification gates.
 * Operator workflow + re-pin cadence: docs/public/hosting-eddy.md.
 */
export function getEddyPin(templateId: string, rawPins?: unknown): string | undefined {
  if (typeof rawPins !== 'string' || rawPins.length === 0) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawPins);
  } catch {
    if (!warnedMalformedPins) {
      warnedMalformedPins = true;
      console.warn('[rifty] VITE_RIFTY_EDDY_PINS is not valid JSON — eddy pins ignored');
    }
    return undefined;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
  const value = (parsed as Record<string, unknown>)[templateId];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
