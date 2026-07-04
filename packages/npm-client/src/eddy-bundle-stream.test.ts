import { describe, expect, it } from 'vitest';
import { streamTarEntries } from './eddy-bundle-stream.ts';
import { EDDY_BUNDLE_FORMAT, type EddyBundleContents, packEddyBundle } from './eddy-bundle.ts';
import { parseTarEntries } from './unpacker.ts';

const enc = new TextEncoder();

/** A realistic bundle: manifest + lockfile + two tarballs, one with a >100-byte
 * member path (forces a GNU `L` long-name entry). */
function buildBundle(): { bytes: Uint8Array; contents: EddyBundleContents } {
  const longName = `tarballs/${'a'.repeat(120)}-1.0.0.tgz`;
  const contents: EddyBundleContents = {
    manifest: {
      format: EDDY_BUNDLE_FORMAT,
      npmClientVersion: '0.0.0-test',
      asOf: { resolvedAt: '2026-07-01T00:00:00Z', registry: 'http://r', closureHash: 'sha256-x' },
      tarballs: [
        {
          file: 'tarballs/debug-4.4.1.tgz',
          name: 'debug',
          version: '4.4.1',
          integrity: 'sha512-a',
        },
        { file: longName, name: 'a'.repeat(120), version: '1.0.0', integrity: 'sha512-b' },
      ],
    },
    lockfileText: JSON.stringify({ lockfileVersion: 3, packages: {} }),
    tarballs: [
      {
        entry: {
          file: 'tarballs/debug-4.4.1.tgz',
          name: 'debug',
          version: '4.4.1',
          integrity: 'sha512-a',
        },
        bytes: new Uint8Array(1234).fill(7),
      },
      {
        entry: { file: longName, name: 'a'.repeat(120), version: '1.0.0', integrity: 'sha512-b' },
        bytes: enc.encode('gzip-bytes-pretend'),
      },
    ],
  };
  return { bytes: packEddyBundle(contents), contents };
}

function chunked(bytes: Uint8Array, size: number): ReadableStream<Uint8Array> {
  let off = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (off >= bytes.length) {
        controller.close();
        return;
      }
      controller.enqueue(bytes.slice(off, Math.min(off + size, bytes.length)));
      off += size;
    },
  });
}

async function collect(
  stream: ReadableStream<Uint8Array>,
): Promise<Array<{ name: string; data: Uint8Array }>> {
  const out: Array<{ name: string; data: Uint8Array }> = [];
  for await (const e of streamTarEntries(stream)) out.push(e);
  return out;
}

describe('streamTarEntries — incremental EddyBundleV1 outer-tar reader', () => {
  it('yields the same entries as the buffered parser across arbitrary chunk boundaries', async () => {
    const { bytes } = buildBundle();
    const reference = parseTarEntries(bytes);
    expect(reference.length).toBe(4); // manifest + lockfile + 2 tarballs
    for (const size of [1, 7, 512, 4096, bytes.length]) {
      const got = await collect(chunked(bytes, size));
      expect(got.map((e) => e.name)).toEqual(reference.map((e) => e.name));
      for (let i = 0; i < reference.length; i++) {
        expect([...(got[i] as { data: Uint8Array }).data]).toEqual([
          ...(reference[i] as { data: Uint8Array }).data,
        ]);
      }
    }
  });

  it('carries GNU long names (>100-byte member paths)', async () => {
    const { bytes } = buildBundle();
    const got = await collect(chunked(bytes, 64));
    expect(got.some((e) => e.name === `tarballs/${'a'.repeat(120)}-1.0.0.tgz`)).toBe(true);
  });

  it('ignores trailing garbage after the end-of-archive terminator', async () => {
    const { bytes } = buildBundle();
    const withGarbage = new Uint8Array(bytes.length + 999);
    withGarbage.set(bytes);
    withGarbage.fill(0xab, bytes.length);
    const got = await collect(chunked(withGarbage, 4096));
    expect(got.length).toBe(4);
  });

  it('throws on a stream truncated mid-member', async () => {
    const { bytes } = buildBundle();
    const truncated = bytes.slice(0, bytes.length - 1200); // inside the last member/padding
    await expect(collect(chunked(truncated, 512))).rejects.toThrow(/truncated/);
  });

  it('yields the first member before later chunks arrive (genuinely incremental)', async () => {
    const { bytes } = buildBundle();
    // First member = manifest: 512-byte header + padded JSON body.
    const manifestSize = parseTarEntries(bytes)[0]?.data.length ?? 0;
    const boundary = 512 + Math.ceil(manifestSize / 512) * 512;
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        controller = c;
      },
    });
    controller.enqueue(bytes.slice(0, boundary));
    const gen = streamTarEntries(stream);
    const first = await gen.next(); // must resolve WITHOUT the rest of the bytes
    expect(first.done).toBe(false);
    expect((first.value as { name: string }).name).toBe('eddy-bundle.json');
    controller.enqueue(bytes.slice(boundary));
    controller.close();
    const rest: string[] = [];
    for await (const e of gen) rest.push(e.name);
    expect(rest.length).toBe(3);
  });

  it('a NEVER-ENDING stream throws after the no-progress bound instead of parking the consumer', async () => {
    // Regression (round 6): the direct GET/POST paths stream through this
    // reader; a resolver that sent a covering manifest+lockfile then hung
    // mid-tarball parked `npm install` forever — no error, no fallback.
    const { bytes } = buildBundle();
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        // Manifest + lockfile + a partial tarball, then silence (never close).
        controller.enqueue(bytes.slice(0, 2048 + 100));
      },
      cancel() {
        cancelled = true;
      },
    });
    const consume = async () => {
      for await (const _ of streamTarEntries(stream, { stallTimeoutMs: 25 })) {
        // drain
      }
    };
    await expect(consume()).rejects.toThrow(/no body progress for 25ms/);
    expect(cancelled).toBe(true); // the dead stream was released, not leaked
  });

  it('an OVER-CAP body throws (a forged giant tar header must not buffer unbounded)', async () => {
    // A header claiming a ~8GB member would make `ensure(padded)` buffer the
    // whole body; the byte cap has to cut it off.
    const header = new Uint8Array(512);
    header.set(enc.encode('big.bin'), 0); // name
    header.set(enc.encode('77777777777'), 124); // size (octal) ≈ 8GB
    header[156] = '0'.charCodeAt(0); // regular file
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(header);
      },
      pull(controller) {
        controller.enqueue(new Uint8Array(1024).fill(0xab));
      },
    });
    const consume = async () => {
      for await (const _ of streamTarEntries(stream, { maxBytes: 4096 })) {
        // drain
      }
    };
    await expect(consume()).rejects.toThrow(/exceeded 4096 bytes/);
  });

  it('early generator return cancels the source stream (stops the download)', async () => {
    const { bytes } = buildBundle();
    let cancelled = false;
    let off = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(bytes.slice(off, Math.min(off + 512, bytes.length)));
        off += 512;
        if (off >= bytes.length) controller.close();
      },
      cancel() {
        cancelled = true;
      },
    });
    const gen = streamTarEntries(stream);
    await gen.next(); // manifest
    await gen.return(undefined); // consumer aborts (e.g. lockfile gate declined)
    expect(cancelled).toBe(true);
  });
});
