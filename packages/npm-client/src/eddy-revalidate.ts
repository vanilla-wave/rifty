/**
 * Ask eddy what closure a request resolves to WITHOUT downloading the bundle:
 * a plain POST resolve (no wire-protocol change) whose body is read only up
 * to the manifest — the first tar member by bundle contract — then cancelled.
 * Powers the learned-pin background revalidate (backlog
 * playground/eddy-stale-pin-revalidate): hash compare only, no extraction.
 * Bounded on every phase via the shared chokepoint (ADR-0201): header wait,
 * decline-body drain, body no-progress + byte cap.
 *
 * Throws on ANY failure (typed decline, HTTP error, stall, malformed
 * manifest) — the caller keeps its pin and warns; nothing here is
 * load-bearing for the install itself.
 */

import { discardBody, fetchHeadersBounded } from './bounded-fetch.ts';
import {
  DEFAULT_BUNDLE_STALL_MS,
  drainBodyBounded,
  streamTarEntries,
} from './eddy-bundle-stream.ts';
import { EDDY_BUNDLE_FORMAT, type EddyBundleManifestV1, MANIFEST_FILE } from './eddy-bundle.ts';
import type { EddyRequestBody } from './eddy-request.ts';

export interface ResolveEddyClosureOptions {
  resolverUrl: string;
  request: EddyRequestBody;
  /** Injectable fetch (tests); defaults to the global. */
  fetchImpl?: typeof fetch;
  /** No-progress bound (ms) for the header phase AND the body stream
   * (default {@link DEFAULT_BUNDLE_STALL_MS}). */
  stallTimeoutMs?: number;
}

/** The served resolution's identity: content address + honesty stamp. */
export interface EddyClosureSummary {
  closureHash: string;
  /** ISO-8601 `asOf.resolvedAt` — when eddy resolved this closure. */
  resolvedAt: string;
}

const dec = new TextDecoder('utf-8');

export async function resolveEddyClosure(
  opts: ResolveEddyClosureOptions,
): Promise<EddyClosureSummary> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const stallMs = opts.stallTimeoutMs ?? DEFAULT_BUNDLE_STALL_MS;
  // The installer's CORS-simple POST shape: a string body with no content-type
  // header skips the cross-origin OPTIONS preflight; the server parses the
  // body unconditionally.
  const response = await fetchHeadersBounded(
    (signal) =>
      fetchImpl(opts.resolverUrl, { method: 'POST', body: JSON.stringify(opts.request), signal }),
    stallMs,
    'eddy revalidate',
  );
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    // Typed decline (422 + JSON). Bounded drain — `response.json()` has no
    // timeout, a held-open decline body would park the revalidate forever.
    const bytes = await drainBodyBounded(response, {
      stallTimeoutMs: stallMs,
      label: 'eddy revalidate decline body',
    });
    let decline: { feature?: string; error?: string } | null;
    try {
      decline = JSON.parse(dec.decode(bytes)) as { feature?: string; error?: string };
    } catch {
      decline = null;
    }
    throw new Error(`resolver declined (${decline?.feature ?? decline?.error ?? 'unsupported'})`);
  }
  if (!response.ok) {
    discardBody(response);
    throw new Error(`resolver returned HTTP ${response.status}`);
  }
  if (!response.body) throw new Error('resolver returned no body');
  for await (const entry of streamTarEntries(response.body, { stallTimeoutMs: stallMs })) {
    if (entry.name !== MANIFEST_FILE) {
      throw new Error(`bundle does not start with ${MANIFEST_FILE}`);
    }
    const parsed = JSON.parse(dec.decode(entry.data)) as EddyBundleManifestV1;
    if (parsed.format !== EDDY_BUNDLE_FORMAT) {
      throw new Error(`unsupported EddyBundle format: ${JSON.stringify(parsed.format)}`);
    }
    const closureHash = parsed.asOf?.closureHash;
    const resolvedAt = parsed.asOf?.resolvedAt;
    if (
      typeof closureHash !== 'string' ||
      closureHash.length === 0 ||
      typeof resolvedAt !== 'string'
    ) {
      throw new Error('malformed EddyBundleV1 manifest: missing asOf.closureHash/resolvedAt');
    }
    // Returning from inside for-await runs the generator's finally block —
    // the source stream is CANCELLED, so the tarball tail never downloads.
    return { closureHash, resolvedAt };
  }
  throw new Error('malformed EddyBundleV1 bundle: empty tar stream');
}
