import { TARBALL_CACHE_ROOT } from '@riftydev/npm-client';
import {
  DEP_SNAPSHOT_TAR_BLOCK as BLOCK,
  type DepSnapshotTarEntry,
  depSnapshotTarChecksum as checksum,
  failDepSnapshotTar as fail,
  readDepSnapshotManifest,
  readDepSnapshotTar,
  validateDepSnapshotEntries as validateEntries,
} from '@riftydev/npm-client/internal';
import type { DepSnapshot } from './dep-snapshot.ts';
import type { WorkspaceArchiveFile, WorkspaceArchiveV1 } from './workspace-archive.ts';

const enc = new TextEncoder();
const dec = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

type TarEntry = Omit<DepSnapshotTarEntry, 'mtimeMs'>;

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

function archiveFromEntries(
  entries: readonly DepSnapshotTarEntry[],
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
  const entries = readDepSnapshotTar(bytes);
  const fileText = (path: string): string => {
    const entry = entries.find((candidate) => candidate.path === path);
    if (!entry) fail(`missing "${path}"`);
    return dec.decode(entry.bytes);
  };
  const manifest = readDepSnapshotManifest(entries);
  return {
    ...manifest,
    version: manifest.version === 5 ? 5 : 3,
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
export function encodeDepSnapshotTar(snapshot: DepSnapshot): Uint8Array {
  const entries: TarEntry[] = [];
  const add = (path: string, bytes = new Uint8Array(), directory = false): void => {
    entries.push({ path, bytes, directory });
  };
  for (const path of ['payload', 'payload/node_modules', 'rifty']) add(path, undefined, true);
  if (snapshot.version === 3) add('rifty/replay-cache', undefined, true);
  add('payload/package.json', enc.encode(snapshot.packageJsonText));
  add('payload/package-lock.json', enc.encode(snapshot.lockfile));
  add(
    'rifty/manifest.json',
    enc.encode(
      JSON.stringify({
        version: snapshot.version === 5 ? 5 : 4,
        ...(snapshot.version === 5 ? { profile: snapshot.profile } : {}),
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
    if (snapshot.version === 5 && prefix === 'rifty/replay-cache') {
      if (archive.files.length || (archive.directories?.length ?? 0))
        fail('frozen snapshot contains replay cache entries');
      continue;
    }
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
