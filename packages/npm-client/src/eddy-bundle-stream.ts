/**
 * Incremental reader for the OUTER `EddyBundleV1` store tar: yields regular-file
 * members AS THEY ARRIVE, so the client can gate on the manifest/lockfile and
 * verify + seed tarballs while the bundle is still downloading (network overlaps
 * hash + cache writes instead of buffering the whole response first).
 *
 * The outer container is rifty's own writer (`packEddyBundle`): members are
 * `manifest → lockfile → tarballs/*`, GNU `L` entries carry >100-byte paths,
 * symlinks/dirs never occur — non-file typeflags are skipped, matching
 * `parseTarEntries`. An early consumer abort (`gen.return()`, e.g. a lockfile
 * gate decline) cancels the source stream so the download stops.
 */

import { DEFAULT_FETCH_MAX_BYTES, DEFAULT_FETCH_STALL_MS } from './bounded-fetch.ts';
import { parseTarHeader } from './unpacker.ts';

// Historical eddy-scoped names; the implementation is the shared
// bounded-fetch chokepoint (one `unbounded-read` boundary for npm-client).
export {
  DEFAULT_FETCH_MAX_BYTES as DEFAULT_BUNDLE_MAX_BYTES,
  DEFAULT_FETCH_STALL_MS as DEFAULT_BUNDLE_STALL_MS,
  drainBodyBounded,
} from './bounded-fetch.ts';

const dec = new TextDecoder('utf-8');

export interface StreamTarEntriesBounds {
  /** No-progress bound (ms): a body chunk must arrive within this window or
   * the stream THROWS (→ the eddy attempt pipeline falls through). A server
   * that stalls mid-tarball must never park `npm install` forever. */
  stallTimeoutMs?: number;
  /** Total received-byte cap; exceeding it throws. */
  maxBytes?: number;
}

export async function* streamTarEntries(
  stream: ReadableStream<Uint8Array>,
  bounds: StreamTarEntriesBounds = {},
): AsyncGenerator<{ name: string; data: Uint8Array }, void, undefined> {
  const stallMs = bounds.stallTimeoutMs ?? DEFAULT_FETCH_STALL_MS;
  const maxBytes = bounds.maxBytes ?? DEFAULT_FETCH_MAX_BYTES;
  const reader = stream.getReader();
  // Unconsumed chunks in arrival order; `available` = total buffered bytes.
  const pending: Uint8Array[] = [];
  let available = 0;
  let received = 0;
  let sourceDone = false;

  async function ensure(n: number): Promise<boolean> {
    while (available < n && !sourceDone) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const read = reader.read();
      // A raced-out read settles later (the finally-block cancel resolves it);
      // never let a late rejection surface as unhandled.
      read.catch(() => {});
      const r = await Promise.race([
        read,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`eddy bundle: no body progress for ${stallMs}ms`)),
            stallMs,
          );
        }),
      ]).finally(() => clearTimeout(timer));
      if (r.done) sourceDone = true;
      else if (r.value.length > 0) {
        received += r.value.length;
        if (received > maxBytes) {
          throw new Error(`eddy bundle: body exceeded ${maxBytes} bytes`);
        }
        pending.push(r.value);
        available += r.value.length;
      }
    }
    return available >= n;
  }

  /** Pop exactly `n` buffered bytes (caller guarantees `available >= n`). */
  function take(n: number): Uint8Array {
    const out = new Uint8Array(n);
    let filled = 0;
    while (filled < n) {
      const head = pending[0] as Uint8Array;
      const need = n - filled;
      if (head.length <= need) {
        out.set(head, filled);
        filled += head.length;
        pending.shift();
      } else {
        out.set(head.subarray(0, need), filled);
        pending[0] = head.subarray(need);
        filled = n;
      }
    }
    available -= n;
    return out;
  }

  /** Read the (tiny) tail past the end-of-archive marker to true EOF. A
   * successful bundle GET must be consumed COMPLETELY: cancelling with bytes
   * left on the wire makes the browser discard the response from its HTTP
   * cache — which would defeat the whole immutable `GET /bundle/<hash>` tier
   * (the pinned/learned GET is fast BECAUSE the cache holds it). Still
   * bounded: the stall timeout + byte cap above keep applying. */
  async function drainToEof(): Promise<void> {
    while (!sourceDone) {
      // 512 always exceeds the leftover of a sane terminator, so each call
      // makes progress; the bounds throw on a pathological endless tail.
      await ensure(available + 512);
    }
  }

  try {
    let pendingLongName: string | null = null;
    for (;;) {
      if (!(await ensure(512))) {
        // Clean EOF at an entry boundary (writer omitted the terminator) is
        // tolerated, matching the buffered parser; anything else is torn bytes.
        if (available === 0) return;
        throw new Error('truncated eddy bundle tar stream');
      }
      const header = take(512);
      if (header.every((b) => b === 0)) {
        // End-of-archive zero block: consume the remainder (second zero block
        // + any trailing padding) so the response ends at TRUE EOF and the
        // browser commits it to the HTTP cache.
        await drainToEof();
        return;
      }
      const { name, typeflag, size } = parseTarHeader(header);
      const padded = Math.ceil(size / 512) * 512;
      if (!(await ensure(padded))) throw new Error('truncated eddy bundle tar stream');
      const data = take(size);
      if (padded > size) take(padded - size); // discard block padding
      if (typeflag === 'L') {
        pendingLongName = dec.decode(data).replace(/\0+$/, '');
        continue;
      }
      const fullName = pendingLongName ?? name;
      pendingLongName = null;
      if (typeflag === '0' || typeflag === '') yield { name: fullName, data };
    }
  } finally {
    // Runs on completion AND on early consumer abort. After a clean drain the
    // stream is exhausted and cancel is a spec no-op (the cache keeps the
    // response); on an early abort (gate decline / bound violation) it stops
    // the underlying download.
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
