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

import { parseTarHeader } from './unpacker.ts';

const dec = new TextDecoder('utf-8');

export async function* streamTarEntries(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<{ name: string; data: Uint8Array }, void, undefined> {
  const reader = stream.getReader();
  // Unconsumed chunks in arrival order; `available` = total buffered bytes.
  const pending: Uint8Array[] = [];
  let available = 0;
  let sourceDone = false;

  async function ensure(n: number): Promise<boolean> {
    while (available < n && !sourceDone) {
      const r = await reader.read();
      if (r.done) sourceDone = true;
      else if (r.value.length > 0) {
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
      if (header.every((b) => b === 0)) return; // end-of-archive zero block
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
    // Runs on completion AND on early consumer abort — cancel is a no-op on an
    // exhausted stream, and stops the underlying download otherwise.
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
