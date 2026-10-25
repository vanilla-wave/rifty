import { NotImplementedError } from './errors.ts';
import { OpfsPreloadError } from './opfs-preload.ts';
import type { ReplicaImage, ReplicaRecord } from './opfs-replica-types.ts';
import { dirnameNormalized, normalizeAbsolute } from './path.ts';

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const MAGIC = encoder.encode('RIFTYRP1');
const DIGEST = /^[a-f0-9]{64}$/;

export class ReplicaCorruptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReplicaCorruptionError';
  }
}

function corrupt(message: string): never {
  throw new ReplicaCorruptionError(message);
}

function unsupported(feature: string): never {
  throw new OpfsPreloadError(new NotImplementedError(`opfs.replica.${feature}`));
}

export async function replicaDigest(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    corrupt('Expected a replica object');
  return value as Record<string, unknown>;
}

function parse(bytes: Uint8Array): unknown {
  let text: string;
  try {
    text = decoder.decode(bytes);
  } catch {
    return corrupt('Invalid replica UTF-8');
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    if (error instanceof SyntaxError) return corrupt('Invalid replica JSON');
    throw error;
  }
}

function pathValue(value: unknown): string {
  if (typeof value !== 'string' || !value.startsWith('/') || value.includes('\0'))
    corrupt('Invalid replica path');
  if (normalizeAbsolute(value) !== value) corrupt('Noncanonical replica path');
  return value;
}

function finite(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) corrupt('Invalid replica timestamp');
  return value;
}

function unsigned(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    corrupt('Invalid replica range');
  return value;
}

export function segmentName(digest: string): string {
  if (!DIGEST.test(digest)) corrupt('Invalid segment identity');
  return `segment-${digest}.bin`;
}

export async function encodeHead(segments: readonly string[]): Promise<Uint8Array<ArrayBuffer>> {
  for (const digest of segments) segmentName(digest);
  const payload = { version: 1, segments };
  return encoder.encode(
    JSON.stringify({
      ...payload,
      sha256: await replicaDigest(encoder.encode(JSON.stringify(payload))),
    }),
  );
}

export async function decodeHead(bytes: Uint8Array<ArrayBuffer>): Promise<readonly string[]> {
  const value = object(parse(bytes));
  if (value.version !== 1) unsupported('version');
  if (
    Object.keys(value).sort().join(',') !== 'segments,sha256,version' ||
    !Array.isArray(value.segments)
  )
    corrupt('Invalid replica HEAD');
  const segments = value.segments.map((value) => {
    if (typeof value !== 'string') return corrupt('Invalid segment reference');
    segmentName(value);
    return value;
  });
  const actual = await replicaDigest(encoder.encode(JSON.stringify({ version: 1, segments })));
  if (value.sha256 !== actual) corrupt('HEAD checksum mismatch');
  return segments;
}

export interface ReplicaLocation {
  readonly segment: string;
  readonly metadataOffset: number;
  readonly metadata: Uint8Array<ArrayBuffer>;
  readonly offset: number;
  readonly size: number;
  readonly digest: string | null;
}

export interface DecodedReplicaRecord {
  readonly record: ReplicaRecord;
  readonly location: ReplicaLocation;
}

export interface EncodedSegment {
  readonly digest: string;
  readonly bytes: Uint8Array<ArrayBuffer>;
  readonly records: readonly DecodedReplicaRecord[];
}

/** Metadata frames precede one content area; ranges permit targeted native reads. */
export async function encodeSegment(
  records: readonly ReplicaRecord[],
  paths: readonly string[],
): Promise<EncodedSegment> {
  let contentLength = 0;
  const metadata = await Promise.all(
    records.map(async (record) => {
      const path = pathValue(record.path);
      if (record.kind === 'delete') return encoder.encode(JSON.stringify({ kind: 'delete', path }));
      const times = { atime: finite(record.atime), mtime: finite(record.mtime) };
      if (record.kind === 'dir')
        return encoder.encode(JSON.stringify({ kind: 'dir', path, ...times, mode: null }));
      const offset = contentLength;
      contentLength += record.bytes.length;
      return encoder.encode(
        JSON.stringify({
          kind: 'file',
          path,
          ...times,
          mode: null,
          offset,
          size: record.bytes.length,
          digest: await replicaDigest(record.bytes),
        }),
      );
    }),
  );
  const header = encoder.encode(
    JSON.stringify({ version: 1, paths: [...new Set(paths.map(pathValue))] }),
  );
  const dataStart =
    MAGIC.length + 8 + header.length + metadata.reduce((size, bytes) => size + 4 + bytes.length, 0);
  const bytes = new Uint8Array(dataStart + contentLength);
  const view = new DataView(bytes.buffer);
  bytes.set(MAGIC);
  view.setUint32(8, header.length, true);
  bytes.set(header, 12);
  let cursor = 12 + header.length;
  view.setUint32(cursor, records.length, true);
  cursor += 4;
  const locations: { offset: number; bytes: Uint8Array<ArrayBuffer> }[] = [];
  for (const entry of metadata) {
    view.setUint32(cursor, entry.length, true);
    cursor += 4;
    locations.push({ offset: cursor, bytes: entry });
    bytes.set(entry, cursor);
    cursor += entry.length;
  }
  let body = dataStart;
  for (const record of records) {
    if (record.kind !== 'file') continue;
    bytes.set(record.bytes, body);
    body += record.bytes.length;
  }
  const digest = await replicaDigest(bytes);
  let offset = dataStart;
  const decoded = records.map((record, index): DecodedReplicaRecord => {
    const meta = locations[index];
    if (!meta) throw new Error('Replica encoder lost metadata');
    const value = object(parse(meta.bytes));
    const size = record.kind === 'file' ? record.bytes.length : 0;
    const location: ReplicaLocation = {
      segment: digest,
      metadataOffset: meta.offset,
      metadata: meta.bytes,
      offset,
      size,
      digest: record.kind === 'file' ? String(value.digest) : null,
    };
    offset += size;
    return { record, location };
  });
  return { digest, bytes, records: decoded };
}

export async function decodeSegment(
  bytes: Uint8Array<ArrayBuffer>,
  digest: string,
): Promise<readonly DecodedReplicaRecord[]> {
  if ((await replicaDigest(bytes)) !== digest) corrupt('Segment checksum mismatch');
  if (bytes.length < 16 || !MAGIC.every((byte, index) => bytes[index] === byte))
    corrupt('Invalid segment magic');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let cursor = 8;
  const readSize = () => {
    if (cursor + 4 > bytes.length) return corrupt('Truncated segment frame');
    const size = view.getUint32(cursor, true);
    cursor += 4;
    return size;
  };
  const readMetadata = () => {
    const length = readSize();
    if (length === 0 || length > bytes.length - cursor) return corrupt('Invalid metadata range');
    const offset = cursor;
    const raw = bytes.slice(cursor, cursor + length);
    cursor += length;
    return { value: object(parse(raw)), offset, raw };
  };
  const header = readMetadata().value;
  if (header.version !== 1) unsupported('version');
  if (!Array.isArray(header.paths)) corrupt('Missing affected paths');
  header.paths.forEach(pathValue);
  const count = readSize();
  if (count > (bytes.length - cursor) / 4) corrupt('Invalid frame count');
  const metadata = Array.from({ length: count }, readMetadata);
  const dataStart = cursor;
  return Promise.all(
    metadata.map(async ({ value, offset: metadataOffset, raw }) => {
      const path = pathValue(value.path);
      let record: ReplicaRecord;
      let offset = 0;
      let size = 0;
      let fileDigest: string | null = null;
      if (value.kind === 'delete') {
        record = { kind: 'delete', path };
      } else if (value.kind === 'dir' || value.kind === 'file') {
        if (value.mode !== null) unsupported('mode');
        const times = { atime: finite(value.atime), mtime: finite(value.mtime) };
        if (value.kind === 'dir') record = { kind: 'dir', path, ...times };
        else {
          offset = unsigned(value.offset);
          size = unsigned(value.size);
          if (size > bytes.length - dataStart || offset > bytes.length - dataStart - size)
            corrupt('Content range outside segment');
          if (typeof value.digest !== 'string' || !DIGEST.test(value.digest))
            corrupt('Invalid content identity');
          fileDigest = value.digest;
          const content = bytes.slice(dataStart + offset, dataStart + offset + size);
          if ((await replicaDigest(content)) !== fileDigest) corrupt('Content checksum mismatch');
          record = { kind: 'file', path, ...times, bytes: content };
        }
      } else unsupported('record-kind');
      return {
        record,
        location: {
          segment: digest,
          metadataOffset,
          metadata: raw,
          offset: dataStart + offset,
          size,
          digest: fileDigest,
        },
      };
    }),
  );
}

export interface CommittedReplicaEntry {
  readonly kind: 'file' | 'dir';
  readonly path: string;
  readonly atime: number;
  readonly mtime: number;
  readonly location: ReplicaLocation | null;
}

/** Apply ordered images/tombstones; never retain a second live content cache. */
export function applyReplicaRecords(
  entries: Map<string, CommittedReplicaEntry>,
  records: readonly DecodedReplicaRecord[],
  content?: Map<string, ReplicaImage>,
): void {
  for (const { record, location } of records) {
    if (record.kind === 'delete') {
      const prefix = record.path === '/' ? '/' : `${record.path}/`;
      for (const path of entries.keys()) {
        if (path !== '/' && (path === record.path || path.startsWith(prefix))) {
          entries.delete(path);
          content?.delete(path);
        }
      }
      continue;
    }
    const parent = record.path === '/' ? null : entries.get(dirnameNormalized(record.path));
    if (record.path !== '/' && parent?.kind !== 'dir') corrupt(`Missing parent for ${record.path}`);
    const previous = entries.get(record.path);
    if (previous && previous.kind !== record.kind)
      corrupt(`Kind replacement without deletion at ${record.path}`);
    if (record.path === '/' && record.kind !== 'dir') corrupt('Replica root is not a directory');
    entries.set(record.path, {
      kind: record.kind,
      path: record.path,
      atime: record.atime,
      mtime: record.mtime,
      location,
    });
    content?.set(record.path, record);
  }
}

export function emptyReplicaEntries(): Map<string, CommittedReplicaEntry> {
  return new Map([['/', { kind: 'dir', path: '/', atime: 0, mtime: 0, location: null }]]);
}
