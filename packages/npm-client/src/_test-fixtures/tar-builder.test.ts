import { describe, expect, it } from 'vitest';
import { gzip } from './tar-builder.ts';

describe('tar fixture gzip', () => {
  it('[fault: frozen-assumption / provenance-lie] carries platform-neutral RFC 1952 identity', async () => {
    const source = new TextEncoder().encode('rifty canonical gzip fixture');
    const compressed = await gzip(source);

    expect([...compressed.slice(0, 10)]).toEqual([31, 139, 8, 0, 0, 0, 0, 0, 0, 255]);

    const restored = await new Response(
      new Blob([compressed as unknown as BlobPart])
        .stream()
        .pipeThrough(new DecompressionStream('gzip')),
    ).arrayBuffer();
    expect(new Uint8Array(restored)).toEqual(source);
  });
});
