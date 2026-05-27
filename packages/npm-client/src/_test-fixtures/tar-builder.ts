/**
 * Test-only tar fixture helpers.
 *
 * Several npm-client tests (`installer.test`, `installer-lockfile.test`,
 * `installer-peer-optional.test`, `installer-pipeline.test`, `unpacker.test`)
 * need to fabricate minimal POSIX `ustar` tar archives — typically a single
 * `package/package.json` entry — without pulling a dependency. Each test file
 * grew its own near-identical ~50-line helper; this module consolidates them.
 *
 * Naming: the `_test-fixtures/` prefix marks this as test-only. Do **not**
 * re-export from `src/index.ts` — production code paths must never reach for
 * these helpers.
 */
const enc = new TextEncoder();

/** Two zero blocks marking end-of-archive per the tar spec. */
export const TAR_TRAILER: Uint8Array = new Uint8Array(1024);

/**
 * Write `str` (UTF-8, truncated to `len` bytes) into `buf` at offset `off`.
 * Internal because only the helpers below need it; tests building exotic
 * headers should go through `buildHeader` rather than reaching past it.
 */
function writeStr(buf: Uint8Array, str: string, off: number, len: number): void {
  const bytes = enc.encode(str);
  buf.set(bytes.subarray(0, Math.min(bytes.length, len)), off);
}

/**
 * Build a single 512-byte tar header.
 *
 * @param name      tar entry name, e.g. `package/package.json`.
 * @param size      data length in bytes (the caller pads the body itself).
 * @param typeFlag  single ASCII char per the tar spec. Defaults to `'0'`
 *                  (regular file). Use `'2'` for symlinks, `'L'` / `'K'` for
 *                  GNU long-name / long-linkname extension headers.
 * @param opts.linkname  written into the linkname field at offset 157
 *                       (used for symlink headers).
 * @param opts.ustar     emit the `ustar\000` magic at offset 257. Defaults to
 *                       `true`; pass `false` only when testing pre-ustar
 *                       behaviour.
 */
export function buildHeader(
  name: string,
  size: number,
  typeFlag = '0',
  opts: { linkname?: string; ustar?: boolean } = {},
): Uint8Array {
  const h = new Uint8Array(512);
  writeStr(h, name, 0, 100);
  writeStr(h, '0000644', 100, 7); // mode
  writeStr(h, '0000000', 108, 7); // uid
  writeStr(h, '0000000', 116, 7); // gid
  // size: 11 octal digits + space terminator
  writeStr(h, size.toString(8).padStart(11, '0'), 124, 11);
  h[135] = 0x20;
  writeStr(h, '00000000000', 136, 11); // mtime
  h[147] = 0x20;
  // checksum placeholder — 8 spaces, replaced below once we know the sum
  for (let i = 148; i < 156; i++) h[i] = 0x20;
  h[156] = typeFlag.charCodeAt(0); // typeflag
  if (opts.linkname) writeStr(h, opts.linkname, 157, 100);
  if (opts.ustar !== false) {
    writeStr(h, 'ustar', 257, 6);
    writeStr(h, '00', 263, 2);
  }
  // Now compute the real checksum.
  let sum = 0;
  for (let i = 0; i < 512; i++) sum += h[i] ?? 0;
  writeStr(h, sum.toString(8).padStart(6, '0'), 148, 6);
  h[154] = 0x00;
  h[155] = 0x20;
  return h;
}

/** Concatenate a series of `Uint8Array`s into a single buffer. */
export function concat(...parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

/** Pad `data` up to the next 512-byte boundary, returning a fresh buffer. */
export function padToBlock(data: Uint8Array): Uint8Array {
  const blocks = Math.ceil(data.length / 512);
  const padded = new Uint8Array(blocks * 512);
  padded.set(data);
  return padded;
}

/** Gzip-compress `bytes` using the platform `CompressionStream`. */
export async function gzip(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as unknown as BlobPart])
    .stream()
    .pipeThrough(new CompressionStream('gzip'));
  const ab = await new Response(stream).arrayBuffer();
  return new Uint8Array(ab);
}

/**
 * Build a gzipped tar containing a single `package/package.json` regular-file
 * entry whose body is `JSON.stringify({ name, version })`.
 *
 * This is the bytes-on-the-wire form a registry would serve for a one-file
 * stub package, and is the canonical fixture the installer tests use to
 * simulate publishes.
 */
export async function makePackageTarball(name: string, version: string): Promise<Uint8Array> {
  const manifestBytes = enc.encode(JSON.stringify({ name, version }));
  const header = buildHeader('package/package.json', manifestBytes.length);
  const tar = concat(header, padToBlock(manifestBytes), TAR_TRAILER);
  return await gzip(tar);
}
