import { describe, expect, it } from 'vitest';
import { Writable } from './writable.ts';

const tick = (ms = 10): Promise<void> => new Promise((res) => setTimeout(res, ms));

/**
 * `Writable.toWeb(w)` (Node v17) hands a Node `Writable` to a Web API as a real
 * WHATWG `WritableStream`:
 *   - each web `write(chunk)` calls `w.write` and AWAITS `'drain'` when the Node
 *     write returns false (serialized, drain-gated backpressure);
 *   - web `close()` → `w.end()`; `abort(reason)` → `w.destroy(reason)`;
 *   - `w` erroring rejects the writer's `closed`.
 *
 * `Writable.fromWeb(ws)` is the inverse: a Node `Writable` pumping into a held
 * web writer; errors propagate both ways. All probed head-to-head against real
 * Node v24.
 */
describe('Writable.toWeb', () => {
  it('returns a real WHATWG WritableStream', () => {
    const w = new Writable({
      objectMode: true,
      write(_c, _e, cb) {
        cb();
      },
    });
    const web = Writable.toWeb(w);
    expect(web).toBeInstanceOf(WritableStream);
    expect(typeof web.getWriter).toBe('function');
  });

  it('drives the Node _write in order via the web writer', async () => {
    const seen: string[] = [];
    const w = new Writable({
      objectMode: true,
      write(chunk, _e, cb) {
        seen.push(`w:${chunk}`);
        cb();
      },
    });
    const writer = Writable.toWeb(w).getWriter();
    await writer.write('a');
    await writer.write('b');
    await writer.close();
    await tick();
    expect(seen).toEqual(['w:a', 'w:b']);
  });

  it('serializes writes with backpressure: a withheld _write cb holds the next write pending', async () => {
    const order: string[] = [];
    // Holder (not a bare `let`): TS's control-flow narrows a `let` assigned only
    // inside the `write` closure to `never` at the call site below.
    const held: { cb: ((err?: Error | null) => void) | null } = { cb: null };
    const w = new Writable({
      objectMode: true,
      highWaterMark: 1,
      write(chunk, _e, cb) {
        order.push(`write:${chunk}`);
        if (chunk === 'a')
          held.cb = cb; // withhold
        else cb();
      },
    });
    const writer = Writable.toWeb(w).getWriter();
    const p1 = writer.write('a');
    await tick();
    let p2settled = false;
    const p2 = writer.write('b').then(() => {
      p2settled = true;
    });
    await tick();
    // Node's _write('b') must NOT be called yet, and p2 must be pending.
    expect(order.filter((x) => x.startsWith('write:'))).toEqual(['write:a']);
    expect(p2settled).toBe(false);
    held.cb?.();
    await p1;
    await p2;
    expect(order).toEqual(['write:a', 'write:b']);
  });

  it('rejects the writer.closed when the Node writable is destroyed with an error', async () => {
    const err = new Error('toweb-destroy');
    const w = new Writable({
      objectMode: true,
      write(_c, _e, cb) {
        cb();
      },
    });
    const writer = Writable.toWeb(w).getWriter();
    const closedRejection = writer.closed.then(
      () => 'resolved',
      (e) => e,
    );
    w.destroy(err);
    await expect(closedRejection).resolves.toBe(err);
  });

  it('web writer.abort(reason) destroys the Node writable with that reason', async () => {
    const reason = new Error('toweb-abort');
    let errEvt: unknown = null;
    const w = new Writable({
      objectMode: true,
      write(_c, _e, cb) {
        cb();
      },
    });
    w.on('error', (e) => {
      errEvt = e;
    });
    const writer = Writable.toWeb(w).getWriter();
    await writer.abort(reason);
    await tick();
    expect(w.destroyed).toBe(true);
    expect(errEvt).toBe(reason);
  });
});

describe('Writable.fromWeb', () => {
  it('returns a Node Writable whose writes reach the web sink in order, then close', async () => {
    const seen: string[] = [];
    const ws = new WritableStream({
      write(chunk) {
        seen.push(`write:${chunk}`);
      },
      close() {
        seen.push('close');
      },
    });
    const w = Writable.fromWeb(ws);
    let finished = false;
    w.on('finish', () => {
      finished = true;
    });
    w.write('a');
    w.write('b');
    w.end('c');
    await tick(30);
    expect(seen).toEqual(['write:a', 'write:b', 'write:c', 'close']);
    expect(finished).toBe(true);
  });

  it('node destroy(err) → web sink abort(reason === err)', async () => {
    const err = new Error('node-destroy');
    let abortReason: unknown = 'none';
    const ws = new WritableStream({
      write() {},
      abort(reason) {
        abortReason = reason;
      },
    });
    const w = Writable.fromWeb(ws);
    w.on('error', () => {});
    w.destroy(err);
    await tick(30);
    expect(abortReason).toBe(err);
  });

  it('web controller.error(err) → node writable emits error(err) and is destroyed', async () => {
    const err = new Error('web-error');
    let ctrl: WritableStreamDefaultController | undefined;
    const ws = new WritableStream({
      start(c) {
        ctrl = c;
      },
      write() {},
    });
    const w = Writable.fromWeb(ws);
    let nodeErr: unknown = null;
    w.on('error', (e) => {
      nodeErr = e;
    });
    ctrl?.error(err);
    await tick(30);
    expect(nodeErr).toBe(err);
    expect(w.destroyed).toBe(true);
  });

  it('throws a synchronous TypeError for a non-WHATWG argument', () => {
    expect(() => Writable.fromWeb({} as unknown as WritableStream)).toThrow(TypeError);
  });
});
