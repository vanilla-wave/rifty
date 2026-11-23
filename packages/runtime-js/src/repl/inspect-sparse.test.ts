import { inspect as nodeInspect } from 'node:util';
import { expect, it } from 'vitest';
import { inspect } from './inspect.ts';

// Node `formatSpecialArray`: holes by own index keys, never per index.
it.each([
  ['an empty 2^32-1 array', true, () => new Array(2 ** 32 - 1)],
  ['an empty 1e7 array', true, () => new Array(1e7)],
  [
    'holes between elements',
    true,
    () => {
      const a: unknown[] = [1];
      a[2] = 3;
      a[10] = 4;
      return a;
    },
  ],
  // More than 6 entries: Node groups them into columns (rifty one line).
  [
    'a hole run past the shown items',
    false,
    () => {
      const a: unknown[] = [];
      for (let i = 0; i < 40; i += 2) a[i] = i;
      a.length = 100;
      return a;
    },
  ],
])('%s: Node text, at once', (_, sameText, make) => {
  const value = make();
  const started = performance.now();
  const text = inspect(value);
  expect(performance.now() - started).toBeLessThan(200);
  if (sameText) expect(text).toBe(nodeInspect(value));
  else expect(text).toMatch(/<1 empty item>, 2, .* more items \]$/u);
});

it("getters: true prints Node's `[Getter: <value>]`", () => {
  const value = {
    get g() {
      return 1;
    },
    set s(_: unknown) {},
    get gs() {
      return 2;
    },
    set gs(_: unknown) {},
  };
  expect(inspect(value, { getters: true })).toBe(nodeInspect(value, { getters: true }));
});

/** Deterministic generator: holes at the start, middle and end; index-like and other keys. */
function* sparseArrays(count: number): Generator<unknown[]> {
  let seed = 421;
  const next = (n: number) => {
    seed = (seed * 1103515245 + 12345) >>> 0;
    return seed % n;
  };
  const lengths = [0, 1, 2, 3, 5, 6, 7, 12, 100, 2 ** 16, 2 ** 20, 2 ** 32 - 1];
  const extras: (string | symbol)[] = ['-1', '1.5', 'x', 'a-b', '01', '4294967295', 'NaN'];
  const symbol = Symbol('s');
  for (let n = 0; n < count; n += 1) {
    const length = lengths[next(lengths.length)] as number;
    const array: unknown[] = new Array(length);
    for (let k = next(4); k > 0 && length > 0; k -= 1) {
      const where = [0, length - 1, Math.floor(length / 2), next(length)][next(4)] as number;
      array[where] = next(100);
    }
    for (let k = next(3); k > 0; k -= 1) {
      const key = next(3) === 2 ? symbol : (extras[next(extras.length)] as string);
      (array as unknown as Record<string | symbol, unknown>)[key] = next(10);
    }
    yield array;
  }
}

it("2000 generated sparse arrays print Node's single-line text", () => {
  const wrong: string[] = [];
  let compared = 0;
  for (const array of sparseArrays(2000)) {
    const node = nodeInspect(array);
    if (node.includes('\n')) continue;
    compared += 1;
    const ours = inspect(array);
    if (ours !== node) wrong.push(`node ${node}\nours ${ours}`);
  }
  expect(wrong.slice(0, 5)).toEqual([]);
  expect(compared).toBeGreaterThan(1000);
});

it('a long dense array prints at once (no own-key walk past the shown items)', () => {
  const array = new Array(5e6).fill(0);
  const started = performance.now();
  expect(inspect(array)).toMatch(/\.\.\. 4999970 more items \]$/u);
  expect(performance.now() - started).toBeLessThan(50);
});
