import { describe, expect, it } from 'vitest';
import { EventEmitter } from '../event-emitter.ts';
import { compose } from './compose.ts';
import { Duplex } from './duplex.ts';
import { Readable } from './readable.ts';
import { Transform } from './transform.ts';
import { Writable } from './writable.ts';

const tick = (ms = 30): Promise<void> => new Promise((res) => setTimeout(res, ms));

const upper = (): Transform =>
  new Transform({
    objectMode: true,
    transform(c, _e, cb) {
      cb(null, String(c).toUpperCase());
    },
  });
const bracket = (): Transform =>
  new Transform({
    objectMode: true,
    transform(c, _e, cb) {
      cb(null, `[${c}]`);
    },
  });

/**
 * `stream.compose` + `Readable.prototype.wrap` + `Duplex.from`. Probed
 * head-to-head against real Node v24 (return type is `instanceof Duplex`; Node's
 * internal `Duplexify` class NAME is explicitly out of scope).
 */
describe('stream.compose', () => {
  it('two Transforms → a Duplex that drains write→stage0→stageN→read', async () => {
    const composed = compose(upper(), bracket());
    expect(composed).toBeInstanceOf(Duplex);
    const out: unknown[] = [];
    composed.on('data', (c) => out.push(c));
    composed.end('hi');
    await tick();
    expect(out).toEqual(['[HI]']);
  });

  it('accepts an async-generator-function stage (instanceof Duplex)', async () => {
    const composed = compose(async function* (src: AsyncIterable<unknown>) {
      for await (const c of src) yield String(c).toUpperCase();
    });
    expect(composed).toBeInstanceOf(Duplex);
    const out: unknown[] = [];
    composed.on('data', (c) => out.push(c));
    composed.end('ab');
    await tick();
    expect(out).toEqual(['AB']);
  });

  it('mixes a Transform and an async-generator-function stage', async () => {
    const composed = compose(upper(), async function* (src: AsyncIterable<unknown>) {
      for await (const c of src) yield `<${c}>`;
    });
    const out: unknown[] = [];
    composed.on('data', (c) => out.push(c));
    composed.end('hi');
    await tick();
    expect(out).toEqual(['<HI>']);
  });

  it('a stage erroring destroys the composed Duplex AND every stage', async () => {
    const s0 = upper();
    const boom = new Error('stage-boom');
    const s1 = new Transform({
      objectMode: true,
      transform(_c, _e, cb) {
        cb(boom);
      },
    });
    const composed = compose(s0, s1);
    let errSeen: unknown = null;
    composed.on('error', (e) => {
      errSeen = e;
    });
    composed.end('x');
    await tick();
    expect(errSeen).toBe(boom);
    expect(s0.destroyed).toBe(true);
    expect(s1.destroyed).toBe(true);
  });

  it('rejects zero stages with ERR_MISSING_ARGS (TypeError)', () => {
    let err: unknown = null;
    try {
      compose();
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(TypeError);
    expect((err as { code?: string }).code).toBe('ERR_MISSING_ARGS');
  });
});

describe('Duplex.from', () => {
  it('async-generator-function source: write drives the readable transform', async () => {
    const d = Duplex.from(async function* (src: AsyncIterable<unknown>) {
      for await (const c of src) yield String(c).toUpperCase();
    });
    expect(d).toBeInstanceOf(Duplex);
    const out: unknown[] = [];
    d.on('data', (c) => out.push(c));
    d.write('ab');
    d.write('cd');
    d.end();
    await tick();
    expect(out).toEqual(['AB', 'CD']);
  });

  it('array source → readable yields the items', async () => {
    const d = Duplex.from(['x', 'y']);
    expect(d).toBeInstanceOf(Duplex);
    const out: unknown[] = [];
    d.on('data', (c) => out.push(c));
    await tick();
    expect(out).toEqual(['x', 'y']);
  });

  it('async-iterable source → readable yields the items', async () => {
    async function* gen(): AsyncGenerator<string> {
      yield 'g1';
      yield 'g2';
    }
    const d = Duplex.from(gen());
    const out: unknown[] = [];
    d.on('data', (c) => out.push(c));
    await tick();
    expect(out).toEqual(['g1', 'g2']);
  });

  it('{ readable, writable } source → instanceof Duplex', () => {
    const readable = Readable.from(['z'], { objectMode: true });
    const writable = new Writable({
      objectMode: true,
      write(_c, _e, cb) {
        cb();
      },
    });
    const d = Duplex.from({ readable, writable });
    expect(d).toBeInstanceOf(Duplex);
  });

  it('throws ERR_INVALID_ARG_TYPE (TypeError) for an unknown shape', () => {
    let err: unknown = null;
    try {
      Duplex.from(42 as unknown as Iterable<unknown>);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(TypeError);
    expect((err as { code?: string }).code).toBe('ERR_INVALID_ARG_TYPE');
  });
});

describe('Readable.prototype.wrap', () => {
  it('adapts a legacy data/end emitter and returns the Readable', async () => {
    class Legacy extends EventEmitter {
      paused = false;
      pause(): void {
        this.paused = true;
      }
      resume(): void {
        this.paused = false;
      }
    }
    const legacy = new Legacy();
    const r = new Readable({ objectMode: true, read() {} });
    const ret = r.wrap(legacy);
    expect(ret).toBe(r);
    const out: unknown[] = [];
    r.on('data', (c) => out.push(c));
    setTimeout(() => {
      legacy.emit('data', 'L1');
      legacy.emit('data', 'L2');
      legacy.emit('end');
    }, 5);
    await tick();
    expect(out).toEqual(['L1', 'L2']);
  });

  it('honors pause/resume backpressure on the legacy source', async () => {
    class Legacy extends EventEmitter {
      calls: string[] = [];
      pause(): void {
        this.calls.push('pause');
      }
      resume(): void {
        this.calls.push('resume');
      }
    }
    const legacy = new Legacy();
    // Paused-mode Readable (no data listener) with a tiny HWM: pushing past it
    // must pause the legacy source.
    const r = new Readable({ objectMode: true, highWaterMark: 2, read() {} });
    r.wrap(legacy);
    setTimeout(() => {
      legacy.emit('data', 'a');
      legacy.emit('data', 'b');
      legacy.emit('data', 'c');
    }, 5);
    await tick();
    expect(legacy.calls).toContain('pause');
  });
});
