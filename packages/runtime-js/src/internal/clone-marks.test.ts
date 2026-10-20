import { describe, expect, it } from 'vitest';
import { installCloneAdmission } from './clone-admission.ts';
import { admitClone, markAsUncloneable } from './clone-marks.ts';

const refused = (fn: () => unknown) =>
  expect(fn).toThrowError(
    expect.objectContaining({
      name: 'DataCloneError',
      code: 25,
      message: 'Cannot clone object of unsupported type.',
    }),
  );

describe('admitClone', () => {
  it('fast path: a realm without tags returns the value, reading nothing', () => {
    let reads = 0;
    const graph = {
      get a() {
        reads++;
        return 1;
      },
    };
    expect(admitClone(graph)).toBe(graph);
    expect(reads).toBe(0);
  });

  it('refuses tagged objects anywhere the serializer would reach them', () => {
    class Tagged {
      constructor() {
        markAsUncloneable(this);
      }
    }
    class Sub extends Tagged {}
    class Guest {
      field = new Tagged();
    }
    const tagged = new Tagged();
    refused(() => admitClone(tagged));
    refused(() => admitClone(new Sub()));
    refused(() => admitClone({ deep: { list: [1, tagged] } }));
    refused(() => admitClone([0, [tagged]]));
    refused(() => admitClone(new Map([[tagged, 1]])));
    refused(() => admitClone(new Map([['k', tagged]])));
    refused(() => admitClone(new Set([{ x: tagged }])));
    refused(() => admitClone(new Guest()));
    refused(() => admitClone(Object.assign(Object.create(null), { tagged })));
    refused(() => admitClone({ [Symbol.toStringTag]: 'Date', tagged }));
    refused(() => admitClone(new Error('x', { cause: tagged })));
    refused(() => admitClone(new Error('x', { cause: { deep: tagged } })));
    expect(() => admitClone(tagged)).toThrowError(DOMException);
  });

  it('reads an accessor exactly once and projects it as data', () => {
    const tagged = {};
    markAsUncloneable(tagged);
    let reads = 0;
    const graph = {
      get a() {
        reads++;
        return { n: 1 };
      },
    };
    const copy = admitClone(graph) as { a: { n: number } };
    expect(reads).toBe(1);
    expect(copy).not.toBe(graph);
    expect(Object.getOwnPropertyDescriptor(copy, 'a')).toMatchObject({ value: { n: 1 } });
    refused(() =>
      admitClone({
        get a() {
          return tagged;
        },
      }),
    );
  });

  it('keeps cycles, shared references, holes and leaves by reference', () => {
    const shared = { s: 1 };
    const holes: unknown[] = [1];
    holes[2] = 3;
    const cyclic: { self?: unknown; list: unknown[]; a: object; b: object } = {
      list: holes,
      a: shared,
      b: shared,
    };
    cyclic.self = cyclic;
    cyclic.list.push(cyclic);
    const copy = admitClone(cyclic) as typeof cyclic;
    expect(copy.self).toBe(copy);
    expect(copy.list[3]).toBe(copy);
    expect(copy.a).toBe(copy.b);
    expect(copy.list.length).toBe(4);
    expect(1 in copy.list).toBe(false);
    const buffer = new ArrayBuffer(8);
    const view = new Uint8Array(2);
    const date = new Date();
    const regexp = /x/g;
    const projected = admitClone({ buffer, view, date, regexp }) as Record<string, unknown>;
    expect(projected.buffer).toBe(buffer);
    expect(projected.view).toBe(view);
    expect(projected.date).toBe(date);
    expect(projected.regexp).toBe(regexp);
    expect(admitClone(null)).toBe(null);
    const fn = () => {};
    expect(admitClone(fn)).toBe(fn);
  });

  it('follows V8 for Errors: own data cause only, other own props and accessors ignored', () => {
    const tagged = {};
    markAsUncloneable(tagged);
    const withProp = Object.assign(new Error('x'), { tagged });
    expect(admitClone(withProp)).toBe(withProp);
    let reads = 0;
    const accessorCause = new Error('x');
    Object.defineProperty(accessorCause, 'cause', {
      get() {
        reads++;
        return tagged;
      },
      configurable: true,
    });
    expect(admitClone(accessorCause)).toBe(accessorCause);
    expect(reads).toBe(0);
    const primitiveCause = new TypeError('y', { cause: 'why' });
    expect(admitClone(primitiveCause)).toBe(primitiveCause);
    let causeReads = 0;
    const getterCause = new TypeError('z', {
      cause: {
        get k() {
          causeReads++;
          return 2;
        },
      },
    });
    const copy = admitClone(getterCause) as Error;
    expect(copy).not.toBe(getterCause);
    expect(copy).toBeInstanceOf(TypeError);
    expect(copy.message).toBe('z');
    expect(copy.stack).toBe(getterCause.stack);
    expect(copy.cause).toEqual({ k: 2 });
    expect(causeReads).toBe(1);
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
    expect(() => admitClone(hidden)).not.toThrow();
  });
});

describe('installCloneAdmission', () => {
  it('routes structuredClone through one admission: getter read once, transfer kept', () => {
    installCloneAdmission();
    installCloneAdmission();
    const tagged = {};
    markAsUncloneable(tagged);
    refused(() => structuredClone({ a: [tagged] }));
    let reads = 0;
    const buffer = new ArrayBuffer(8);
    const shared = { s: 1 };
    const graph = {
      get a() {
        reads++;
        return 1;
      },
      deep: { buffer },
      x: shared,
      y: shared,
    };
    const copy = structuredClone(graph, { transfer: [buffer] });
    expect(reads).toBe(1);
    expect(copy.a).toBe(1);
    expect(copy.deep.buffer.byteLength).toBe(8);
    expect(buffer.byteLength).toBe(0);
    expect(copy.x).toBe(copy.y);
    expect(structuredClone.name).toBe('structuredClone');
  });
});
