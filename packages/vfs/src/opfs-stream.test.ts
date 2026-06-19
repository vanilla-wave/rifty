/**
 * Unit coverage for the OPFS chunked-stream builder (`chunkedFileStream`), the
 * read path behind `OpfsVfs.openReadable`. OPFS itself is unavailable in Node,
 * but the chunking/slicing logic operates on any `Blob`, so it is exercised here
 * head-to-head with the documented half-open `[start, end)` contract.
 */
import { describe, expect, it } from 'vitest';
import { chunkedFileStream } from './opfs.ts';

async function drain(stream: ReadableStream<Uint8Array>): Promise<Uint8Array[]> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  return chunks;
}

const join = (chunks: Uint8Array[]): string =>
  chunks.map((c) => new TextDecoder().decode(c)).join('');

describe('chunkedFileStream', () => {
  it('emits the whole blob in chunkSize-sized pieces', async () => {
    const file = new Blob(['abcdef']);
    const chunks = await drain(chunkedFileStream(file, { chunkSize: 2 }));
    expect(chunks.map((c) => c.length)).toEqual([2, 2, 2]);
    expect(join(chunks)).toBe('abcdef');
  });

  it('applies the half-open [start, end) window', async () => {
    const file = new Blob(['abcdef']);
    const chunks = await drain(chunkedFileStream(file, { chunkSize: 2, start: 1, end: 5 }));
    expect(join(chunks)).toBe('bcde');
  });

  it('clamps end past the blob size (no trailing empty chunks)', async () => {
    const file = new Blob(['abc']);
    const chunks = await drain(chunkedFileStream(file, { chunkSize: 2, end: 100 }));
    expect(chunks.every((c) => c.length > 0)).toBe(true);
    expect(join(chunks)).toBe('abc');
  });

  it('yields no chunks for an empty range', async () => {
    const file = new Blob(['abc']);
    const chunks = await drain(chunkedFileStream(file, { start: 2, end: 2 }));
    expect(chunks).toEqual([]);
  });
});
