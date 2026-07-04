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

import { DEFAULT_BUNDLE_MAX_BYTES, DEFAULT_BUNDLE_STALL_MS } from './eddy-bundle-stream.ts';
import { type EddyRequestBody, bundleUrlFor, canonicalEddyRequestKey } from './eddy-request.ts';

export interface EddyPrefetchHandle {
  /** The pinned closure hash this prefetch was a GET for (absent → it POSTed).
   * The installer verifies the consumed response against it (content-addressed
   * fetches must return the hash they asked for). */
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
  /** Base URL for the pinned GET (defaults to `resolverUrl`) — a CDN host may
   * serve GET-by-hash while POST stays on the origin (ADR-0195). */
  bundleBaseUrl?: string;
  /** Injectable fetch (tests); defaults to the global. */
  fetchImpl?: typeof fetch;
  /** Eager-drain no-progress bound (ms): a body chunk must arrive within this
   * window or the prefetch REJECTS (the installer then falls through to its
   * own GET/POST). Default {@link DEFAULT_PREFETCH_STALL_MS}. */
  stallTimeoutMs?: number;
  /** Eager-drain byte cap: an over-cap body rejects the prefetch (the POST
   * fallback streams, so a legit huge bundle still installs — it just skips
   * the buffered prefetch). Default {@link DEFAULT_PREFETCH_MAX_BYTES}. */
  maxBufferBytes?: number;
}

/** One bound for every acquisition path: the direct GET/POST streams
 * (`streamTarEntries`) and this eager drain share the same constants. */
export const DEFAULT_PREFETCH_MAX_BYTES = DEFAULT_BUNDLE_MAX_BYTES;
export const DEFAULT_PREFETCH_STALL_MS = DEFAULT_BUNDLE_STALL_MS;

/**
 * Buffer the whole body with a no-progress timeout + byte cap. A never-ending
 * or runaway stream must REJECT (→ installer fallback), never park the
 * consumer forever: an unbounded `arrayBuffer()` here once hung `npm install`
 * with no error when the resolver held the connection open.
 */
async function drainBounded(
  response: Response,
  stallMs: number,
  maxBytes: number,
): Promise<Uint8Array<ArrayBuffer>> {
  const body = response.body;
  if (!body) return new Uint8Array(await response.arrayBuffer());
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const read = reader.read();
      // A raced-out read settles later (cancel() resolves it {done:true});
      // never let a late rejection surface as unhandled.
      read.catch(() => {});
      const next = await Promise.race([
        read,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`eddy prefetch: no body progress for ${stallMs}ms`)),
            stallMs,
          );
        }),
      ]).finally(() => clearTimeout(timer));
      if (next.done) break;
      total += next.value.length;
      if (total > maxBytes) {
        throw new Error(`eddy prefetch: body exceeded ${maxBytes} bytes`);
      }
      chunks.push(next.value);
    }
  } catch (err) {
    void reader.cancel().catch(() => {});
    throw err;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

export function startEddyPrefetch(opts: StartEddyPrefetchOptions): EddyPrefetchHandle {
  const key = canonicalEddyRequestKey(opts.request, opts.prefer ?? 'cached');
  const fetchImpl = opts.fetchImpl ?? fetch;
  const body: Record<string, unknown> = { ...opts.request };
  if (opts.prefer) body.prefer = opts.prefer;
  const response = opts.closureHash
    ? fetchImpl(bundleUrlFor(opts.bundleBaseUrl ?? opts.resolverUrl, opts.closureHash))
    : // Same CORS-simple POST the installer sends (no content-type header).
      fetchImpl(opts.resolverUrl, { method: 'POST', body: JSON.stringify(body) });
  // Drain the body EAGERLY: a response left unread across the boot window
  // stalls its h2 stream (measured ~10s on ~1-in-3 installs, 2026-07-02
  // probe) — buffering downloads the bundle DURING boot and makes the later
  // consume instant. `take` hands out a synthetic Response over the buffered
  // bytes with the original status/headers, so the installer's gates (JSON
  // decline, !ok, streaming unpack) see the same shape. The drain is BOUNDED
  // (no-progress timeout + byte cap): a never-ending body rejects instead of
  // parking the taker forever — the installer's attempt pipeline then falls
  // through to its own GET/POST.
  const stallMs = opts.stallTimeoutMs ?? DEFAULT_PREFETCH_STALL_MS;
  const maxBytes = opts.maxBufferBytes ?? DEFAULT_PREFETCH_MAX_BYTES;
  const buffered = response.then(async (r) => ({
    status: r.status,
    statusText: r.statusText,
    headers: r.headers,
    bytes: await drainBounded(r, stallMs, maxBytes),
  }));
  // An untaken failed prefetch must never surface as an unhandled rejection;
  // the ORIGINAL rejection still reaches whoever takes the handle.
  buffered.catch(() => {});
  let taken = false;
  return {
    ...(opts.closureHash === undefined ? {} : { closureHash: opts.closureHash }),
    take(requestKey: string): Promise<Response> | null {
      if (taken || requestKey !== key) return null;
      taken = true;
      return buffered.then(
        (r) =>
          new Response(r.bytes, { status: r.status, statusText: r.statusText, headers: r.headers }),
      );
    },
  };
}
