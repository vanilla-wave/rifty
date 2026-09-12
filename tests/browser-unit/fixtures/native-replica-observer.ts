/** Read the documented native format for fault selection/custody, independently of VFS caches. */
export interface NativeReplicaRecord {
  readonly path: string;
  readonly kind: 'dir' | 'file' | 'delete';
  readonly bytes?: Uint8Array<ArrayBuffer>;
}
const decoder = new TextDecoder();

export async function nativeWriteBytes(
  data: FileSystemWriteChunkType,
): Promise<Uint8Array<ArrayBuffer>> {
  if (typeof data === 'string') return new TextEncoder().encode(data);
  if (data instanceof Blob) return new Uint8Array(await data.arrayBuffer());
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data))
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength).slice();
  if (data.type === 'write' && data.data != null) return nativeWriteBytes(data.data);
  throw new Error('Expected native segment write bytes');
}

export function nativeSegmentRecords(bytes: Uint8Array): readonly NativeReplicaRecord[] {
  if (decoder.decode(bytes.subarray(0, 8)) !== 'RIFTYRP1')
    throw new Error('Unknown native segment');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 12 + view.getUint32(8, true);
  const count = view.getUint32(offset, true);
  offset += 4;
  const records: {
    path: string;
    kind: NativeReplicaRecord['kind'];
    offset?: number;
    size?: number;
  }[] = [];
  for (let i = 0; i < count; i++) {
    const size = view.getUint32(offset, true);
    offset += 4;
    records.push(JSON.parse(decoder.decode(bytes.subarray(offset, offset + size))));
    offset += size;
  }
  return records.map((entry) => ({
    path: entry.path,
    kind: entry.kind,
    ...(entry.kind === 'file'
      ? {
          bytes: bytes.slice(
            offset + (entry.offset ?? 0),
            offset + (entry.offset ?? 0) + (entry.size ?? 0),
          ),
        }
      : {}),
  }));
}

export async function nativeReplicaEntries(
  root: FileSystemDirectoryHandle,
): Promise<Map<string, NativeReplicaRecord>> {
  const entries = new Map<string, NativeReplicaRecord>();
  let directory: FileSystemDirectoryHandle;
  let head: File;
  try {
    directory = await root.getDirectoryHandle('.rifty-replica-v1');
    head = await (await directory.getFileHandle('HEAD')).getFile();
  } catch (error) {
    if (error instanceof DOMException && error.name === 'NotFoundError') return entries;
    throw error;
  }
  const { segments } = JSON.parse(await head.text()) as { segments: string[] };
  for (const digest of segments) {
    const file = await (await directory.getFileHandle(`segment-${digest}.bin`)).getFile();
    const bytes = new Uint8Array(await file.arrayBuffer());
    const actual = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    if (actual !== digest) throw new Error('Native custody checksum mismatch');
    for (const record of nativeSegmentRecords(bytes)) {
      if (record.kind === 'delete') {
        for (const path of entries.keys())
          if (path === record.path || path.startsWith(`${record.path}/`)) entries.delete(path);
      } else entries.set(record.path, record);
    }
  }
  return entries;
}
