/**
 * Out-of-band eddy bundle prefetch: start the (GET-by-hash or POST) bundle
 * fetch BEFORE `install()` runs — e.g. at playground owner boot — so the
 * network round-trip overlaps boot work instead of serializing after it.
 *
 * Trust model: the handle is keyed on the CANONICAL request it was started
 * for; `install()` consumes it only when its own canonical request matches
 * (`take(key)`), so a prefetch made for stale deps is ignored — never trusted.
 * The response itself still flows through the fast path's full verification
 * (format, v3, integrity, coverage) like any other bundle.
 */

import {
  type EddyRequestBody,
  bundleUrlFor,
  canonicalEddyRequestKey,
} from './eddy-request.ts';

export interface EddyPrefetchHandle {
  /** The pinned closure hash this prefetch was a GET for (absent → it POSTed).
   * Lets the installer skip a duplicate GET attempt for the same hash. */
  readonly closureHash?: string;
  /** One-shot: the in-flight response iff `requestKey` equals this prefetch's
   * canonical key; `null` on mismatch and after the first take. */
  take(requestKey: string): Promise<Response> | null;
}

export interface StartEddyPrefetchOptions {
  resolverUrl: string;
  request: EddyRequestBody;
  prefer?: 'cached' | 'online';
  /** Pinned closure hash → cacheable `GET /bundle/<hash>`; absent → the
   * CORS-simple POST resolve. */
  closureHash?: string;
  /** Injectable fetch (tests); defaults to the global. */
  fetchImpl?: typeof fetch;
}

export function startEddyPrefetch(opts: StartEddyPrefetchOptions): EddyPrefetchHandle {
  const key = canonicalEddyRequestKey(opts.request, opts.prefer ?? 'cached');
  const fetchImpl = opts.fetchImpl ?? fetch;
  const body: Record<string, unknown> = { ...opts.request };
  if (opts.prefer) body.prefer = opts.prefer;
  const response = opts.closureHash
    ? fetchImpl(bundleUrlFor(opts.resolverUrl, opts.closureHash))
    : // Same CORS-simple POST the installer sends (no content-type header).
      fetchImpl(opts.resolverUrl, { method: 'POST', body: JSON.stringify(body) });
  // An untaken failed prefetch must never surface as an unhandled rejection;
  // the ORIGINAL promise (with its rejection) is what `take` hands out.
  response.catch(() => {});
  let taken = false;
  return {
    ...(opts.closureHash === undefined ? {} : { closureHash: opts.closureHash }),
    take(requestKey: string): Promise<Response> | null {
      if (taken || requestKey !== key) return null;
      taken = true;
      return response;
    },
  };
}
