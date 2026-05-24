/**
 * gzip + tar extractor. We don't bring in pako/tar-stream — the input shape is
 * narrow (npm tarballs are well-behaved) and a minimal extractor is ~120 lines.
 *
 * Uses the host's `DecompressionStream('gzip')` when available (browser, Node 18+).
 */

interface TarEntry {
  name: string;
  type: 'file' | 'dir' | 'other';
  data: Uint8Array;
}

async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'function') {
    const stream = new Blob([bytes as unknown as BlobPart])
      .stream()
      .pipeThrough(new DecompressionStream('gzip'));
    const ab = await new Response(stream).arrayBuffer();
    return new Uint8Array(ab);
  }
  throw new Error('No gzip support in this environment (need DecompressionStream)');
}

function parseTar(bytes: Uint8Array): TarEntry[] {
  const dec = new TextDecoder('utf-8');
  const out: TarEntry[] = [];
  let offset = 0;
  while (offset + 512 <= bytes.length) {
    const header = bytes.subarray(offset, offset + 512);
    // End of archive: two consecutive zero blocks.
    if (header.every((b) => b === 0)) break;
    const name = readString(header, 0, 100, dec).replace(/\/$/, '');
    const typeFlag = String.fromCharCode(header[156] ?? 0);
    const size = parseOctal(header, 124, 12);
    let prefix = readString(header, 345, 155, dec);
    if (prefix) prefix = `${prefix}/`;
    const fullName = `${prefix}${name}`;
    const dataStart = offset + 512;
    const data = bytes.subarray(dataStart, dataStart + size);
    const type: TarEntry['type'] =
      typeFlag === '5' ? 'dir' : typeFlag === '0' || typeFlag === '' ? 'file' : 'other';
    out.push({ name: fullName, type, data });
    // Round up to next 512-byte block.
    offset = dataStart + Math.ceil(size / 512) * 512;
  }
  return out;
}

function readString(buf: Uint8Array, off: number, len: number, dec: TextDecoder): string {
  const slice = buf.subarray(off, off + len);
  let end = 0;
  while (end < slice.length && slice[end] !== 0) end++;
  return dec.decode(slice.subarray(0, end));
}

function parseOctal(buf: Uint8Array, off: number, len: number): number {
  // npm tarballs use ASCII octal padded with spaces or zeros.
  let s = '';
  for (let i = 0; i < len; i++) {
    const c = buf[off + i];
    if (c === undefined || c === 0 || c === 0x20) break;
    s += String.fromCharCode(c);
  }
  return s ? Number.parseInt(s, 8) : 0;
}

/**
 * Extract a `.tgz` payload into a flat map of paths → bytes.
 *
 * The npm convention is for tarballs to put everything under `package/...`;
 * we strip that prefix.
 */
export async function extractTarGz(tgz: Uint8Array): Promise<Record<string, Uint8Array>> {
  const tar = await gunzip(tgz);
  const entries = parseTar(tar);
  const out: Record<string, Uint8Array> = {};
  for (const e of entries) {
    if (e.type !== 'file') continue;
    const stripped = e.name.startsWith('package/') ? e.name.slice('package/'.length) : e.name;
    if (!stripped) continue;
    out[stripped] = e.data;
  }
  return out;
}
