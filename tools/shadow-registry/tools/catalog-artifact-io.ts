import { Readable, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';

export interface CatalogDownloadOptions {
  readonly fetch?: (url: string, init?: RequestInit) => Promise<Response>;
  readonly maxBytes: number;
  readonly stallTimeoutMs: number;
}

export interface CatalogGunzipOptions {
  readonly maxBytes: number;
}

function assertPositiveSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive safe integer`);
  }
}

async function fetchHeadersBounded(
  url: string,
  options: CatalogDownloadOptions,
): Promise<Response> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  const attempt = (options.fetch ?? globalThis.fetch.bind(globalThis))(url, {
    signal: controller.signal,
  });
  attempt.catch(() => undefined);
  void attempt.then(
    (response) => {
      if (timedOut) void response.body?.cancel().catch(() => undefined);
    },
    () => undefined,
  );
  try {
    return await Promise.race([
      attempt,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          timedOut = true;
          controller.abort();
          reject(
            new Error(
              `shadow asset catalog tarball: no response headers for ${options.stallTimeoutMs}ms`,
            ),
          );
        }, options.stallTimeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** Generator-only network chokepoint: header/body no-progress plus compressed cap. */
export async function downloadCatalogTarball(
  url: string,
  options: CatalogDownloadOptions,
): Promise<Uint8Array> {
  if (typeof url !== 'string' || url.length === 0)
    throw new TypeError('catalog tarball URL is invalid');
  assertPositiveSafeInteger(options.maxBytes, 'catalog tarball maxBytes');
  assertPositiveSafeInteger(options.stallTimeoutMs, 'catalog tarball stallTimeoutMs');
  const response = await fetchHeadersBounded(url, options);
  if (!response.ok) {
    void response.body?.cancel().catch(() => undefined);
    throw new Error(`npm tarball fetch failed: HTTP ${response.status}`);
  }
  const body = response.body;
  if (!body) return new Uint8Array();
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const read = reader.read();
      read.catch(() => undefined);
      const next = await Promise.race([
        read,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () =>
              reject(
                new Error(
                  `shadow asset catalog tarball: no body progress for ${options.stallTimeoutMs}ms`,
                ),
              ),
            options.stallTimeoutMs,
          );
        }),
      ]).finally(() => clearTimeout(timer));
      if (next.done) break;
      total += next.value.byteLength;
      if (total > options.maxBytes) {
        throw new Error(`shadow asset catalog tarball: body exceeded ${options.maxBytes} bytes`);
      }
      chunks.push(next.value);
    }
  } catch (error) {
    void reader.cancel().catch(() => undefined);
    throw error;
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/** Generator-only decompression chokepoint: output is never retained above the policy cap. */
export async function gunzipCatalogTarball(
  bytes: Uint8Array,
  options: CatalogGunzipOptions,
): Promise<Uint8Array> {
  if (!(bytes instanceof Uint8Array)) throw new TypeError('catalog tarball must be Uint8Array');
  assertPositiveSafeInteger(options.maxBytes, 'catalog archive maxBytes');
  const chunks: Uint8Array[] = [];
  let total = 0;
  const sink = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      total += chunk.byteLength;
      if (total > options.maxBytes) {
        callback(new Error(`decompressed archive exceeded ${options.maxBytes} bytes`));
        return;
      }
      chunks.push(Uint8Array.from(chunk));
      callback();
    },
  });
  await pipeline(Readable.from([bytes]), createGunzip(), sink);
  const unpacked = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    unpacked.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return unpacked;
}
