import { afterEach, describe, expect, it, vi } from 'vitest';
import { drainByteStreamBounded, fetchAssetBytesBounded } from './bounded-asset-fetch.ts';

afterEach(() => vi.useRealTimers());

describe('bounded static-asset acquisition — unbounded-read fault tier', () => {
  it('rejects a stalled header phase and aborts the fetch', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const read = fetchAssetBytesBounded('/asset', {
      label: 'fixture asset',
      headerTimeoutMs: 25,
      fetchImpl: (_url, init) => {
        signal = init?.signal ?? undefined;
        return new Promise<Response>(() => {});
      },
    });
    read.catch(() => {});
    await vi.advanceTimersByTimeAsync(26);
    await expect(read).rejects.toThrow('fixture asset: no response headers for 25ms');
    expect(signal?.aborted).toBe(true);
  });

  it('rejects a body that stops making progress', async () => {
    vi.useFakeTimers();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1]));
      },
    });
    const read = drainByteStreamBounded(stream, {
      label: 'fixture asset',
      stallTimeoutMs: 25,
      maxBytes: 10,
    });
    read.catch(() => {});
    await vi.advanceTimersByTimeAsync(26);
    await expect(read).rejects.toThrow('fixture asset: no body progress for 25ms');
  });

  it('rejects declared and streamed bodies beyond the byte cap', async () => {
    await expect(
      fetchAssetBytesBounded('/asset', {
        label: 'declared asset',
        maxBytes: 3,
        fetchImpl: async () => new Response(null, { headers: { 'content-length': '4' } }),
      }),
    ).rejects.toThrow('declared asset: body exceeded 3 bytes');

    await expect(
      drainByteStreamBounded(
        new Blob([new Uint8Array([1, 2, 3, 4])]).stream() as ReadableStream<Uint8Array>,
        { label: 'streamed asset', maxBytes: 3 },
      ),
    ).rejects.toThrow('streamed asset: body exceeded 3 bytes');
  });

  it('settles cancellation before exposing a bounded stream failure', async () => {
    let announceCancellation!: () => void;
    const cancellationStarted = new Promise<void>((resolve) => {
      announceCancellation = resolve;
    });
    let finishCancellation!: () => void;
    const cancellationFinished = new Promise<void>((resolve) => {
      finishCancellation = resolve;
    });
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2]));
      },
      cancel() {
        announceCancellation();
        return cancellationFinished;
      },
    });
    const read = drainByteStreamBounded(stream, {
      label: 'cancellation asset',
      maxBytes: 1,
    });
    let settled = false;
    void read.catch(() => {
      settled = true;
    });

    await cancellationStarted;
    await Promise.resolve();
    expect(settled).toBe(false);
    finishCancellation();
    await expect(read).rejects.toThrow('cancellation asset: body exceeded 1 bytes');
  });

  it('concatenates a bounded progressing body exactly', async () => {
    const bytes = await fetchAssetBytesBounded('/asset', {
      label: 'fixture asset',
      maxBytes: 4,
      fetchImpl: async () => new Response(new Uint8Array([1, 2, 3, 4])),
    });
    expect([...bytes]).toEqual([1, 2, 3, 4]);
  });
});
