/**
 * ONE chokepoint for the `unbounded-read` fault class at npm-client's network
 * boundary (docs/process/fault-classes.md §Class-kill): every fetch this
 * package makes — the eddy attempt paths (installer, prefetch) AND the
 * standard registry path (`RegistryClient`) — bounds its header wait and body
 * drain here. PR #107 grew four sibling point-fix helpers for this axis
 * before consolidation; extend THIS module, never add a twin.
 */

/** Bodies this client fetches (packuments, tarballs, eddy bundles) are
 * single-digit-to-tens of MB; the cap only guards a runaway body (or a forged
 * length that would buffer unbounded). */
export const DEFAULT_FETCH_MAX_BYTES = 128 * 1024 * 1024;
/** Matches the measured h2-stall class (~10s); a healthy stream delivers
 * chunks sub-second, so no-progress ≥ this is a dead connection. */
export const DEFAULT_FETCH_STALL_MS = 10_000;

export interface BodyBounds {
  /** No-progress bound (ms): a body chunk must arrive within this window or
   * the drain THROWS. A server that stalls mid-body must never park the
   * consumer forever. */
  stallTimeoutMs?: number;
  /** Total received-byte cap; exceeding it throws. */
  maxBytes?: number;
  /** Error-message prefix naming the stalled operation (phase + URL) — a
   * bound breach must say WHAT stalled. */
  label?: string;
}

export interface BoundedBodyRequest {
  readonly url: string;
  readonly method: 'GET' | 'POST';
  readonly body?: string;
  readonly signal: AbortSignal;
}

export interface BoundedBodyResult {
  readonly status: number;
  readonly statusText: string;
  readonly headers: Headers;
  readonly bytes: Uint8Array<ArrayBuffer>;
}

function abortError(): DOMException {
  return new DOMException('The operation was aborted', 'AbortError');
}

function positiveBound(value: number | undefined, fallback: number, name: string): number {
  const bound = value ?? fallback;
  if (!Number.isSafeInteger(bound) || bound <= 0) {
    throw new TypeError(`${name} must be a positive safe integer`);
  }
  return bound;
}

function responseHeaders(raw: string): Headers {
  const headers = new Headers();
  for (const line of raw.split(/\r?\n/u)) {
    if (line.length === 0) continue;
    const separator = line.indexOf(':');
    if (separator <= 0) throw new Error('XHR returned malformed response headers');
    headers.append(line.slice(0, separator).trim(), line.slice(separator + 1).trim());
  }
  return headers;
}

async function requestBodyViaFetch(
  request: BoundedBodyRequest,
  bounds: Readonly<{ stallTimeoutMs: number; maxBytes: number; label: string }>,
  fetchImpl: typeof fetch,
): Promise<BoundedBodyResult> {
  const response = await fetchHeadersBounded(
    (boundSignal) =>
      fetchImpl(request.url, {
        ...(request.method === 'POST' ? { method: request.method } : {}),
        ...(request.body === undefined ? {} : { body: request.body }),
        signal: AbortSignal.any([boundSignal, request.signal]),
      }),
    bounds.stallTimeoutMs,
    bounds.label,
  );
  const bytes = await drainBodyBounded(response, bounds);
  if (request.signal.aborted) throw abortError();
  return Object.freeze({
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
    bytes,
  });
}

function requestBodyViaXhr(
  request: BoundedBodyRequest,
  bounds: Readonly<{ stallTimeoutMs: number; maxBytes: number; label: string }>,
): Promise<BoundedBodyResult> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let headersSeen = false;
    let lastLoaded = 0;
    let progressSeen = false;
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const cleanup = () => {
      clearTimeout(timer);
      request.signal.removeEventListener('abort', onExternalAbort);
      xhr.onabort = null;
      xhr.onerror = null;
      xhr.onload = null;
      xhr.onprogress = null;
      xhr.onreadystatechange = null;
      xhr.ontimeout = null;
    };
    const rejectOnce = (error: unknown, abortNative = false) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (abortNative) {
        try {
          xhr.abort();
        } catch {
          // Original terminal failure owns the rejection.
        }
      }
      reject(error);
    };
    const resolveOnce = (result: BoundedBodyResult) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(Object.freeze(result));
    };
    const armTimer = (phase: 'headers' | 'body progress') => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        rejectOnce(new Error(`${bounds.label}: no ${phase} for ${bounds.stallTimeoutMs}ms`), true);
      }, bounds.stallTimeoutMs);
    };
    function onExternalAbort() {
      rejectOnce(abortError(), true);
    }

    xhr.onreadystatechange = () => {
      if (settled || headersSeen || xhr.readyState < 2) return;
      headersSeen = true;
      armTimer('body progress');
    };
    xhr.onprogress = (event) => {
      if (settled) return;
      const loaded = event.loaded;
      if (!Number.isSafeInteger(loaded) || loaded < 0) {
        rejectOnce(new Error(`${bounds.label}: progress.loaded must be a safe integer`), true);
        return;
      }
      if (loaded < lastLoaded) {
        rejectOnce(new Error(`${bounds.label}: progress.loaded must be monotonic`), true);
        return;
      }
      if (loaded > bounds.maxBytes) {
        rejectOnce(new Error(`${bounds.label}: body exceeded ${bounds.maxBytes} bytes`), true);
        return;
      }
      if (loaded === lastLoaded) return;
      progressSeen = true;
      lastLoaded = loaded;
      if (headersSeen) armTimer('body progress');
    };
    xhr.onload = () => {
      if (settled) return;
      if (!(xhr.response instanceof ArrayBuffer)) {
        rejectOnce(new TypeError(`${bounds.label}: XHR did not return an ArrayBuffer`));
        return;
      }
      const bytes = new Uint8Array(xhr.response).slice();
      if (bytes.byteLength > bounds.maxBytes) {
        rejectOnce(new Error(`${bounds.label}: body exceeded ${bounds.maxBytes} bytes`));
        return;
      }
      if (progressSeen && bytes.byteLength !== lastLoaded) {
        rejectOnce(
          new Error(
            `${bounds.label}: final body bytes ${bytes.byteLength} mismatch progress.loaded ${lastLoaded}`,
          ),
        );
        return;
      }
      let headers: Headers;
      try {
        headers = responseHeaders(xhr.getAllResponseHeaders());
      } catch (error) {
        rejectOnce(error);
        return;
      }
      resolveOnce({ status: xhr.status, statusText: xhr.statusText, headers, bytes });
    };
    xhr.onerror = () => rejectOnce(new Error(`${bounds.label}: network error`));
    xhr.onabort = () => rejectOnce(abortError());
    xhr.ontimeout = () => rejectOnce(new Error(`${bounds.label}: native request timed out`));

    request.signal.addEventListener('abort', onExternalAbort, { once: true });
    try {
      xhr.open(request.method, request.url);
      xhr.responseType = 'arraybuffer';
      armTimer('headers');
      xhr.send(request.body ?? null);
    } catch (error) {
      rejectOnce(error, true);
    }
  });
}

/** Full-response request with one no-progress/cap owner and a native browser terminal. */
export function requestBodyBounded(
  request: BoundedBodyRequest,
  bounds: BodyBounds = {},
  fetchImpl?: typeof fetch,
): Promise<BoundedBodyResult> {
  if (request === null || typeof request !== 'object') {
    return Promise.reject(new TypeError('bounded body request must be an object'));
  }
  if (typeof request.url !== 'string' || request.url.length === 0) {
    return Promise.reject(new TypeError('bounded body request URL must be non-empty'));
  }
  if (request.method !== 'GET' && request.method !== 'POST') {
    return Promise.reject(new TypeError('bounded body request method must be GET or POST'));
  }
  if (request.body !== undefined && typeof request.body !== 'string') {
    return Promise.reject(new TypeError('bounded body request body must be a string'));
  }
  if (!(request.signal instanceof AbortSignal)) {
    return Promise.reject(new TypeError('bounded body request signal is invalid'));
  }
  if (request.signal.aborted) return Promise.reject(abortError());
  let normalized: Readonly<{ stallTimeoutMs: number; maxBytes: number; label: string }>;
  try {
    normalized = Object.freeze({
      stallTimeoutMs: positiveBound(
        bounds.stallTimeoutMs,
        DEFAULT_FETCH_STALL_MS,
        'stallTimeoutMs',
      ),
      maxBytes: positiveBound(bounds.maxBytes, DEFAULT_FETCH_MAX_BYTES, 'maxBytes'),
      label: bounds.label ?? 'fetch',
    });
  } catch (error) {
    return Promise.reject(error);
  }
  if (fetchImpl !== undefined && typeof fetchImpl !== 'function') {
    return Promise.reject(new TypeError('bounded body fetch implementation must be a function'));
  }
  if (fetchImpl !== undefined) return requestBodyViaFetch(request, normalized, fetchImpl);
  if (typeof XMLHttpRequest === 'function') return requestBodyViaXhr(request, normalized);
  return requestBodyViaFetch(request, normalized, globalThis.fetch.bind(globalThis));
}

/**
 * Discard a response body the caller will never consume (non-OK statuses read
 * for `.status` only). An unread body holds its h2 stream open — piled across
 * a retry ladder or the eddy attempt pipeline they stall the one coalesced
 * connection per origin (the measured stalled-stream class). Fire-and-forget;
 * a body-less or already-consumed response is a no-op.
 */
export function discardBody(response: Response): void {
  void response.body?.cancel().catch(() => {});
}

/**
 * Bound the HEADER phase of one fetch attempt: body bounds only start once a
 * body exists — a fetch whose connection/headers hang would otherwise park
 * the caller before any body bound could run. Rejects (and aborts the fetch)
 * on timeout even if the underlying fetch ignores the signal.
 */
export async function fetchHeadersBounded(
  run: (signal: AbortSignal) => Promise<Response>,
  stallMs: number,
  label: string,
): Promise<Response> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const attempt = run(controller.signal);
  attempt.catch(() => {}); // a raced-out attempt settles later (abort) — never unhandled
  try {
    return await Promise.race([
      attempt,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error(`${label}: no response headers for ${stallMs}ms`));
        }, stallMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Buffer a whole response body under a no-progress + byte bound. A
 * never-ending or runaway body must REJECT, never park the consumer forever:
 * an unbounded `arrayBuffer()`/`json()` once hung `npm install` with no error
 * when the resolver held the connection open. A `content-type:
 * application/json` decline body is equally proxy/attacker-controlled, so it
 * is drained here too. Returns the concatenated bytes.
 */
export async function drainBodyBounded(
  response: Response,
  bounds: BodyBounds = {},
): Promise<Uint8Array<ArrayBuffer>> {
  const stallMs = bounds.stallTimeoutMs ?? DEFAULT_FETCH_STALL_MS;
  const maxBytes = bounds.maxBytes ?? DEFAULT_FETCH_MAX_BYTES;
  const label = bounds.label ?? 'fetch';
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
            () => reject(new Error(`${label}: no body progress for ${stallMs}ms`)),
            stallMs,
          );
        }),
      ]).finally(() => clearTimeout(timer));
      if (next.done) break;
      total += next.value.length;
      if (total > maxBytes) {
        throw new Error(`${label}: body exceeded ${maxBytes} bytes`);
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
