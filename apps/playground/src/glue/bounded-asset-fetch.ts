/** One static-asset boundary for header/body stalls and runaway bytes. */

export const DEFAULT_ASSET_STALL_MS = 10_000;
/** Covers the largest decoded baked snapshot (~71 MiB); rejects runaway assets. */
export const DEFAULT_ASSET_MAX_BYTES = 128 * 1024 * 1024;

export interface ByteStreamBounds {
  readonly label: string;
  readonly stallTimeoutMs?: number;
  readonly maxBytes?: number;
}

export interface AssetFetchOptions extends ByteStreamBounds {
  readonly headerTimeoutMs?: number;
  readonly fetchImpl?: (input: string | URL, init?: RequestInit) => Promise<Response>;
}

function positiveBound(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${label} must be positive`);
  return value;
}

async function waitForHeaders(
  url: string | URL,
  options: AssetFetchOptions,
  controller: AbortController,
): Promise<Response> {
  const timeoutMs = positiveBound(
    options.headerTimeoutMs ?? DEFAULT_ASSET_STALL_MS,
    'asset header timeout',
  );
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const attempt = fetchImpl(url, { signal: controller.signal });
  attempt.catch(() => {});
  try {
    return await Promise.race([
      attempt,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error(`${options.label}: no response headers for ${timeoutMs}ms`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** Buffer a byte stream under a per-chunk no-progress timeout and byte cap. */
export async function drainByteStreamBounded(
  stream: ReadableStream<Uint8Array> | null,
  bounds: ByteStreamBounds,
): Promise<Uint8Array<ArrayBuffer>> {
  if (stream === null) return new Uint8Array();
  const timeoutMs = positiveBound(
    bounds.stallTimeoutMs ?? DEFAULT_ASSET_STALL_MS,
    'asset body timeout',
  );
  const maxBytes = positiveBound(bounds.maxBytes ?? DEFAULT_ASSET_MAX_BYTES, 'asset byte cap');
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const read = reader.read();
      read.catch(() => {});
      const next = await Promise.race([
        read,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`${bounds.label}: no body progress for ${timeoutMs}ms`)),
            timeoutMs,
          );
        }),
      ]).finally(() => clearTimeout(timer));
      if (next.done) break;
      if (!(next.value instanceof Uint8Array)) {
        throw new Error(`${bounds.label}: response body produced a non-byte chunk`);
      }
      total += next.value.byteLength;
      if (total > maxBytes) {
        throw new Error(`${bounds.label}: body exceeded ${maxBytes} bytes`);
      }
      chunks.push(next.value);
    }
  } catch (error) {
    void reader.cancel().catch(() => {});
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

/** Fetch a same-origin static asset without an unbounded wait or buffer. */
export async function fetchAssetBytesBounded(
  url: string | URL,
  options: AssetFetchOptions,
): Promise<Uint8Array<ArrayBuffer>> {
  const controller = new AbortController();
  const maxBytes = positiveBound(options.maxBytes ?? DEFAULT_ASSET_MAX_BYTES, 'asset byte cap');
  const response = await waitForHeaders(url, options, controller);
  if (!response.ok) {
    void response.body?.cancel().catch(() => {});
    throw new Error(`${options.label}: HTTP ${response.status}`);
  }
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    void response.body?.cancel().catch(() => {});
    throw new Error(`${options.label}: body exceeded ${maxBytes} bytes`);
  }
  try {
    return await drainByteStreamBounded(response.body, { ...options, maxBytes });
  } catch (error) {
    controller.abort();
    throw error;
  }
}
