/**
 * Tests for streaming `ServerResponse`.
 *
 * Item 5 (2026-05-25 review): `write()` must honor `desiredSize` — when the
 * downstream reader is slow and the controller's queue fills, the writer
 * should pause until `pull()` is invoked by the consumer.
 */

import { describe, expect, it } from 'vitest';
import { ServerResponse } from './response.ts';

describe('ServerResponse — backpressure (Item 5)', () => {
  it('pauses write() when desiredSize <= 0 and resumes on pull()', async () => {
    const res = new ServerResponse();
    res.writeHead(200, { 'content-type': 'text/plain' });
    // First write flushes headers AND enqueues chunk 0.  Default
    // ReadableStream highWaterMark is 1, so after the first enqueue desired
    // drops to 0 and subsequent writes must NOT resolve until the reader
    // pulls.
    const first = res.write('x0');
    expect(first).toBe(true);
    const response = await res.toResponse();
    const reader = response.body!.getReader();

    const writeOrder: number[] = [];
    const pendingWrites: Promise<void>[] = [];

    // Issue 4 more writes back-to-back; the queue is now full (desiredSize
    // was 0 going into each), so each must return a Promise that awaits a
    // future `pull()`.
    for (let i = 1; i < 5; i++) {
      pendingWrites.push(
        (async () => {
          await Promise.resolve(res.write(`x${i}`));
          writeOrder.push(i);
        })(),
      );
    }

    // Microtask flush — but the consumer has NOT read yet. None of the 4
    // backpressured writes can complete.
    await new Promise<void>((r) => setTimeout(r, 20));
    expect(writeOrder.length).toBe(0);

    // Drain the reader; the writes must complete now.
    const seen: string[] = [];
    const dec = new TextDecoder();
    const drainP = (async () => {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) seen.push(dec.decode(value));
      }
    })();

    // Once reads start, all backpressured writes should complete.
    await Promise.all(pendingWrites);
    res.end();
    await drainP;

    expect(writeOrder).toEqual([1, 2, 3, 4]);
    expect(seen.join('')).toBe('x0x1x2x3x4');
  });

  it('write() returns true synchronously when the queue has room', () => {
    // When the queue still has room (initial state, desiredSize = 1), write()
    // should be synchronous — no pending promise needed.
    const res = new ServerResponse();
    res.writeHead(200, {});
    const ret = res.write('first');
    expect(ret).toBe(true);
  });
});
