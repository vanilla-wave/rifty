/**
 * The dependency snapshot envelope (ADR-0387, ADR-0547): a POSIX ustar + PAX tar holding
 * `payload/{package.json,package-lock.json,node_modules/}` and `rifty/{manifest.json,replay-cache/}`.
 * One reader for every consumer of `produceDependencySnapshot`'s artifact: `@riftydev/workbench`
 * (restore) and `@riftydev/isolate-host` (sandbox template).
 */
export const DEP_SNAPSHOT_TAR_BLOCK = 512;
const BLOCK = DEP_SNAPSHOT_TAR_BLOCK;
const dec = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

export interface DepSnapshotTarEntry {
  readonly path: string;
  readonly directory: boolean;
  readonly bytes: Uint8Array;
  /** The entry's mtime in ms: PAX `mtime` when present, else the header's (seconds). */
  readonly mtimeMs: number;
}
type TarEntry = DepSnapshotTarEntry;

export function failDepSnapshotTar(reason: string): never {
  throw new Error(`Malformed dependency snapshot tar: ${reason}`);
}

function safePath(path: string, directory: boolean): string {
  const canonical = directory && path.endsWith('/') ? path.slice(0, -1) : path;
  if (
    canonical.includes('\0') ||
    canonical.split('/').some((part) => part === '' || part === '.' || part === '..')
  ) {
    failDepSnapshotTar(`unsafe path "${path}"`);
  }
  return canonical;
}

function textField(header: Uint8Array, start: number, length: number): string {
  const bytes = header.subarray(start, start + length);
  const end = bytes.indexOf(0);
  if (end !== -1 && bytes.subarray(end).some((byte) => byte !== 0))
    failDepSnapshotTar('invalid header text');
  return dec.decode(end === -1 ? bytes : bytes.subarray(0, end));
}

function octalField(header: Uint8Array, start: number, length: number): number {
  const text = dec.decode(header.subarray(start, start + length));
  if (!/^[ \0]*[0-7]+[ \0]*$/.test(text)) failDepSnapshotTar('invalid octal header field');
  const value = Number.parseInt(text.replace(/^[ \0]+|[ \0]+$/g, ''), 8);
  if (!Number.isSafeInteger(value)) failDepSnapshotTar('oversized header field');
  return value;
}

export function depSnapshotTarChecksum(header: Uint8Array): number {
  return header.reduce((sum, byte, index) => sum + (index >= 148 && index < 156 ? 32 : byte), 0);
}

function paxFields(bytes: Uint8Array): Map<string, string> {
  const fields = new Map<string, string>();
  for (let offset = 0; offset < bytes.length; ) {
    const space = bytes.indexOf(32, offset);
    if (space === -1) failDepSnapshotTar('invalid PAX record length');
    const digits = dec.decode(bytes.subarray(offset, space));
    if (!/^[1-9][0-9]*$/.test(digits)) failDepSnapshotTar('invalid PAX record length');
    const length = Number(digits);
    const end = offset + length;
    if (
      !Number.isSafeInteger(end) ||
      end > bytes.length ||
      end <= space + 1 ||
      bytes[end - 1] !== 10
    ) {
      failDepSnapshotTar('truncated PAX record');
    }
    const record = bytes.subarray(space + 1, end - 1);
    const equals = record.indexOf(61);
    const key = dec.decode(record.subarray(0, equals));
    // Host xattrs are outside dependency bytes. SCHILY values can be binary;
    // admit their framing without interpreting them as paths or file content.
    const xattr = /^(LIBARCHIVE|SCHILY)\.xattr\..+$/.test(key);
    const value = xattr ? '' : dec.decode(record.subarray(equals + 1));
    if (
      equals <= 0 ||
      fields.has(key) ||
      (!xattr &&
        !['path', 'size', 'uid', 'gid', 'uname', 'gname', 'mtime', 'atime', 'ctime'].includes(
          key,
        )) ||
      value.includes('\0')
    ) {
      failDepSnapshotTar(`unsupported or duplicate PAX field "${key}"`);
    }
    if (
      key === 'size' &&
      (!/^(0|[1-9][0-9]*)$/.test(value) || !Number.isSafeInteger(Number(value)))
    ) {
      failDepSnapshotTar('invalid PAX size');
    }
    fields.set(key, value);
    offset = end;
  }
  return fields;
}

export function validateDepSnapshotEntries(
  entries: readonly Pick<TarEntry, 'path' | 'directory'>[],
): void {
  const byPath = new Map<string, Pick<TarEntry, 'path' | 'directory'>>();
  for (const entry of entries) {
    if (safePath(entry.path, entry.directory) !== entry.path)
      failDepSnapshotTar('noncanonical entry path');
    if (byPath.has(entry.path)) failDepSnapshotTar(`duplicate path "${entry.path}"`);
    byPath.set(entry.path, entry);
    const allowed = entry.directory
      ? ['payload', 'payload/node_modules', 'rifty', 'rifty/replay-cache'].includes(entry.path) ||
        entry.path.startsWith('payload/node_modules/') ||
        entry.path.startsWith('rifty/replay-cache/')
      : ['payload/package.json', 'payload/package-lock.json', 'rifty/manifest.json'].includes(
          entry.path,
        ) ||
        entry.path.startsWith('payload/node_modules/') ||
        entry.path.startsWith('rifty/replay-cache/');
    if (!allowed) failDepSnapshotTar(`unsupported envelope entry "${entry.path}"`);
  }
  for (const entry of entries) {
    let slash = entry.path.lastIndexOf('/');
    while (slash !== -1) {
      const parent = byPath.get(entry.path.slice(0, slash));
      if (parent && !parent.directory) failDepSnapshotTar(`file ancestor of "${entry.path}"`);
      slash = entry.path.lastIndexOf('/', slash - 1);
    }
  }
  for (const path of ['payload/package.json', 'payload/package-lock.json', 'rifty/manifest.json']) {
    if (!byPath.has(path)) failDepSnapshotTar(`missing "${path}"`);
  }
}

/** The entries of a dependency snapshot tar (ustar + PAX), its envelope validated. */
export function readDepSnapshotTar(bytes: Uint8Array): readonly TarEntry[] {
  if (bytes.length % BLOCK !== 0) failDepSnapshotTar('truncated block');
  const entries: TarEntry[] = [];
  let pax: Map<string, string> | undefined;
  for (let offset = 0; offset + BLOCK <= bytes.length; ) {
    const header = bytes.subarray(offset, offset + BLOCK);
    if (header.every((byte) => byte === 0)) {
      if (
        pax ||
        offset + BLOCK * 2 > bytes.length ||
        bytes.subarray(offset).some((byte) => byte !== 0)
      ) {
        failDepSnapshotTar('invalid end-of-archive blocks');
      }
      validateDepSnapshotEntries(entries);
      return entries;
    }
    if (octalField(header, 148, 8) !== depSnapshotTarChecksum(header))
      failDepSnapshotTar('header checksum mismatch');
    if (textField(header, 257, 6) !== 'ustar' || textField(header, 263, 2) !== '00') {
      failDepSnapshotTar('unsupported tar header');
    }
    for (const [start, length] of [
      [100, 8],
      [108, 8],
      [116, 8],
      [136, 12],
    ] as const) {
      octalField(header, start, length);
    }
    const type = header[156];
    if (type !== 0 && type !== 48 && type !== 53 && type !== 120)
      failDepSnapshotTar(`unsupported entry type ${type}`);
    if (textField(header, 157, 100) !== '') failDepSnapshotTar('unexpected link target');
    const prefix = textField(header, 345, 155);
    const name = textField(header, 0, 100);
    const directory = type === 53;
    const headerPath = safePath(prefix ? `${prefix}/${name}` : name, directory);
    const headerSize = octalField(header, 124, 12);
    if (type === 120 && pax) failDepSnapshotTar('stacked PAX headers');
    const size = type !== 120 && pax?.has('size') ? Number(pax.get('size')) : headerSize;
    const dataStart = offset + BLOCK;
    const next = dataStart + Math.ceil(size / BLOCK) * BLOCK;
    if (!Number.isSafeInteger(next) || next > bytes.length)
      failDepSnapshotTar('truncated entry body');
    if (bytes.subarray(dataStart + size, next).some((byte) => byte !== 0))
      failDepSnapshotTar('nonzero entry padding');
    const content = bytes.subarray(dataStart, dataStart + size);
    if (type === 120) {
      pax = paxFields(content);
    } else {
      if (directory && size !== 0) failDepSnapshotTar('directory carries file bytes');
      const paxMtime = pax?.get('mtime');
      if (paxMtime !== undefined && !/^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(paxMtime))
        failDepSnapshotTar('invalid PAX mtime');
      entries.push({
        path: safePath(pax?.get('path') ?? headerPath, directory),
        directory,
        bytes: content,
        mtimeMs: (paxMtime === undefined ? octalField(header, 136, 12) : Number(paxMtime)) * 1000,
      });
      pax = undefined;
    }
    offset = next;
  }
  failDepSnapshotTar('missing end-of-archive blocks');
}

const MANIFEST_KEYS = [
  'version',
  'profile',
  'templateId',
  'packages',
  'deps',
  'installArtifactIdentity',
];

/** `rifty/manifest.json` of `entries`, its version and profile checked (v4 replay, v5 frozen). */
export function readDepSnapshotManifest(
  entries: readonly DepSnapshotTarEntry[],
): Record<string, unknown> & { readonly version: 4 | 5 } {
  const entry = entries.find((candidate) => candidate.path === 'rifty/manifest.json');
  if (!entry) failDepSnapshotTar('missing "rifty/manifest.json"');
  const manifest: unknown = JSON.parse(dec.decode(entry.bytes));
  if (
    typeof manifest !== 'object' ||
    manifest === null ||
    Array.isArray(manifest) ||
    !('version' in manifest) ||
    (manifest.version !== 4 && manifest.version !== 5) ||
    (manifest.version === 5
      ? !('profile' in manifest) || manifest.profile !== 'frozen'
      : 'profile' in manifest) ||
    Object.keys(manifest).some((key) => !MANIFEST_KEYS.includes(key))
  ) {
    failDepSnapshotTar('invalid dependency snapshot manifest');
  }
  if (
    manifest.version === 5 &&
    entries.some(
      (candidate) =>
        candidate.path === 'rifty/replay-cache' || candidate.path.startsWith('rifty/replay-cache/'),
    )
  ) {
    failDepSnapshotTar('frozen snapshot contains replay cache namespace');
  }
  return manifest as Record<string, unknown> & { readonly version: 4 | 5 };
}
