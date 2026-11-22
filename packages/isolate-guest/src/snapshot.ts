/**
 * Guest FS snapshot, format v1 (ADR-0567): a rifty FS ⇄ one opaque byte string.
 * Pure JS — `Uint8Array`, `DataView`, `Map`, `Set`, `String.fromCharCode`
 * only — so the same module runs in the bare isolate (bundled into
 * `guest.js`) and in the consumer's Node realm. The reader trusts nothing the
 * writer promises: a snapshot taken after guest code ran comes from the
 * guest's realm.
 */

/** The template a snapshot belongs to (ADR-0567 §4). */
export interface SnapshotTemplate {
  readonly id: string;
  readonly version: string;
}

export interface SnapshotOptions {
  /** Recorded at snapshot; restore requires the same (both `null`, or equal strings). */
  readonly template: SnapshotTemplate | null;
  /** Largest blob, in bytes, either direction accepts. */
  readonly maxBytes: number;
}

export type FsSnapshotErrorCode =
  | 'ERR_FS_SNAPSHOT_TOO_LARGE'
  | 'ERR_FS_SNAPSHOT_CORRUPT'
  | 'ERR_FS_SNAPSHOT_VERSION'
  | 'ERR_FS_SNAPSHOT_TEMPLATE'
  | 'ERR_FS_SNAPSHOT_NOT_FRESH';

/** A refused snapshot or restore. `message` = `<code>: <fixed text>`; never carries blob bytes. */
export class FsSnapshotError extends Error {
  readonly code: FsSnapshotErrorCode;
  constructor(code: FsSnapshotErrorCode, detail: string) {
    super(`${code}: ${detail}`);
    this.name = 'FsSnapshotError';
    this.code = code;
  }
}

/** The times of an entry, restored verbatim (`ino` is renewed, ADR-0567 §1). */
export interface SnapshotStat {
  readonly mtimeMs: number;
  readonly atimeMs: number;
  readonly ctimeMs: number;
  readonly birthtimeMs: number;
}

/** The rifty FS surface the codec uses; `MemoryFsSync` (`@riftydev/vfs`) implements it. */
export interface SnapshotFs {
  readdirSync(
    path: string,
  ): readonly { readonly name: string; readonly isFile: boolean; readonly isDirectory: boolean }[];
  statSync(path: string): {
    readonly isFile: boolean;
    readonly isDirectory: boolean;
    readonly mtime?: number;
    readonly atime?: number;
    readonly metadata?: {
      readonly ino: number;
      readonly birthtime: number;
      readonly ctime: number;
    };
  };
  readFileBytesSync(path: string): Uint8Array;
  writeFileSync(path: string, data: Uint8Array): void;
  mkdirSync(path: string, options: { recursive?: boolean }): void;
  rmSync(path: string, options: { recursive?: boolean; force?: boolean }): void;
  /** Set the four times of an existing entry exactly. */
  restoreStatSync(path: string, stat: SnapshotStat): void;
}

const MAGIC = [0x52, 0x49, 0x46, 0x54, 0x59, 0x46, 0x53, 0x00];
const VERSION = 1;
const DIR = 1;
const FILE = 2;
const END = 0;
/** magic + version + template flag. */
const HEADER = 13;
/** kind + path length + four f64 times. */
const RECORD = 37;
const CRC_BYTES = 4;
const MAX_TEMPLATE_UNITS = 0xffff;

// CRC-32 (ISO-HDLC, zlib's `crc32`), slicing-by-8: one 8 KiB table built at load.
const CRC_TABLE = new Uint32Array(8 * 256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c >>> 0;
}
for (let n = 0; n < 256; n++) {
  for (let t = 1; t < 8; t++) {
    const prev = CRC_TABLE[(t - 1) * 256 + n] as number;
    CRC_TABLE[t * 256 + n] = (CRC_TABLE[prev & 0xff] as number) ^ (prev >>> 8);
  }
}

function crc32(bytes: Uint8Array, end: number): number {
  const t = CRC_TABLE;
  let c = 0xffffffff;
  let i = 0;
  for (; i + 8 <= end; i += 8) {
    const a =
      c ^
      ((bytes[i] as number) |
        ((bytes[i + 1] as number) << 8) |
        ((bytes[i + 2] as number) << 16) |
        ((bytes[i + 3] as number) << 24));
    c =
      (t[1792 + (a & 0xff)] as number) ^
      (t[1536 + ((a >>> 8) & 0xff)] as number) ^
      (t[1280 + ((a >>> 16) & 0xff)] as number) ^
      (t[1024 + (a >>> 24)] as number) ^
      (t[768 + (bytes[i + 4] as number)] as number) ^
      (t[512 + (bytes[i + 5] as number)] as number) ^
      (t[256 + (bytes[i + 6] as number)] as number) ^
      (t[bytes[i + 7] as number] as number);
  }
  for (; i < end; i++) c = (t[(c ^ (bytes[i] as number)) & 0xff] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function checkOptions(options: SnapshotOptions): SnapshotOptions {
  if (typeof options !== 'object' || options === null)
    throw new TypeError('snapshot options must be an object');
  const { template, maxBytes } = options;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1)
    throw new TypeError('snapshot maxBytes must be a positive safe integer');
  if (template !== null) {
    if (typeof template !== 'object' || template === undefined)
      throw new TypeError('snapshot template must be {id, version} or null');
    for (const part of [template.id, template.version]) {
      if (typeof part !== 'string' || part.length === 0 || part.length > MAX_TEMPLATE_UNITS)
        throw new TypeError(
          'snapshot template id and version must be strings of 1..65535 code units',
        );
    }
  }
  return { template, maxBytes };
}

interface Entry {
  readonly kind: typeof DIR | typeof FILE;
  readonly path: string;
  readonly stat: SnapshotStat;
  readonly data: Uint8Array | null;
}

function timesOf(s: ReturnType<SnapshotFs['statSync']>): SnapshotStat {
  const meta = s.metadata;
  if (s.mtime === undefined || s.atime === undefined || meta === undefined)
    throw new TypeError('snapshotFs: the FS does not report entry times');
  return { mtimeMs: s.mtime, atimeMs: s.atime, ctimeMs: meta.ctime, birthtimeMs: meta.birthtime };
}

/** The whole tree of `fs` as one blob (ADR-0567 §1). Throws `ERR_FS_SNAPSHOT_TOO_LARGE` before allocating. */
export function snapshotFs(fs: SnapshotFs, options: SnapshotOptions): Uint8Array {
  const { template, maxBytes } = checkOptions(options);
  let size =
    HEADER +
    (template === null ? 0 : 4 + 2 * (template.id.length + template.version.length)) +
    1 +
    CRC_BYTES;
  const tooLarge = () =>
    new FsSnapshotError(
      'ERR_FS_SNAPSHOT_TOO_LARGE',
      `the tree needs more than maxBytes ${maxBytes}`,
    );
  const entries: Entry[] = [];
  // Pre-order, siblings in code-unit order; iterative (no recursion on depth).
  const stack: string[] = ['/'];
  while (stack.length > 0) {
    const path = stack.pop() as string;
    const s = fs.statSync(path);
    if (s.isDirectory) {
      entries.push({ kind: DIR, path, stat: timesOf(s), data: null });
      size += RECORD + 2 * path.length;
      const names = fs.readdirSync(path).map((d) => d.name);
      names.sort();
      const prefix = path === '/' ? '/' : `${path}/`;
      for (let i = names.length - 1; i >= 0; i--) stack.push(prefix + (names[i] as string));
    } else {
      const data = fs.readFileBytesSync(path);
      entries.push({ kind: FILE, path, stat: timesOf(s), data });
      size += RECORD + 2 * path.length + 8 + data.byteLength;
    }
    if (size > maxBytes) throw tooLarge();
  }
  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  out.set(MAGIC, 0);
  view.setUint32(8, VERSION, true);
  let o = 12;
  const units = (text: string) => {
    for (let i = 0; i < text.length; i++, o += 2) view.setUint16(o, text.charCodeAt(i), true);
  };
  if (template === null) out[o++] = 0;
  else {
    out[o++] = 1;
    for (const part of [template.id, template.version]) {
      view.setUint16(o, part.length, true);
      o += 2;
      units(part);
    }
  }
  for (const { kind, path, stat, data } of entries) {
    out[o++] = kind;
    view.setUint32(o, path.length, true);
    o += 4;
    units(path);
    for (const t of [stat.mtimeMs, stat.atimeMs, stat.ctimeMs, stat.birthtimeMs]) {
      view.setFloat64(o, t, true);
      o += 8;
    }
    if (data !== null) {
      view.setFloat64(o, data.byteLength, true);
      o += 8;
      out.set(data, o);
      o += data.byteLength;
    }
  }
  out[o++] = END;
  view.setUint32(o, crc32(out, o), true);
  return out;
}

const corrupt = (what: string, at: number): FsSnapshotError =>
  new FsSnapshotError('ERR_FS_SNAPSHOT_CORRUPT', `${what} at byte ${at}`);

interface Decoded {
  readonly kind: typeof DIR | typeof FILE;
  readonly path: string;
  readonly stat: SnapshotStat;
  readonly start: number;
  readonly end: number;
}

/** One linear pass over untrusted bytes; nothing an honest writer guarantees is assumed. */
function decode(bytes: Uint8Array, expected: SnapshotTemplate | null): Decoded[] {
  const length = bytes.byteLength;
  if (length < 8) throw corrupt('not a snapshot (too short)', 0);
  for (let i = 0; i < 8; i++) if (bytes[i] !== MAGIC[i]) throw corrupt('not a snapshot (magic)', i);
  if (length < 12) throw corrupt('truncated header', length);
  const view = new DataView(bytes.buffer, bytes.byteOffset, length);
  const version = view.getUint32(8, true);
  if (version !== VERSION)
    throw new FsSnapshotError(
      'ERR_FS_SNAPSHOT_VERSION',
      `format version ${version}, this reader reads version ${VERSION}`,
    );
  if (length < HEADER + 1 + CRC_BYTES) throw corrupt('truncated', length);
  const body = length - CRC_BYTES;
  if (crc32(bytes, body) !== view.getUint32(body, true)) throw corrupt('checksum mismatch', body);
  let o = 12;
  const need = (n: number) => {
    if (n > body - o) throw corrupt('truncated record', o);
  };
  const text = (units: number): string => {
    need(2 * units);
    let s = '';
    const chunk: number[] = [];
    for (let i = 0; i < units; i++, o += 2) {
      chunk.push(view.getUint16(o, true));
      if (chunk.length === 4096) {
        s += String.fromCharCode(...chunk);
        chunk.length = 0;
      }
    }
    return s + String.fromCharCode(...chunk);
  };
  const u16 = (): number => {
    need(2);
    o += 2;
    return view.getUint16(o - 2, true);
  };
  const flag = bytes[o++];
  let template: SnapshotTemplate | null = null;
  if (flag === 1) {
    const id = text(u16());
    template = { id, version: text(u16()) };
  } else if (flag !== 0) throw corrupt('bad template flag', o - 1);
  const kinds = new Map<string, number>();
  const out: Decoded[] = [];
  for (;;) {
    need(1);
    const at = o;
    const kind = bytes[o++] as number;
    if (kind === END) break;
    if (kind !== DIR && kind !== FILE) throw corrupt('unknown entry kind', at);
    need(4);
    const units = view.getUint32(o, true);
    o += 4;
    const path = text(units);
    if (out.length === 0) {
      if (path !== '/' || kind !== DIR)
        throw corrupt('the first entry is not the root directory', at);
    } else {
      if (!isCanonical(path)) throw corrupt('non-canonical path', at);
      if (kinds.has(path)) throw corrupt('duplicate path', at);
      const cut = path.lastIndexOf('/');
      if (kinds.get(cut === 0 ? '/' : path.slice(0, cut)) !== DIR)
        throw corrupt('parent is not an earlier directory', at);
    }
    need(32);
    const times: number[] = [];
    for (let i = 0; i < 4; i++, o += 8) {
      const t = view.getFloat64(o, true);
      if (!Number.isFinite(t)) throw corrupt('non-finite time', o);
      times.push(t);
    }
    let start = 0;
    let end = 0;
    if (kind === FILE) {
      need(8);
      const size = view.getFloat64(o, true);
      if (!Number.isSafeInteger(size) || size < 0) throw corrupt('bad file size', o);
      o += 8;
      need(size);
      start = o;
      o += size;
      end = o;
    }
    kinds.set(path, kind);
    const [mtimeMs, atimeMs, ctimeMs, birthtimeMs] = times as [number, number, number, number];
    out.push({ kind, path, stat: { mtimeMs, atimeMs, ctimeMs, birthtimeMs }, start, end });
  }
  if (out.length === 0) throw corrupt('no root entry', o - 1);
  if (o !== body) throw corrupt('bytes after the end marker', o);
  const same =
    template === null || expected === null
      ? template === expected
      : template.id === expected.id && template.version === expected.version;
  if (!same)
    throw new FsSnapshotError(
      'ERR_FS_SNAPSHOT_TEMPLATE',
      'the snapshot belongs to another template',
    );
  return out;
}

/** Absolute, not `/`, no empty / `.` / `..` segment, no NUL. */
function isCanonical(path: string): boolean {
  if (path.length < 2 || path.charCodeAt(0) !== 0x2f || path.includes('\0')) return false;
  for (const segment of path.slice(1).split('/'))
    if (segment === '' || segment === '.' || segment === '..') return false;
  return true;
}

/**
 * Replace the whole tree of `fs` with the blob's. Validates every byte first:
 * a refused blob leaves `fs` as it was (ADR-0567 §5–§6).
 */
export function restoreFs(fs: SnapshotFs, bytes: Uint8Array, options: SnapshotOptions): void {
  const { template, maxBytes } = checkOptions(options);
  if (!(bytes instanceof Uint8Array)) throw new TypeError('restoreFs bytes must be a Uint8Array');
  if (bytes.byteLength > maxBytes)
    throw new FsSnapshotError(
      'ERR_FS_SNAPSHOT_TOO_LARGE',
      `${bytes.byteLength} bytes > maxBytes ${maxBytes}`,
    );
  const entries = decode(bytes, template);
  for (const { name } of fs.readdirSync('/'))
    fs.rmSync(`/${name}`, { recursive: true, force: true });
  for (let i = 1; i < entries.length; i++) {
    const { kind, path, start, end } = entries[i] as Decoded;
    if (kind === DIR) fs.mkdirSync(path, { recursive: false });
    // A copy: a view would pin the whole blob for the life of the file.
    else fs.writeFileSync(path, bytes.slice(start, end));
  }
  for (const { path, stat } of entries) fs.restoreStatSync(path, stat);
}
