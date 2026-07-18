import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  downloadCatalogTarball,
  gunzipCatalogTarball,
} from '../shadow-registry/tools/catalog-artifact-io.ts';

function delayedResponse(delayMs: number): Promise<Response> {
  return new Promise((resolve) => {
    setTimeout(() => resolve(new Response(new Uint8Array([1]))), delayMs);
  });
}

describe('shadow asset catalog generator — unbounded-read fault tier', () => {
  it('rejects a stalled header wait within the configured no-progress window', async () => {
    await expect(
      downloadCatalogTarball('configured:artifact', {
        fetch: () => delayedResponse(60),
        maxBytes: 8,
        stallTimeoutMs: 10,
      }),
    ).rejects.toThrow(/no response headers for 10ms/);
  });

  it('rejects a stalled body within the configured no-progress window', async () => {
    let stream: ReadableStreamDefaultController<Uint8Array> | undefined;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        stream = controller;
      },
    });
    setTimeout(() => stream?.close(), 60);

    await expect(
      downloadCatalogTarball('configured:artifact', {
        fetch: async () => new Response(body),
        maxBytes: 8,
        stallTimeoutMs: 10,
      }),
    ).rejects.toThrow(/no body progress for 10ms/);
  });

  it('rejects compressed input above the exact policy cap while streaming', async () => {
    await expect(
      downloadCatalogTarball('configured:artifact', {
        fetch: async () => new Response(new Uint8Array(65)),
        maxBytes: 64,
        stallTimeoutMs: 1_000,
      }),
    ).rejects.toThrow(/body exceeded 64 bytes/);
  });

  it('rejects gzip expansion above the exact policy cap while streaming', async () => {
    const compressed = gzipSync(new Uint8Array(4_096));
    await expect(gunzipCatalogTarball(compressed, { maxBytes: 64 })).rejects.toThrow(
      /decompressed archive exceeded 64 bytes/,
    );
  });
});
