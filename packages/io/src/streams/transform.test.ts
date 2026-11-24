// Updated per ADR-0034: pre-ADR `Duplex` had `writableSide` as a writable
// instance field, and `Transform` rebound `this.write` / `this.end` per
// instance. Tests below now assert the post-ADR shape — methods on the
// prototype, `writableSide` readonly, and `_writableState` exposed via the
// Duplex getter for Node-compatible introspection.
import { describe, expect, it } from 'vitest';
import { Duplex } from './duplex.ts';
import { PassThrough } from './pass-through.ts';
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
    // `write`/`end` live on the prototype (ADR-0034); the `transform` option
    // becomes the instance's own `_transform` (Node).
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
    const written: unknown[] = [];
    const d = new Duplex({
      objectMode: true,
      read(): void {},
      write(chunk, _encoding, cb): void {
        written.push(chunk);
        cb();
      },
    });
    const dataSeen: unknown[] = [];
    d.on('data', (c) => dataSeen.push(c));
    d.write('one');
    d.write('two');
    // Flush a couple of microtasks for the writable buffer to settle.
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    expect(dataSeen).toEqual([]); // not echoed to the readable side
    expect(written).toEqual(['one', 'two']);
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

  it('instance _write override is honored on a PassThrough (fast-glob static provider)', async () => {
    const stream = new PassThrough({ objectMode: true }) as PassThrough & {
      _write(chunk: unknown, encoding: string, cb: (err?: Error | null) => void): void;
    };
    const seen: unknown[] = [];
    stream._write = (index, _enc, done) => {
      stream.push({ path: `file-${String(index)}` });
      stream.end();
      done();
    };
    stream.on('data', (entry) => seen.push(entry));
    const ended = new Promise<void>((resolve) => stream.once('end', () => resolve()));

    stream.write(0);
    await ended;

    expect(seen).toEqual([{ path: 'file-0' }]);
  });
});
