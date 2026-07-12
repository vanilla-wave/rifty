import { describe, expect, it } from 'vitest';
import { Buffer } from '../buffer.ts';
import { Duplex } from './duplex.ts';
import { Transform } from './transform.ts';

const tick = (ms = 30): Promise<void> => new Promise((res) => setTimeout(res, ms));

function collectToEnd(stream: Duplex, label: string): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const chunks: unknown[] = [];
    const timer = setTimeout(() => reject(new Error(`Duplex did not end: ${label}`)), 250);
    stream.on('data', (chunk) => chunks.push(chunk));
    stream.on('end', () => {
      clearTimeout(timer);
      resolve(chunks);
    });
    stream.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

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
    const d = new Duplex({
      read() {},
      write(_c, _e, cb) {
        cb();
      },
    });
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
    const d = new Transform({
      objectMode: true,
      transform(c, _e, cb) {
        cb(null, `T:${c}`);
      },
    });
    const pair = Duplex.toWeb(d);
    expect(Object.keys(pair).sort()).toEqual(['readable', 'writable']);
    expect(pair.readable).toBeInstanceOf(ReadableStream);
    expect(pair.writable).toBeInstanceOf(WritableStream);
  });

  it('round-trips: writing to the web writable drains out of the web readable', async () => {
    const d = new Transform({
      objectMode: true,
      transform(c, _e, cb) {
        cb(null, `T:${c}`);
      },
    });
    const pair = Duplex.toWeb(d);
    const writer = pair.writable.getWriter();
    const reader = pair.readable.getReader();
    await writer.write('a');
    const r1 = await reader.read();
    expect(r1.value).toBe('T:a');
  });

  it('rejects pending web writes when the Duplex is destroyed without an error', async () => {
    const held: { cb: ((err?: Error | null) => void) | null } = { cb: null };
    const d = new Duplex({
      objectMode: true,
      highWaterMark: 1,
      read() {},
      write(_chunk, _e, cb) {
        held.cb = cb;
      },
    });
    const pair = Duplex.toWeb(d);
    const writer = pair.writable.getWriter();
    const pending = writer.write('a');
    await tick();

    d.destroy();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError', code: 'ABORT_ERR' });
    held.cb?.();
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

  it('normalizes a byte-mode web string to a UTF-8 Buffer', async () => {
    const readable = new ReadableStream({
      start(controller) {
        controller.enqueue('é');
        controller.close();
      },
    });
    const d = Duplex.fromWeb({ readable, writable: new WritableStream() });
    const chunks = await collectToEnd(d, 'fromWeb byte string');

    expect(chunks).toHaveLength(1);
    expect(Buffer.isBuffer(chunks[0])).toBe(true);
    expect(Buffer.from(chunks[0] as Uint8Array).toString('hex')).toBe('c3a9');
    expect(String(chunks[0])).toBe('é');
  });

  it('throws a synchronous TypeError for a non-WHATWG argument', () => {
    expect(() =>
      Duplex.fromWeb(42 as unknown as { readable: ReadableStream; writable: WritableStream }),
    ).toThrow(TypeError);
    expect(() =>
      Duplex.fromWeb({ readable: {}, writable: {} } as unknown as {
        readable: ReadableStream;
        writable: WritableStream;
      }),
    ).toThrow(TypeError);
  });
});

describe('Duplex.from', () => {
  it('ReadableStream source emits string chunks as Buffers like Node', async () => {
    const d = Duplex.from(
      new ReadableStream({
        start(controller) {
          controller.enqueue('é');
          controller.close();
        },
      }),
    );
    const chunks = await collectToEnd(d, 'from ReadableStream byte string');

    expect(chunks).toHaveLength(1);
    expect(Buffer.isBuffer(chunks[0])).toBe(true);
    expect(Buffer.from(chunks[0] as Uint8Array).toString('hex')).toBe('c3a9');
    expect(String(chunks[0])).toBe('é');
  });
});
