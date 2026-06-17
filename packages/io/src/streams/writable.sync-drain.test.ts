/**
 * Perf-guard #25 (perf audit 2026-06-05): the `Writable` sync-drain loop
 * (`drainBuffer`) processes synchronously-completing chunks in one tick instead
 * of one-chunk-per-microtask. These pin the three failure modes the collapsed
 * loop must still get right — the destroy/error/re-entrancy interleavings where
 * a naive in-tick loop would drop callbacks, swallow errors, or double-drain.
 *
 * Hand-written assertions on callback-error identity + chunk order are justified:
 * each pins a specific interleaving a parity test could not isolate.
 */
import { describe, expect, it } from 'vitest';
import { Writable } from './writable.ts';

describe('Writable sync-drain edges (#25)', () => {
  it('calls subclass _write() when opts.write is absent', async () => {
    class Sink extends Writable {
      readonly chunks: string[] = [];

      override _write(chunk: unknown, _encoding: string, cb: (err?: Error | null) => void): void {
        this.chunks.push(String(chunk));
        cb();
      }
    }

    const sink = new Sink();
    sink.write('a');
    sink.write('b');
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(sink.chunks).toEqual(['a', 'b']);
  });

  it('(a) destroy(err) from inside _write errors the still-queued chunks and stops further _write', async () => {
    const boom = new Error('boom');
    const writeOrder: string[] = [];
    const cbErrors = new Map<string, Error | null | undefined>();

    const w = new Writable({
      highWaterMark: 1, // every write past the first overflows -> all queue
      write(chunk, _enc, cb) {
        const tag = String(chunk);
        writeOrder.push(tag);
        if (tag === 'c1') {
          // Destroy mid-write with chunks c2/c3 still queued. destroy() snapshots
          // the queue and errors those callbacks on the next microtask.
          this.destroy(boom);
        }
        cb();
      },
    });
    // destroy(err) emits 'error' on the next tick; attach a listener so the
    // Node contract (unhandled 'error' throws) doesn't surface as a stray throw.
    let emittedError: unknown;
    w.on('error', (e) => {
      emittedError = e;
    });

    w.write('c1', undefined, (e) => cbErrors.set('c1', e));
    w.write('c2', undefined, (e) => cbErrors.set('c2', e));
    w.write('c3', undefined, (e) => cbErrors.set('c3', e));

    // Let the drain microtask + destroy's deferred callback-erroring run.
    await new Promise<void>((r) => setTimeout(r, 0));

    // Only c1's _write ran — destroy halts the loop before c2/c3 are written.
    expect(writeOrder).toEqual(['c1']);
    // The still-queued chunks' callbacks receive the destroy error (not dropped,
    // not a success); c1 (the in-flight chunk) also errors via the destroyed
    // branch of its own `done`.
    expect(cbErrors.get('c2')).toBe(boom);
    expect(cbErrors.get('c3')).toBe(boom);
    expect(cbErrors.get('c1')).toBe(boom);
    // destroy(err) also surfaces the error on the stream.
    expect(emittedError).toBe(boom);
  });

  it('(b) a synchronously-erroring _write stops the drain loop and surfaces the error (no silent continue)', async () => {
    const fail = new Error('write-failed');
    const writeOrder: string[] = [];
    const cbErrors = new Map<string, Error | null | undefined>();
    let emittedError: unknown;

    const w = new Writable({
      highWaterMark: 1,
      write(chunk, _enc, cb) {
        const tag = String(chunk);
        writeOrder.push(tag);
        // c1 fails synchronously; c2 is queued behind it.
        cb(tag === 'c1' ? fail : undefined);
      },
    });
    w.on('error', (e) => {
      emittedError = e;
    });

    w.write('c1', undefined, (e) => cbErrors.set('c1', e));
    w.write('c2', undefined, (e) => cbErrors.set('c2', e));

    await new Promise<void>((r) => setTimeout(r, 0));

    // The loop STOPS after the erroring chunk — c2 is NOT drained behind it.
    expect(writeOrder).toEqual(['c1']);
    // The error surfaces: the failing chunk's cb gets it AND 'error' is emitted.
    expect(cbErrors.get('c1')).toBe(fail);
    expect(emittedError).toBe(fail);
    // c2 stays queued (its cb never fired) — the loop did not silently continue.
    expect(cbErrors.has('c2')).toBe(false);
  });

  it('(c) a re-entrant write() from within a _write is buffered and drained, not lost or double-drained', async () => {
    const writeOrder: string[] = [];
    const completed: string[] = [];
    let reentered = false;

    const w = new Writable({
      highWaterMark: 1024,
      write(chunk, _enc, cb) {
        const tag = String(chunk);
        writeOrder.push(tag);
        if (tag === 'first' && !reentered) {
          reentered = true;
          // Re-entrant write from inside the _write of `first`. Must be buffered
          // and picked up by the SAME in-tick drain loop, not lost.
          w.write('reentrant', undefined, () => completed.push('reentrant-cb'));
        }
        cb();
      },
    });

    w.write('first', undefined, () => completed.push('first-cb'));

    await new Promise<void>((r) => setTimeout(r, 0));

    // Re-entrant chunk fired EXACTLY once (no double-drain), after `first`.
    expect(writeOrder).toEqual(['first', 'reentrant']);
    expect(writeOrder.filter((t) => t === 'reentrant')).toHaveLength(1);
    // Both callbacks fired — the re-entrant write was not lost.
    expect(completed.sort()).toEqual(['first-cb', 'reentrant-cb']);
  });
});
