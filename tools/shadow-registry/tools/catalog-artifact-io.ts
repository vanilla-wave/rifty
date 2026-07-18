import { gunzipSync } from 'node:zlib';

export interface CatalogDownloadOptions {
  readonly fetch?: (url: string, init?: RequestInit) => Promise<Response>;
  readonly maxBytes: number;
  readonly stallTimeoutMs: number;
}

export interface CatalogGunzipOptions {
  readonly maxBytes: number;
}

/** Generator-only network seam. Bounds are contract inputs; RED proves they are not enforced yet. */
export async function downloadCatalogTarball(
  url: string,
  options: CatalogDownloadOptions,
): Promise<Uint8Array> {
  const response = await (options.fetch ?? globalThis.fetch.bind(globalThis))(url);
  if (!response.ok) throw new Error(`npm tarball fetch failed: HTTP ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

/** Generator-only decompression seam. The RED contract requires streaming bounded output. */
export async function gunzipCatalogTarball(
  bytes: Uint8Array,
  _options: CatalogGunzipOptions,
): Promise<Uint8Array> {
  return new Uint8Array(gunzipSync(bytes));
}
