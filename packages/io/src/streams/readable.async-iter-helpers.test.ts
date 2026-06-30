import { describe, expect, it } from 'vitest';
import { Readable } from './readable.ts';

const delay = (ms: number): Promise<void> => new Promise((res) => setTimeout(res, ms));

/**
 * The v17→v22 `Readable.prototype` async-iterator helpers — lazy transforms over
 * the base `[Symbol.asyncIterator]()`. Probed head-to-head against real Node v24
 * (see the backlog item's `## Parity cases`).
 */
describe('Readable async-iterator helpers — placement + return types', () => {
  it('exposes all 12 helpers on Readable.prototype', () => {
    for (const name of [
      'map',
      'filter',
      'forEach',
      'reduce',
      'toArray',
      'take',
      'drop',
      'flatMap',
      'some',
      'every',
      'find',
      'iterator',
    ]) {
      expect(typeof (Readable.prototype as unknown as Record<string, unknown>)[name]).toBe(
        'function',
      );
    }
  });

  it('stream-returning helpers return an objectMode Readable', () => {
    for (const make of [
      () => Readable.from([1, 2, 3]).map((x) => x),
      () => Readable.from([1, 2, 3]).filter(() => true),
      () => Readable.from([1, 2, 3]).flatMap((x) => [x]),
      () => Readable.from([1, 2, 3]).take(2),
      () => Readable.from([1, 2, 3]).drop(1),
    ]) {
      const out = make();
      expect(out).toBeInstanceOf(Readable);
      expect(out.readableObjectMode).toBe(true);
    }
  });
});

describe('Readable async-iterator helpers — outputs', () => {
  it('map doubles', async () => {
    expect(
      await Readable.from([1, 2, 3])
        .map((x) => (x as number) * 2)
        .toArray(),
    ).toEqual([2, 4, 6]);
  });
  it('filter keeps evens', async () => {
    expect(
      await Readable.from([1, 2, 3, 4])
        .filter((x) => (x as number) % 2 === 0)
        .toArray(),
    ).toEqual([2, 4]);
  });
  it('flatMap expands', async () => {
    expect(
      await Readable.from([1, 2])
        .flatMap((x) => [x, (x as number) * 10])
        .toArray(),
    ).toEqual([1, 10, 2, 20]);
  });
  it('take limits and clamps', async () => {
    expect(await Readable.from([1, 2, 3, 4]).take(2).toArray()).toEqual([1, 2]);
    expect(await Readable.from([1, 2, 3]).take(10).toArray()).toEqual([1, 2, 3]);
  });
  it('drop skips', async () => {
    expect(await Readable.from([1, 2, 3, 4]).drop(2).toArray()).toEqual([3, 4]);
    expect(await Readable.from([1, 2, 3]).drop(0).toArray()).toEqual([1, 2, 3]);
    expect(await Readable.from([1, 2, 3]).drop(10).toArray()).toEqual([]);
  });
  it('reduce with and without an initial value', async () => {
    expect(await Readable.from([1, 2, 3]).reduce((a, b) => (a as number) + (b as number), 0)).toBe(
      6,
    );
    expect(await Readable.from([1, 2, 3]).reduce((a, b) => (a as number) + (b as number))).toBe(6);
  });
  it('some / every / find / forEach', async () => {
    expect(await Readable.from([1, 2, 3]).some((x) => x === 2)).toBe(true);
    expect(await Readable.from([1, 2, 3]).some((x) => (x as number) > 10)).toBe(false);
    expect(await Readable.from([1, 2, 3]).every((x) => (x as number) > 0)).toBe(true);
    expect(await Readable.from([1, 2, 3]).find((x) => (x as number) > 1)).toBe(2);
    expect(await Readable.from([1, 2, 3]).find((x) => (x as number) > 10)).toBeUndefined();
    // biome-ignore lint/complexity/noForEach: this IS the stream's `forEach` helper under test, not Array.forEach.
    expect(await Readable.from([1, 2, 3]).forEach(() => {})).toBeUndefined();
  });
  it('chains map().filter()', async () => {
    expect(
      await Readable.from([1, 2, 3, 4])
        .map((x) => (x as number) * 2)
        .filter((x) => (x as number) > 4)
        .toArray(),
    ).toEqual([6, 8]);
  });
});

describe('Readable async-iterator helpers — validation + errors', () => {
  it('take(-1) / drop(-1) throw ERR_OUT_OF_RANGE (RangeError)', () => {
    const takeErr = grab(() => Readable.from([1]).take(-1));
    expect(takeErr).toBeInstanceOf(RangeError);
    expect((takeErr as { code?: string }).code).toBe('ERR_OUT_OF_RANGE');
    const dropErr = grab(() => Readable.from([1]).drop(-1));
    expect(dropErr).toBeInstanceOf(RangeError);
    expect((dropErr as { code?: string }).code).toBe('ERR_OUT_OF_RANGE');
  });

  it('reduce on an EMPTY stream with no initial value rejects ERR_MISSING_ARGS (TypeError)', async () => {
    const err = await Readable.from([])
      .reduce((a) => a)
      .then(
        () => null,
        (e) => e,
      );
    expect(err).toBeInstanceOf(TypeError);
    expect((err as { code?: string }).code).toBe('ERR_MISSING_ARGS');
  });

  it('map(non-fn) throws a synchronous ERR_INVALID_ARG_TYPE (TypeError)', () => {
    const err = grab(() => Readable.from([1]).map(42 as unknown as (x: unknown) => unknown));
    expect(err).toBeInstanceOf(TypeError);
    expect((err as { code?: string }).code).toBe('ERR_INVALID_ARG_TYPE');
  });

  it('a callback throw fails fast (toArray rejects with the SAME error)', async () => {
    const boom = new Error('cb-throw');
    const err = await Readable.from([1, 2, 3])
      .map((x) => {
        if (x === 2) throw boom;
        return x;
      })
      .toArray()
      .then(
        () => null,
        (e) => e,
      );
    expect(err).toBe(boom);
  });
});

describe('Readable async-iterator helpers — concurrency', () => {
  it('preserves INPUT order under concurrency:2 even when completion order differs', async () => {
    const completion: number[] = [];
    const out = await Readable.from([1, 2, 3, 4])
      .map(
        async (x) => {
          // Item #1 (slowest) and #2 start together (concurrency 2); #2 finishes
          // first, so the FIRST completion is deterministically #2, never #1 —
          // proving concurrency is real. (The full completion sequence has
          // sub-tick jitter between the later items, so we don't pin it.)
          await delay((5 - (x as number)) * 25);
          completion.push(x as number);
          return (x as number) * 10;
        },
        { concurrency: 2 },
      )
      .toArray();
    // Output MUST be in INPUT order — the mandatory guarantee.
    expect(out).toEqual([10, 20, 30, 40]);
    // Completion is concurrent (item #2 finishes before item #1), not serial.
    expect(completion[0]).toBe(2);
    expect(completion).toHaveLength(4);
  });

  it('filter under concurrency:2 keeps input order', async () => {
    const out = await Readable.from([1, 2, 3, 4])
      .filter(
        async (x) => {
          await delay((5 - (x as number)) * 10);
          return (x as number) % 2 === 0;
        },
        { concurrency: 2 },
      )
      .toArray();
    expect(out).toEqual([2, 4]);
  });

  it('rejects concurrency 0 / -1 / "x" with ERR_OUT_OF_RANGE; accepts 1.5', async () => {
    for (const bad of [0, -1, 'x']) {
      const err = grab(() =>
        Readable.from([1]).map((x) => x, { concurrency: bad as unknown as number }),
      );
      expect((err as { code?: string }).code).toBe('ERR_OUT_OF_RANGE');
    }
    expect(
      await Readable.from([1, 2])
        .map((x) => x, { concurrency: 1.5 })
        .toArray(),
    ).toEqual([1, 2]);
  });
});

describe('Readable async-iterator helpers — signal + iterator', () => {
  it('{signal} abort mid-iteration rejects with an AbortError (code ABORT_ERR)', async () => {
    const ac = new AbortController();
    async function* slow(): AsyncGenerator<number> {
      for (let i = 0; i < 100; i++) {
        await delay(10);
        yield i;
      }
    }
    const p = Readable.from(slow())
      .map(async (x) => x, { signal: ac.signal })
      .toArray()
      .then(
        () => null,
        (e) => e,
      );
    setTimeout(() => ac.abort(), 25);
    const err = await p;
    expect((err as { name?: string }).name).toBe('AbortError');
    expect((err as { code?: string }).code).toBe('ABORT_ERR');
  });

  it('iterator({destroyOnReturn:false}) does NOT destroy the source on return()', async () => {
    const r = Readable.from([1, 2, 3, 4, 5]);
    const it = r.iterator({ destroyOnReturn: false });
    const first = await it.next();
    await it.return?.();
    await delay(10);
    expect(first.value).toBe(1);
    expect(r.destroyed).toBe(false);
  });

  it('iterator() default (destroyOnReturn:true) DOES destroy the source on return()', async () => {
    const r = Readable.from([1, 2, 3, 4, 5]);
    const it = r.iterator();
    const first = await it.next();
    await it.return?.();
    await delay(10);
    expect(first.value).toBe(1);
    expect(r.destroyed).toBe(true);
  });
});

/** Capture a synchronous throw (or return undefined if none). */
function grab(fn: () => unknown): unknown {
  try {
    fn();
    return undefined;
  } catch (e) {
    return e;
  }
}
