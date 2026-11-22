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
  /**
   * Budget either direction accepts: the blob's bytes + 384 per entry + 8 per
   * code unit of each entry's path + 80 per level of its depth (ADR-0567 §7).
   * Bounds memory (limit under 2 × maxBytes + 16 MiB) and time.
   */
  readonly maxBytes: number;
}

export type FsSnapshotErrorCode =
  | 'ERR_FS_SNAPSHOT_TOO_LARGE'
  | 'ERR_FS_SNAPSHOT_CORRUPT'
  | 'ERR_FS_SNAPSHOT_VERSION'
  | 'ERR_FS_SNAPSHOT_TEMPLATE'
  | 'ERR_FS_SNAPSHOT_UNREPRESENTABLE'
  | 'ERR_FS_SNAPSHOT_INCOMPLETE'
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
/**
 * Longest name V8 hashes by its content: longer strings hash by length alone,
 * so equal-length long names would make every Map of names quadratic (in this
 * decoder and in rifty's directory maps).
 */
const MAX_NAME_UNITS = 16_383;
/**
 * Budget an entry takes from `maxBytes` beyond its bytes: restoring one costs
 * ~670 B of memory at the peak and ~1.2 µs (measured, ADR-0567 §7), so a blob
 * dense in entries stays within ~2 × `maxBytes` like one dense in bytes.
 */
const ENTRY_COST = 384;
/**
 * Budget per code unit of an entry's path: decoding, checking and hashing a
 * long name costs tens of ns a unit (measured, ADR-0567 §7).
 */
const PATH_COST = 8;
/**
 * Budget per level of an entry's depth: each FS call resolves the path from
 * `/` segment by segment (~1 µs a level across restore's calls, measured).
 * With PATH_COST, no tree shape costs more time per budget byte than flat
 * entries (ADR-0567 §7).
 */
const DEPTH_COST = 80;
/** The Date range, ms: a time a `fs.Stats` Date can hold. */
const MAX_TIME = 8.64e15;

const validTime = (t: number): boolean => Number.isFinite(t) && Math.abs(t) <= MAX_TIME;

/** A directory entry name the format carries: not empty, `.`, `..`, no `/` or NUL, not overlong. */
function validName(name: string): boolean {
  return (
    name.length > 0 &&
    name.length <= MAX_NAME_UNITS &&
    name !== '.' &&
    name !== '..' &&
    !name.includes('/') &&
    !name.includes('\0')
  );
}

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

const unrepresentable = (what: string): FsSnapshotError =>
  new FsSnapshotError('ERR_FS_SNAPSHOT_UNREPRESENTABLE', what);

function timesOf(s: ReturnType<SnapshotFs['statSync']>): SnapshotStat {
  const meta = s.metadata;
  if (s.mtime === undefined || s.atime === undefined || meta === undefined)
    throw new TypeError('snapshotFs: the FS does not report entry times');
  const stat = {
    mtimeMs: s.mtime,
    atimeMs: s.atime,
    ctimeMs: meta.ctime,
    birthtimeMs: meta.birthtime,
  };
  // What the reader refuses, the writer refuses first (ADR-0567 §5).
  for (const t of [stat.mtimeMs, stat.atimeMs, stat.ctimeMs, stat.birthtimeMs])
    if (!validTime(t)) throw unrepresentable('a time outside the Date range or not finite');
  return stat;
}

/** Budget one entry takes beyond its bytes, for a path of `units` code units (ADR-0567 §7). */
const entryCost = (units: number, depth: number): number =>
  ENTRY_COST + PATH_COST * units + DEPTH_COST * depth;

/** The whole tree of `fs` as one blob (ADR-0567 §1). Throws `ERR_FS_SNAPSHOT_TOO_LARGE` before allocating. */
export function snapshotFs(fs: SnapshotFs, options: SnapshotOptions): Uint8Array {
  const { template, maxBytes } = checkOptions(options);
  try {
    return writeSnapshot(fs, template, maxBytes);
  } catch (error) {
    // An allocation the isolate's memory limit refused: a refusal, not a crash; the FS is untouched.
    if (error instanceof RangeError)
      throw new FsSnapshotError(
        'ERR_FS_SNAPSHOT_TOO_LARGE',
        'out of memory building the snapshot (size the memory limit for about 2 × maxBytes)',
      );
    throw error;
  }
}

function writeSnapshot(
  fs: SnapshotFs,
  template: SnapshotTemplate | null,
  maxBytes: number,
): Uint8Array {
  let size =
    HEADER +
    (template === null ? 0 : 4 + 2 * (template.id.length + template.version.length)) +
    1 +
    CRC_BYTES;
  // Budget charged beyond the bytes: per entry and per code unit of its path.
  let charges = 0;
  const tooLarge = () =>
    new FsSnapshotError(
      'ERR_FS_SNAPSHOT_TOO_LARGE',
      `the tree needs more than maxBytes ${maxBytes} (bytes + ${ENTRY_COST} per entry + ${PATH_COST} per path code unit + ${DEPTH_COST} per level of depth)`,
    );
  const entries: Entry[] = [];
  // Pre-order, siblings in code-unit order; iterative (no recursion on depth).
  // A pending child holds its parent's path (shared) and its own name.
  const stack: { path: string; depth: number }[] = [{ path: '/', depth: 0 }];
  while (stack.length > 0) {
    const { path, depth } = stack.pop() as (typeof stack)[number];
    const s = fs.statSync(path);
    if (s.isDirectory) {
      entries.push({ kind: DIR, path, stat: timesOf(s), data: null });
      size += RECORD + 2 * path.length;
      const names = fs.readdirSync(path).map((d) => d.name);
      for (const child of names)
        if (!validName(child))
          throw unrepresentable(
            `a name that is empty, '.', '..', holds '/' or NUL, or exceeds ${MAX_NAME_UNITS} code units`,
          );
      names.sort();
      const prefix = path === '/' ? '/' : `${path}/`;
      for (let i = names.length - 1; i >= 0; i--)
        stack.push({ path: prefix + (names[i] as string), depth: depth + 1 });
    } else {
      const data = fs.readFileBytesSync(path);
      entries.push({ kind: FILE, path, stat: timesOf(s), data });
      size += RECORD + 2 * path.length + 8 + data.byteLength;
    }
    charges += entryCost(path.length, depth);
    if (size + charges > maxBytes) throw tooLarge();
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
function decode(bytes: Uint8Array, expected: SnapshotTemplate | null, maxBytes: number): Decoded[] {
  const length = bytes.byteLength;
  if (length < 8) throw corrupt('not a snapshot (too short)', 0);
  for (let i = 0; i < 8; i++) if (bytes[i] !== MAGIC[i]) throw corrupt('not a snapshot (magic)', i);
  if (length < 12) throw corrupt('truncated header', length);
  const view = new DataView(bytes.buffer, bytes.byteOffset, length);
  const version = view.getUint32(8, true);
  // No version 0 was ever released: not a snapshot.
  if (version === 0) throw corrupt('format version 0', 8);
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
  // The open directories of the pre-order walk, each with its last child name:
  // parent and order checks without a Map keyed by guest strings.
  const open: { path: string; last: string | null }[] = [];
  // Each entry costs memory and time beyond its bytes: per entry, per path unit
  // and per level, all charged before anything is written.
  let charges = 0;
  const charge = (cost: number, at: number) => {
    charges += cost;
    if (length + charges > maxBytes)
      throw new FsSnapshotError(
        'ERR_FS_SNAPSHOT_TOO_LARGE',
        `the snapshot needs more than maxBytes ${maxBytes} (bytes + ${ENTRY_COST} per entry + ${PATH_COST} per path code unit + ${DEPTH_COST} per level of depth) at byte ${at}`,
      );
  };
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
    // Charge the entry and its path before the path is decoded or split: a
    // record the budget refuses allocates nothing (depth is charged once known).
    need(2 * units);
    charge(entryCost(units, 0), at);
    const path = text(units);
    if (out.length === 0) {
      if (path !== '/' || kind !== DIR)
        throw corrupt('the first entry is not the root directory', at);
    } else {
      if (!isCanonical(path)) throw corrupt('non-canonical path', at);
      const cut = path.lastIndexOf('/');
      const parent = cut === 0 ? '/' : path.slice(0, cut);
      while (open.length > 0 && (open[open.length - 1] as { path: string }).path !== parent)
        open.pop();
      const frame = open[open.length - 1];
      if (frame === undefined) throw corrupt('entry outside its parent directory', at);
      const name = path.slice(cut + 1);
      // Strictly increasing names per directory: duplicates and disorder alike.
      if (frame.last !== null && !(name > frame.last))
        throw corrupt('duplicate or out-of-order name', at);
      frame.last = name;
      charge(DEPTH_COST * open.length, at);
    }
    need(32);
    const times: number[] = [];
    for (let i = 0; i < 4; i++, o += 8) {
      const t = view.getFloat64(o, true);
      if (!validTime(t)) throw corrupt('time outside the Date range', o);
      times.push(t);
    }
    let start = 0;
    let end = 0;
    if (kind === FILE) {
      need(8);
      const size = view.getFloat64(o, true);
      if (!Number.isSafeInteger(size) || size < 0) throw corrupt('bad file size', o);
      o += 8;
      // A size past the end leaves `o` past it: the next read or the end check refuses.
      start = o;
      o += size;
      end = o;
    }
    if (kind === DIR) open.push({ path, last: null });
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

/** Absolute, not `/`, no empty / `.` / `..` / overlong segment, no NUL. */
function isCanonical(path: string): boolean {
  if (path.length < 2 || path.charCodeAt(0) !== 0x2f || path.includes('\0')) return false;
  for (const segment of path.slice(1).split('/'))
    if (segment === '' || segment === '.' || segment === '..' || segment.length > MAX_NAME_UNITS)
      return false;
  return true;
}

/**
 * Replace the whole tree of `fs` with the blob's. Validates every byte first:
 * a refused blob leaves `fs` as it was (ADR-0567 §5–§6).
 */
export function restoreFs(fs: SnapshotFs, bytes: Uint8Array, options: SnapshotOptions): void {
  const { template, maxBytes } = checkOptions(options);
  // Any realm's Uint8Array (a Buffer included): the tag, not `instanceof`.
  if (!ArrayBuffer.isView(bytes) || Object.prototype.toString.call(bytes) !== '[object Uint8Array]')
    throw new TypeError('restoreFs bytes must be a Uint8Array');
  if (bytes.byteLength > maxBytes)
    throw new FsSnapshotError(
      'ERR_FS_SNAPSHOT_TOO_LARGE',
      `${bytes.byteLength} bytes > maxBytes ${maxBytes}`,
    );
  const entries = decode(bytes, template, maxBytes);
  // From here the old tree is going: a failure (memory) leaves `fs` partial.
  try {
    for (const { name } of fs.readdirSync('/'))
      fs.rmSync(`/${name}`, { recursive: true, force: true });
    for (let i = 1; i < entries.length; i++) {
      const { kind, path, start, end } = entries[i] as Decoded;
      if (kind === DIR) fs.mkdirSync(path, { recursive: false });
      else {
        // An owned copy (`Buffer#slice` would be a view): a view pins the whole blob.
        const data = new Uint8Array(end - start);
        data.set(bytes.subarray(start, end));
        fs.writeFileSync(path, data);
      }
    }
    for (const { path, stat } of entries) fs.restoreStatSync(path, stat);
  } catch {
    throw new FsSnapshotError(
      'ERR_FS_SNAPSHOT_INCOMPLETE',
      'restore failed while writing: the FS is partial and must be discarded',
    );
  }
}
