/**
 * Shared `fs.*` sync-RPC protocol (ADR-0150 D P6a). Owner serves these methods
 * on the kernel dispatcher; the child's SyncRpcFsSync calls them. Reads/writes
 * chunk under the 1 MiB SAB ring (ADR-0084 #19): read replies are raw bytes
 * (binary frame), write requests carry base64 in JSON (the request frame is
 * JSON-only, ADR-0032).
 */

/** Raw bytes per chunk. 256 KiB → ~342 KiB base64; + JSON framing < 1 MiB. */
export const FS_RPC_CHUNK = 256 * 1024;

export const FS_METHODS = {
  exists: 'fs.exists',
  stat: 'fs.stat',
  statOrNull: 'fs.statOrNull',
  readdir: 'fs.readdir',
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
