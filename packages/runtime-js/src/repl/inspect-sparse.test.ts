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
