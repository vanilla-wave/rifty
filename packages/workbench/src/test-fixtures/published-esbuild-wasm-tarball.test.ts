import { describe, expect, it } from 'vitest';
import {
  assertPublishedEsbuildWasmTarballIntegrity,
  publishedEsbuildWasmTarball,
} from './published-esbuild-wasm-tarball.ts';

describe('published esbuild-wasm tarball fixture', () => {
  it('rejects bytes that do not carry the catalog-pinned upstream identity', async () => {
    const tampered = await publishedEsbuildWasmTarball();
    const lastIndex = tampered.byteLength - 1;
    const lastByte = tampered[lastIndex];
    if (lastByte === undefined) throw new Error('Vendored tarball is empty');
    tampered[lastIndex] = lastByte ^ 1;

    expect(() => assertPublishedEsbuildWasmTarballIntegrity(tampered)).toThrow(
      /tarball integrity mismatch/,
    );
  });

  it('returns isolated canonical bytes', async () => {
    const first = await publishedEsbuildWasmTarball();
    const second = await publishedEsbuildWasmTarball();
    const canonicalFirstByte = second[0];
    if (canonicalFirstByte === undefined) throw new Error('Vendored tarball is empty');
    first[0] = canonicalFirstByte ^ 0xff;

    expect(first).not.toBe(second);
    expect(second[0]).toBe(canonicalFirstByte);
    expect(() => assertPublishedEsbuildWasmTarballIntegrity(second)).not.toThrow();
  });
});
