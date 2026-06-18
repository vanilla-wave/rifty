/**
 * Tests for streaming `ServerResponse`.
 *
 * Item 5 (2026-05-25 review): `write()` must honor `desiredSize` — when the
 * downstream reader is slow and the controller's queue fills, the writer
 * should pause until `pull()` is invoked by the consumer.
 */

import { Buffer, Readable } from '@riftydev/io';
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

describe("ServerResponse — Node-style 'drain' (F05-T3, Q-2026-05-30-102)", () => {
  it('emits drain after a backpressured write resolves on pull()', async () => {
    // Effect's @effect/platform-node streaming write loop parks on
    // res.on('drain') and ignores write()'s return value. rifty signals
    // backpressure only via the write() Promise; this test asserts the
    // additive Node-style 'drain' event fires when the reader pulls room back.
    const res = new ServerResponse();
    res.writeHead(200, { 'content-type': 'text/plain' });

    // First write flushes headers and enqueues chunk 0. Default HWM=1 means
    // desiredSize drops to 0 afterwards, so the queue is now full.
    expect(res.write('x0')).toBe(true);

    const drainOrder: string[] = [];
    res.on('drain', () => drainOrder.push('drain'));

    // Second write is backpressured (desiredSize <= 0): returns a Promise that
    // resolves on the next pull(). No 'drain' may fire yet — the reader has
    // not pulled.
    const second = res.write('x1');
    expect(typeof (second as Promise<boolean>).then).toBe('function');

    // Give microtasks a chance; with no reader, no pull() fires => no 'drain'.
    await new Promise<void>((r) => setTimeout(r, 20));
    expect(drainOrder).toEqual([]);

    // Now start reading the body — this drives pull(), unblocks the parked
    // write, and must emit exactly one 'drain'. Reading runs concurrently so
    // the pull() that resolves the parked write actually fires.
    const response = await res.toResponse();
    const reader = response.body!.getReader();
    const drainP = (async () => {
      for (;;) {
        const { done } = await reader.read();
        if (done) break;
      }
    })();

    await second; // the backpressured write resolves once the reader pulls
    drainOrder.push('write-resolved');

    // Drain the rest so the body can close cleanly.
    res.end();
    await drainP;

    // 'drain' fired exactly once, and it fired on/before the pull that
    // unblocked the write (i.e. it is present, ahead of write-resolved or
    // interleaved with it — the key assertion is exactly-once and that it
    // appeared as a result of the reader pulling).
    expect(drainOrder.filter((e) => e === 'drain')).toEqual(['drain']);
    // The drain event must have been observed as part of the pull cycle that
    // resolved the parked write — so it precedes the 'write-resolved' marker.
    expect(drainOrder.indexOf('drain')).toBeLessThan(drainOrder.indexOf('write-resolved'));
  });

  it('does NOT emit drain when no write was backpressured', async () => {
    // A single small write into an empty HWM=1 queue is NOT backpressured
    // (desiredSize was 1 going in), so write() returns true synchronously and
    // no 'drain' must ever fire — even though pull() will run as the reader
    // consumes the body.
    const res = new ServerResponse();
    res.writeHead(200, { 'content-type': 'text/plain' });

    let drains = 0;
    res.on('drain', () => {
      drains++;
    });

    expect(res.write('only')).toBe(true);
    res.end();

    const response = await res.toResponse();
    const reader = response.body!.getReader();
    for (;;) {
      const { done } = await reader.read();
      if (done) break;
    }
    // Let any stray microtask-scheduled emits settle.
    await new Promise<void>((r) => setTimeout(r, 20));

    expect(drains).toBe(0);
  });
});

describe('ServerResponse — pipe sink for Readable.fromWeb', () => {
  it('serves a WHATWG stream piped through the Node Readable adapter', async () => {
    const res = new ServerResponse();
    res.writeHead(200, { 'content-type': 'text/plain' });
    const web = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(Buffer.from('web-'));
        controller.enqueue(Buffer.from('stream'));
        controller.close();
      },
    });

    Readable.fromWeb(web).pipe(res);

    const response = await res.toResponse();
    expect(await response.text()).toBe('web-stream');
  });
});
