/**
 * gzip + tar extractor. We don't bring in pako/tar-stream — the input shape is
 * narrow (npm tarballs are well-behaved) and a minimal extractor is ~150 lines.
 *
 * Uses the host's `DecompressionStream('gzip')` when available (browser, Node 18+).
 *
 * Type-flags handled:
 *   - `'0'` / `''` — regular file.
 *   - `'5'` — directory (skipped at extract time).
 *   - `'2'` — symlink — throws {@link NotImplementedError} (`npm-client.tar.symlink`).
 *     M9 doesn't support symlinks in the VFS; we'd rather break loudly with the
 *     offending package name in the trace than silently lose links.
 *   - `'L'` — GNU long-name marker: the body of this entry is the long filename
 *     (NUL-terminated) for the NEXT entry. Required for npm tarballs with paths
 *     longer than the 100-byte `name` field.
 *   - `'K'` — GNU long-linkname marker: same idea but for `linkname`. Since we
 *     reject symlinks anyway, we only need to skip the metadata entry cleanly.
 *
 * Anything else maps to `'other'` and is filtered out of the file map.
 */
import { NotImplementedError } from '@riftydev/io';

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
  // Pending GNU long-name override applied to the next normal entry.
  let pendingLongName: string | null = null;
  while (offset + 512 <= bytes.length) {
    const header = bytes.subarray(offset, offset + 512);
    // End of archive: zero block.
    if (header.every((b) => b === 0)) break;
    const headerName = readString(header, 0, 100, dec).replace(/\/$/, '');
    const typeFlag = String.fromCharCode(header[156] ?? 0);
    const size = parseOctal(header, 124, 12);
    let prefix = readString(header, 345, 155, dec);
    if (prefix) prefix = `${prefix}/`;
    const dataStart = offset + 512;
    const data = bytes.subarray(dataStart, dataStart + size);
    const nextOffset = dataStart + Math.ceil(size / 512) * 512;

    if (typeFlag === 'L') {
      // GNU long path: body is the NUL-terminated long name for the next entry.
      pendingLongName = dec.decode(data).replace(/\0+$/, '');
      offset = nextOffset;
      continue;
    }
    if (typeFlag === 'K') {
      // GNU long linkname: irrelevant once we reject symlinks; drop without surfacing as a file.
      offset = nextOffset;
      continue;
    }
    if (typeFlag === '2') {
      // Bail loudly so the user knows which package tripped the missing feature. See file-level doc.
      throw new NotImplementedError(
        'npm-client.tar.symlink',
        `tar symlinks not supported until M12 (entry: ${pendingLongName ?? `${prefix}${headerName}`})`,
      );
    }

    const fullName = pendingLongName ?? `${prefix}${headerName}`;
    pendingLongName = null;
    const type: TarEntry['type'] =
      typeFlag === '5' ? 'dir' : typeFlag === '0' || typeFlag === '' ? 'file' : 'other';
    out.push({ name: fullName, type, data });
    offset = nextOffset;
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
