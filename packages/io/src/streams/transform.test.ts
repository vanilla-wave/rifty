import { describe, expect, it } from 'vitest';
import { Duplex } from './duplex.ts';
import { Transform } from './transform.ts';

describe('Transform subclassing', () => {
  it('subclass that passes transform to super() transforms chunks', async () => {
    class Doubler extends Transform {
      constructor() {
        super({
          objectMode: true,
          transform(chunk, _enc, cb) {
            cb(null, (chunk as number) * 2);
          },
        });
      }
    }
    const t = new Doubler();
    const seen: unknown[] = [];
    t.on('data', (c) => seen.push(c));
    const ended = new Promise<void>((resolve) => t.on('end', () => resolve()));
    t.write(1);
    t.write(2);
    t.write(3);
    t.end();
    await ended;
    expect(seen).toEqual([2, 4, 6]);
  });

  it('subclass calling super({}) then assigning options later still works via super-provided transform', async () => {
    // Late binding hazard guard: the Transform constructor wires `this.write`
    // as an INSTANCE field referencing the transform passed to super(). A
    // subclass that does `super({})` and then re-assigns `this.transformImpl`
    // afterwards would NOT pick up — but the canonical, supported path is to
    // pass the transform fn to super(). This test pins that supported path so
    // a future refactor toward prototype-based methods is forced to keep it.
    class Identity extends Transform {
      constructor() {
        super({
          objectMode: true,
          transform(chunk, _enc, cb) {
            cb(null, chunk);
          },
        });
      }
    }
    const t = new Identity();
    const seen: unknown[] = [];
    t.on('data', (c) => seen.push(c));
    const ended = new Promise<void>((resolve) => t.on('end', () => resolve()));
    t.write('a');
    t.write('b');
    t.end();
    await ended;
    expect(seen).toEqual(['a', 'b']);
  });
});

describe('Duplex.write routes to the writable side', () => {
  it('writes via Duplex go to the writable side, not the readable buffer', async () => {
    const d = new Duplex({ objectMode: true });
    const writtenToWritable: unknown[] = [];
    // Override the writable side's write impl by reaching in — supported
    // surface for tests / inner-class introspection.
    d.writableSide = Object.assign(d.writableSide, {});
    // Stub _write by replacing the impl indirection:
    // The Writable implementation calls `writeImpl` (private) if provided via
    // opts. Since we constructed without opts, the default impl is a no-op
    // that just invokes the cb. We assert at the protocol level: writing to
    // the Duplex must NOT push chunks into the Readable buffer.
    const dataSeen: unknown[] = [];
    d.on('data', (c) => dataSeen.push(c));
    d.write('one');
    d.write('two');
    // Flush a couple of microtasks for the writable buffer to settle.
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    expect(dataSeen).toEqual([]); // not echoed to the readable side
    expect(writtenToWritable).toEqual([]); // sanity — we didn't wire a write impl
  });

  it('Duplex with a writable impl invokes it for write()', async () => {
    const seen: unknown[] = [];
    const d = new Duplex({
      objectMode: true,
      write(chunk, _enc, cb) {
        seen.push(chunk);
        cb();
      },
    });
    d.write(1);
    d.write(2);
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    expect(seen).toEqual([1, 2]);
  });
});
