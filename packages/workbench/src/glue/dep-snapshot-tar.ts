import { TARBALL_CACHE_ROOT } from '@riftydev/npm-client';
import type { DepSnapshotV3 } from './dep-snapshot.ts';
import type { WorkspaceArchiveFile, WorkspaceArchiveV1 } from './workspace-archive.ts';

const BLOCK = 512;
const enc = new TextEncoder();
const dec = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

interface TarEntry {
  readonly path: string;
  readonly directory: boolean;
  readonly bytes: Uint8Array;
}

function fail(reason: string): never {
  throw new Error(`Malformed dependency snapshot tar: ${reason}`);
}

function safePath(path: string, directory: boolean): string {
  const canonical = directory && path.endsWith('/') ? path.slice(0, -1) : path;
  if (
    canonical.includes('\0') ||
    canonical.split('/').some((part) => part === '' || part === '.' || part === '..')
  ) {
    fail(`unsafe path "${path}"`);
  }
  return canonical;
}

function textField(header: Uint8Array, start: number, length: number): string {
  const bytes = header.subarray(start, start + length);
  const end = bytes.indexOf(0);
  if (end !== -1 && bytes.subarray(end).some((byte) => byte !== 0)) fail('invalid header text');
  return dec.decode(end === -1 ? bytes : bytes.subarray(0, end));
}

function octalField(header: Uint8Array, start: number, length: number): number {
  const text = dec.decode(header.subarray(start, start + length));
  if (!/^[ \0]*[0-7]+[ \0]*$/.test(text)) fail('invalid octal header field');
  const value = Number.parseInt(text.replace(/^[ \0]+|[ \0]+$/g, ''), 8);
  if (!Number.isSafeInteger(value)) fail('oversized header field');
  return value;
}

function checksum(header: Uint8Array): number {
  return header.reduce((sum, byte, index) => sum + (index >= 148 && index < 156 ? 32 : byte), 0);
}

function paxFields(bytes: Uint8Array): Map<string, string> {
  const fields = new Map<string, string>();
  for (let offset = 0; offset < bytes.length; ) {
    const space = bytes.indexOf(32, offset);
    if (space === -1) fail('invalid PAX record length');
    const digits = dec.decode(bytes.subarray(offset, space));
    if (!/^[1-9][0-9]*$/.test(digits)) fail('invalid PAX record length');
    const length = Number(digits);
    const end = offset + length;
    if (
      !Number.isSafeInteger(end) ||
      end > bytes.length ||
      end <= space + 1 ||
      bytes[end - 1] !== 10
    ) {
      fail('truncated PAX record');
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
      fail(`unsupported or duplicate PAX field "${key}"`);
    }
    if (
      key === 'size' &&
      (!/^(0|[1-9][0-9]*)$/.test(value) || !Number.isSafeInteger(Number(value)))
    ) {
      fail('invalid PAX size');
    }
    fields.set(key, value);
    offset = end;
  }
  return fields;
}

function validateEntries(entries: readonly TarEntry[]): void {
  const byPath = new Map<string, TarEntry>();
  for (const entry of entries) {
    if (safePath(entry.path, entry.directory) !== entry.path) fail('noncanonical entry path');
    if (byPath.has(entry.path)) fail(`duplicate path "${entry.path}"`);
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
    if (!allowed) fail(`unsupported envelope entry "${entry.path}"`);
  }
  for (const entry of entries) {
    let slash = entry.path.lastIndexOf('/');
    while (slash !== -1) {
      const parent = byPath.get(entry.path.slice(0, slash));
      if (parent && !parent.directory) fail(`file ancestor of "${entry.path}"`);
      slash = entry.path.lastIndexOf('/', slash - 1);
    }
  }
  for (const path of ['payload/package.json', 'payload/package-lock.json', 'rifty/manifest.json']) {
    if (!byPath.has(path)) fail(`missing "${path}"`);
  }
}

function readEntries(bytes: Uint8Array): readonly TarEntry[] {
  if (bytes.length % BLOCK !== 0) fail('truncated block');
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
        fail('invalid end-of-archive blocks');
      }
      validateEntries(entries);
      return entries;
    }
    if (octalField(header, 148, 8) !== checksum(header)) fail('header checksum mismatch');
    if (textField(header, 257, 6) !== 'ustar' || textField(header, 263, 2) !== '00') {
      fail('unsupported tar header');
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
      fail(`unsupported entry type ${type}`);
    if (textField(header, 157, 100) !== '') fail('unexpected link target');
    const prefix = textField(header, 345, 155);
    const name = textField(header, 0, 100);
    const directory = type === 53;
    const headerPath = safePath(prefix ? `${prefix}/${name}` : name, directory);
    const headerSize = octalField(header, 124, 12);
    if (type === 120 && pax) fail('stacked PAX headers');
    const size = type !== 120 && pax?.has('size') ? Number(pax.get('size')) : headerSize;
    const dataStart = offset + BLOCK;
    const next = dataStart + Math.ceil(size / BLOCK) * BLOCK;
    if (!Number.isSafeInteger(next) || next > bytes.length) fail('truncated entry body');
    if (bytes.subarray(dataStart + size, next).some((byte) => byte !== 0))
      fail('nonzero entry padding');
    const content = bytes.subarray(dataStart, dataStart + size);
    if (type === 120) {
      pax = paxFields(content);
    } else {
      if (directory && size !== 0) fail('directory carries file bytes');
      entries.push({
        path: safePath(pax?.get('path') ?? headerPath, directory),
        directory,
        bytes: content,
      });
      pax = undefined;
    }
    offset = next;
  }
  fail('missing end-of-archive blocks');
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

function archiveFromEntries(
  entries: readonly TarEntry[],
  prefix: string,
  root: string,
): WorkspaceArchiveV1 {
  const files: WorkspaceArchiveFile[] = [];
  const directories: string[] = [];
  for (const entry of entries) {
    if (!entry.path.startsWith(`${prefix}/`)) continue;
    const path = entry.path.slice(prefix.length + 1);
    if (entry.directory) directories.push(path);
    else files.push({ path, encoding: 'base64', content: bytesToBase64(entry.bytes) });
  }
  return { version: 1, root, files, directories };
}

/** Container preflight; the snapshot owner then validates metadata and replay trust. */
export function decodeDepSnapshotTar(bytes: Uint8Array): unknown {
  const entries = readEntries(bytes);
  const fileText = (path: string): string => {
    const entry = entries.find((candidate) => candidate.path === path);
    if (!entry) fail(`missing "${path}"`);
    return dec.decode(entry.bytes);
  };
  const manifest: unknown = JSON.parse(fileText('rifty/manifest.json'));
  if (
    typeof manifest !== 'object' ||
    manifest === null ||
    Array.isArray(manifest) ||
    !('version' in manifest) ||
    manifest.version !== 4 ||
    Object.keys(manifest).some(
      (key) =>
        !['version', 'templateId', 'packages', 'deps', 'installArtifactIdentity'].includes(key),
    )
  ) {
    fail('invalid version 4 manifest');
  }
  return {
    ...manifest,
    version: 3,
    packageJsonText: fileText('payload/package.json'),
    lockfile: fileText('payload/package-lock.json'),
    nodeModules: archiveFromEntries(entries, 'payload/node_modules', '/workspace/node_modules'),
    tarballCache: archiveFromEntries(entries, 'rifty/replay-cache', TARBALL_CACHE_ROOT),
  };
}

function headerFor(path: string, type: '0' | '5' | 'x', size: number): Uint8Array {
  const header = new Uint8Array(BLOCK);
  const octal = (offset: number, width: number, value: number): void => {
    const text = value.toString(8).padStart(width - 1, '0');
    if (text.length >= width) fail('entry exceeds tar numeric field');
    header.set(enc.encode(text), offset);
  };
  header.set(enc.encode(path), 0);
  octal(100, 8, type === '5' ? 0o755 : 0o644);
  octal(108, 8, 0);
  octal(116, 8, 0);
  octal(124, 12, size);
  octal(136, 12, 0);
  header[156] = type.charCodeAt(0);
  header.set(enc.encode('ustar\0' + '00'), 257);
  header.set(enc.encode(`${checksum(header).toString(8).padStart(6, '0')}\0 `), 148);
  return header;
}

function paxPath(path: string): Uint8Array {
  const record = ` path=${path}\n`;
  const recordBytes = enc.encode(record).length;
  let length = recordBytes + 1;
  while (String(length).length + recordBytes !== length)
    length = String(length).length + recordBytes;
  return enc.encode(`${length}${record}`);
}

/** POSIX PAX, sorted by code unit; no host timestamps, owners or locale ordering. */
export function encodeDepSnapshotTar(snapshot: DepSnapshotV3): Uint8Array {
  const entries: TarEntry[] = [];
  const add = (path: string, bytes = new Uint8Array(), directory = false): void => {
    entries.push({ path, bytes, directory });
  };
  for (const path of ['payload', 'payload/node_modules', 'rifty', 'rifty/replay-cache'])
    add(path, undefined, true);
  add('payload/package.json', enc.encode(snapshot.packageJsonText));
  add('payload/package-lock.json', enc.encode(snapshot.lockfile));
  add(
    'rifty/manifest.json',
    enc.encode(
      JSON.stringify({
        version: 4,
        templateId: snapshot.templateId,
        packages: snapshot.packages,
        deps: Object.fromEntries(
          Object.entries(snapshot.deps).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
        ),
        installArtifactIdentity: snapshot.installArtifactIdentity,
      }),
    ),
  );
  for (const [archive, prefix] of [
    [snapshot.nodeModules, 'payload/node_modules'],
    [snapshot.tarballCache, 'rifty/replay-cache'],
  ] as const) {
    for (const path of archive.directories ?? []) add(`${prefix}/${path}`, undefined, true);
    for (const file of archive.files) {
      if (file.encoding !== 'base64') fail('invalid archive file encoding');
      add(
        `${prefix}/${file.path}`,
        Uint8Array.from(atob(file.content), (char) => char.charCodeAt(0)),
      );
    }
  }
  validateEntries(entries);
  entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const blocks: Uint8Array[] = [];
  const append = (path: string, type: '0' | '5' | 'x', content: Uint8Array): void => {
    blocks.push(headerFor(path, type, content.length), content);
    const padding = (BLOCK - (content.length % BLOCK)) % BLOCK;
    if (padding) blocks.push(new Uint8Array(padding));
  };
  for (const [index, entry] of entries.entries()) {
    const path = entry.directory ? `${entry.path}/` : entry.path;
    const extended = enc.encode(path).length > 100 || /[^\x20-\x7e]/.test(path);
    if (extended) append(`PaxHeaders/${index}`, 'x', paxPath(path));
    append(extended ? `PaxEntry/${index}` : path, entry.directory ? '5' : '0', entry.bytes);
  }
  blocks.push(new Uint8Array(BLOCK * 2));
  const result = new Uint8Array(blocks.reduce((sum, block) => sum + block.length, 0));
  let offset = 0;
  for (const block of blocks) {
    result.set(block, offset);
    offset += block.length;
  }
  return result;
}
