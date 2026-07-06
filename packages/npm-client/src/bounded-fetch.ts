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
