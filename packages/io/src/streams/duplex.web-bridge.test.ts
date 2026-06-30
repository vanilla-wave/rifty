import { describe, expect, it } from 'vitest';
import { Duplex } from './duplex.ts';
import { Transform } from './transform.ts';

const tick = (ms = 30): Promise<void> => new Promise((res) => setTimeout(res, ms));

/**
 * `Duplex.toWeb(d)` → `{ readable, writable }` (Node v17); `Duplex.fromWeb(pair)`
 * composes a Node `Duplex` over a `{ readable, writable }` WHATWG pair.
 *
 * Probed head-to-head against real Node v24:
 *   - a bare `new Duplex()` defaults `allowHalfOpen === true`;
 *   - `Duplex.fromWeb` deliberately defaults `allowHalfOpen === false` (the
 *     OPPOSITE), `{ allowHalfOpen: true }` honored;
 *   - a non-WHATWG arg → synchronous TypeError.
 */
describe('Duplex allowHalfOpen', () => {
  it('defaults allowHalfOpen to true for a bare Duplex (Node parity)', () => {
    const d = new Duplex({ read() {}, write(_c, _e, cb) { cb(); } });
    expect(d.allowHalfOpen).toBe(true);
  });

  it('honors allowHalfOpen:false and auto-ends the writable when the readable ends', async () => {
    const d = new Duplex({
      allowHalfOpen: false,
      objectMode: true,
      read() {},
      write(_c, _e, cb) {
        cb();
      },
    });
    const events: string[] = [];
    d.on('end', () => events.push('end'));
    d.on('finish', () => events.push('finish'));
    d.resume();
    d.push('r1');
    d.push(null); // end the readable side
    await tick();
    expect(events).toEqual(['end', 'finish']);
    expect(d.writableEnded).toBe(true);
  });

  it('leaves the writable open when the readable ends with allowHalfOpen:true', async () => {
    const d = new Duplex({
      allowHalfOpen: true,
      objectMode: true,
      read() {},
      write(_c, _e, cb) {
        cb();
      },
    });
    const events: string[] = [];
    d.on('end', () => events.push('end'));
    d.on('finish', () => events.push('finish'));
    d.resume();
    d.push('r1');
    d.push(null);
    await tick();
    expect(events).toEqual(['end']);
    expect(d.writableEnded).toBe(false);
  });
});

describe('Duplex.toWeb', () => {
  it('returns an object with both a readable ReadableStream and writable WritableStream', () => {
    const d = new Transform({ objectMode: true, transform(c, _e, cb) { cb(null, `T:${c}`); } });
    const pair = Duplex.toWeb(d);
    expect(Object.keys(pair).sort()).toEqual(['readable', 'writable']);
    expect(pair.readable).toBeInstanceOf(ReadableStream);
    expect(pair.writable).toBeInstanceOf(WritableStream);
  });

  it('round-trips: writing to the web writable drains out of the web readable', async () => {
    const d = new Transform({ objectMode: true, transform(c, _e, cb) { cb(null, `T:${c}`); } });
    const pair = Duplex.toWeb(d);
    const writer = pair.writable.getWriter();
    const reader = pair.readable.getReader();
    await writer.write('a');
    const r1 = await reader.read();
    expect(r1.value).toBe('T:a');
  });
});

describe('Duplex.fromWeb', () => {
  it('composes a Duplex over a WHATWG pair (instanceof Duplex)', () => {
    const readable = new ReadableStream({
      start(c) {
        c.enqueue('x');
        c.close();
      },
    });
    const writable = new WritableStream({ write() {} });
    const d = Duplex.fromWeb({ readable, writable });
    expect(d).toBeInstanceOf(Duplex);
  });

  it('defaults allowHalfOpen to false (the OPPOSITE of a bare Duplex)', () => {
    const readable = new ReadableStream({
      start(c) {
        c.close();
      },
    });
    const writable = new WritableStream({ write() {} });
    const d = Duplex.fromWeb({ readable, writable });
    expect(d.allowHalfOpen).toBe(false);
  });

  it('honors an explicit allowHalfOpen:true', () => {
    const readable = new ReadableStream({
      start(c) {
        c.close();
      },
    });
    const writable = new WritableStream({ write() {} });
    const d = Duplex.fromWeb({ readable, writable }, { allowHalfOpen: true });
    expect(d.allowHalfOpen).toBe(true);
  });

  it('round-trips: writes reach the web sink and web-readable chunks emit as data', async () => {
    const seenWrites: string[] = [];
    const writable = new WritableStream({
      write(chunk) {
        seenWrites.push(`w:${chunk}`);
      },
    });
    let rctrl: ReadableStreamDefaultController | undefined;
    const readable = new ReadableStream({
      start(c) {
        rctrl = c;
      },
    });
    const d = Duplex.fromWeb({ readable, writable }, { objectMode: true });
    const out: string[] = [];
    d.on('data', (c) => out.push(`d:${c}`));
    d.write('hi');
    rctrl?.enqueue('yo');
    await tick();
    expect(seenWrites).toEqual(['w:hi']);
    expect(out).toEqual(['d:yo']);
  });

  it('throws a synchronous TypeError for a non-WHATWG argument', () => {
    expect(() => Duplex.fromWeb(42 as unknown as { readable: ReadableStream; writable: WritableStream })).toThrow(
      TypeError,
    );
    expect(() =>
      Duplex.fromWeb({ readable: {}, writable: {} } as unknown as {
        readable: ReadableStream;
        writable: WritableStream;
      }),
    ).toThrow(TypeError);
  });
});
