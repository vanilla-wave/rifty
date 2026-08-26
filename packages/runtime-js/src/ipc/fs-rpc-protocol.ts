/**
 * Shared `fs.*` sync-RPC protocol (ADR-0150): child CLI worker reads the
 * store owner's fs over sync-RPC. Owner serves these methods
 * on the kernel dispatcher; the child's SyncRpcFsSync calls them. Reads/writes
 * chunk under the 1 MiB SAB ring (ADR-0084 #19): ADR-0365 read heads and
 * continuation replies are raw bytes (binary frame), write requests carry
 * base64 in JSON (the request frame is JSON-only, ADR-0032).
 */

/** Raw bytes per chunk. 256 KiB → ~342 KiB base64; + JSON framing < 1 MiB. */
export const FS_RPC_CHUNK = 256 * 1024;
const READ_HEAD_HEADER_BYTES = 8;

export const FS_METHODS = {
  exists: 'fs.exists',
  stat: 'fs.stat',
  statOrNull: 'fs.statOrNull',
  readdir: 'fs.readdir',
  readFileHead: 'fs.readFileHead',
  readChunk: 'fs.readChunk',
  writeChunk: 'fs.writeChunk',
  mkdir: 'fs.mkdir',
  rm: 'fs.rm',
  rename: 'fs.rename',
  utimes: 'fs.utimes',
  copyFile: 'fs.copyFile',
  cp: 'fs.cp',
} as const;

export interface FsStatShape {
  isFile: boolean;
  isDirectory: boolean;
  size?: number;
  mtime?: number;
}

export interface FsReadHead {
  readonly size: number;
  readonly firstChunk: Uint8Array;
}

/** ADR-0365: encode total size + exact first chunk as one binary reply. */
export function encodeReadFileHead(bytes: Uint8Array): Uint8Array {
  const firstChunk = bytes.subarray(0, FS_RPC_CHUNK);
  const reply = new Uint8Array(READ_HEAD_HEADER_BYTES + firstChunk.length);
  new DataView(reply.buffer).setFloat64(0, bytes.length, true);
  reply.set(firstChunk, READ_HEAD_HEADER_BYTES);
  return reply;
}

/** Validate ADR-0365's complete head before the caller allocates output. */
export function decodeReadFileHead(value: unknown): FsReadHead {
  if (!(value instanceof Uint8Array)) {
    throw new TypeError('sync-rpc-fs: read head reply must be a Uint8Array');
  }
  if (value.length < READ_HEAD_HEADER_BYTES) {
    throw new TypeError(
      `sync-rpc-fs: read head reply is ${value.length} bytes; expected an 8-byte header`,
    );
  }
  const size = new DataView(value.buffer, value.byteOffset, READ_HEAD_HEADER_BYTES).getFloat64(
    0,
    true,
  );
  if (!Number.isSafeInteger(size) || size < 0) {
    throw new TypeError(`sync-rpc-fs: read head reply has invalid total size ${String(size)}`);
  }
  const firstChunk = value.subarray(READ_HEAD_HEADER_BYTES);
  const expectedLength = Math.min(size, FS_RPC_CHUNK);
  if (firstChunk.length !== expectedLength) {
    throw new TypeError(
      `sync-rpc-fs: read head reply body is ${firstChunk.length} bytes; expected ${expectedLength} for total size ${size}`,
    );
  }
  return { size, firstChunk };
}

/** Encode bytes to base64 (write requests; JSON-safe). */
export function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i] as number);
  return btoa(bin);
}

/** Decode base64 to bytes. */
export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
