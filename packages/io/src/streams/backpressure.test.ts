import { describe, expect, it } from 'vitest';
import { Readable } from './readable.ts';
import { Writable } from './writable.ts';

describe('Writable backpressure', () => {
  it("returns false past HWM, then emits 'drain' once the buffer dips", async () => {
    const w = new Writable({
      highWaterMark: 4,
      write(_chunk, _enc, cb) {
        // Slow drain — let the queue back up before draining.
        queueMicrotask(cb);
      },
    });
    // First write — buffer length grows to 5 (chunkSize of 5 chars). HWM is 4,
    // so write() returns false.
    const ok = w.write('hello');
    expect(ok).toBe(false);
    await new Promise<void>((resolve) => w.once('drain', () => resolve()));
    // Once we received 'drain', a subsequent small write must return true.
    expect(w.write('x')).toBe(true);
  });

  it("does NOT emit 'drain' for writes that stayed below HWM", async () => {
    const w = new Writable({
      highWaterMark: 1024,
      write(_chunk, _enc, cb) {
        cb();
      },
    });
    let drained = false;
    w.on('drain', () => {
      drained = true;
    });
    expect(w.write('small')).toBe(true);
    // Give the microtask queue time to flush any spurious 'drain'.
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    expect(drained).toBe(false);
  });
});

describe('Readable pause/resume', () => {
  it('pause() suspends data flow; resume() restarts it', async () => {
    const r = new Readable({ objectMode: true });
    const seen: unknown[] = [];
    r.on('data', (chunk) => seen.push(chunk));
    r.push(1);
    r.push(2);
    // Pause synchronously before the next microtask flushes.
    r.pause();
    // Microtasks flush — paused, so nothing should fire yet from the second
    // batch we push below.
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    r.push(3);
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    // Note: data pushed before pause may have been emitted already; we only
    // assert that post-pause pushes are queued, not delivered.
    const seenBeforeResume = seen.length;
    r.resume();
    r.push(null);
    await new Promise<void>((resolve) => r.on('end', () => resolve()));
    expect(seen).toEqual([1, 2, 3]);
    expect(seenBeforeResume).toBeLessThan(3);
  });

  it("push(null) ends the stream and emits 'end'", async () => {
    const r = new Readable({ objectMode: true });
    const seen: unknown[] = [];
    r.on('data', (chunk) => seen.push(chunk));
    r.push('a');
    r.push(null);
    await new Promise<void>((resolve) => r.on('end', () => resolve()));
    expect(seen).toEqual(['a']);
  });
});
