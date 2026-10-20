import { describe, expect, it } from 'vitest';
import { assertCloneable, markAsUncloneable } from './clone-marks.ts';

const refused = (value: unknown) =>
  expect(() => assertCloneable(value)).toThrowError(
    expect.objectContaining({
      name: 'DataCloneError',
      code: 25,
      message: 'Cannot clone object of unsupported type.',
    }),
  );

describe('assertCloneable', () => {
  it('fast path: a realm without tags admits anything without walking', () => {
    let reads = 0;
    const graph = {
      get a() {
        reads++;
        return 1;
      },
    };
    expect(() => assertCloneable(graph)).not.toThrow();
    expect(reads).toBe(0);
  });

  it('refuses tagged objects anywhere structured clone would reach them', () => {
    class Tagged {
      constructor() {
        markAsUncloneable(this);
      }
    }
    class Sub extends Tagged {}
    const tagged = new Tagged();
    refused(tagged);
    refused(new Sub());
    refused({ deep: { list: [1, tagged] } });
    refused([0, [tagged]]);
    refused(new Map([[tagged, 1]]));
    refused(new Map([['k', tagged]]));
    refused(new Set([{ x: tagged }]));
    expect(() => assertCloneable(tagged)).toThrowError(DOMException);
  });

  it('invokes a getter exactly once, as the serializer does', () => {
    const tagged = {};
    markAsUncloneable(tagged);
    let reads = 0;
    const graph = {
      get a() {
        reads++;
        return tagged;
      },
    };
    refused(graph);
    expect(reads).toBe(1);
  });

  it('is cycle-safe and admits plain data + leaves', () => {
    const cyclic: { self?: unknown; list: unknown[] } = { list: [] };
    cyclic.self = cyclic;
    cyclic.list.push(cyclic);
    expect(() => assertCloneable(cyclic)).not.toThrow();
    expect(() => assertCloneable({ x: 1 })).not.toThrow();
    expect(() => assertCloneable(new Uint8Array(4))).not.toThrow();
    expect(() => assertCloneable(new Date())).not.toThrow();
    expect(() => assertCloneable(null)).not.toThrow();
    expect(() => assertCloneable(() => {})).not.toThrow();
  });

  it('ignores non-enumerable, symbol-keyed and inherited reach', () => {
    const tagged = {};
    markAsUncloneable(tagged);
    const hidden = Object.create(
      { inherited: tagged },
      {
        secret: { value: tagged, enumerable: false },
        [Symbol('s')]: { value: tagged, enumerable: true },
      },
    );
    expect(() => assertCloneable(hidden)).not.toThrow();
  });
});
