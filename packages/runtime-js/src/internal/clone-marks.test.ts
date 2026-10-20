import { describe, expect, it } from 'vitest';
import { installCloneAdmission } from './clone-admission.ts';
import { admitClone, isMarkedAsUncloneable, markAsUncloneable } from './clone-marks.ts';

const refused = (fn: () => unknown) =>
  expect(fn).toThrowError(
    expect.objectContaining({
      name: 'DataCloneError',
      code: 25,
      message: 'Cannot clone object of unsupported type.',
    }),
  );
const tag = <T>(value: T): T => {
  markAsUncloneable(value);
  return value;
};
const MARKS = Symbol.for('rifty.runtime-js.clone-marks.v1');

describe('clone marks record', () => {
  it('one realm-global record: a second bundle copy sees the same tags', () => {
    const record = (globalThis as Record<symbol, unknown>)[MARKS] as {
      uncloneable: WeakSet<object>;
      state: { any: boolean };
    };
    const fromOtherBundle = {};
    record.uncloneable.add(fromOtherBundle);
    record.state.any = true;
    expect(isMarkedAsUncloneable(fromOtherBundle)).toBe(true);
    refused(() => admitClone({ fromOtherBundle }));
    const local = tag({});
    expect(record.uncloneable.has(local)).toBe(true);
    expect(Object.isFrozen(record)).toBe(true);
  });
});

describe('admitClone', () => {
  it('fast path and ordinary reach', () => {
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
    expect(() => admitClone(tagged)).toThrowError(DOMException);
  });

  it('spoofed prototypes and tags are ordinary objects (V8 JS_OBJECT_TYPE)', () => {
    const tagged = tag({});
    const hide = (proto: object | null) =>
      Object.create(proto, { h: { value: tagged, enumerable: true } });
    refused(() => admitClone(hide(Date.prototype)));
    refused(() => admitClone(hide({ constructor: Date })));
    refused(() => admitClone(hide(Error.prototype)));
    refused(() => admitClone(hide(Blob.prototype)));
    refused(() => admitClone({ [Symbol.toStringTag]: 'Blob', h: tagged }));
    refused(() => admitClone({ [Symbol.toStringTag]: 'Date', h: tagged }));
    const spoofedError = Object.assign(new Error('x', { cause: tagged }), {
      [Symbol.toStringTag]: 'Error',
    });
    refused(() => admitClone(spoofedError));
  });

  it('a JS class with Symbol.toStringTag and brand-checking getters is ordinary (undici Response)', () => {
    const brand = new WeakSet<object>();
    class Response {
      field: object;
      constructor(field: object) {
        brand.add(this);
        this.field = field;
      }
      get status(): number {
        if (!brand.has(this)) throw new TypeError('Illegal invocation');
        return 200;
      }
      get [Symbol.toStringTag](): string {
        return 'Response';
      }
    }
    refused(() => admitClone({ a: [new Response(tag({}))] }));
    refused(() => admitClone(tag(new Response({}))));
    const plain = new Response({ k: 1 });
    expect(admitClone({ plain })).toEqual({ plain: { field: { k: 1 } } });
  });

  // Platform leaves need a native constructor: MessagePort/WebAssembly.Module below; Chromium's
  // native Blob is graded by the browser row (Node's Blob is a JS class the Node host serializes itself).
  it('intrinsics and platform objects are leaves; their own tag is ignored (V8 slots)', () => {
    const date = tag(new Date(5));
    const list = tag([1, 2]);
    const map = tag(new Map([[1, 2]]));
    const set = tag(new Set([1]));
    const buffer = tag(new ArrayBuffer(4));
    const view = tag(new Uint8Array(2));
    const wrapper = tag(new Number(3));
    const regexp = tag(/x/g);
    const projected = admitClone({
      date,
      list,
      map,
      set,
      buffer,
      view,
      wrapper,
      regexp,
    }) as Record<string, unknown>;
    expect(projected.date).toBe(date);
    expect(projected.list).toEqual([1, 2]);
    expect(projected.map).toEqual(new Map([[1, 2]]));
    expect(projected.set).toEqual(new Set([1]));
    expect(projected.buffer).toBe(buffer);
    expect(projected.view).toBe(view);
    expect(projected.wrapper).toBe(wrapper);
    expect(projected.regexp).toBe(regexp);
    expect(admitClone(null)).toBe(null);
    const fn = () => {};
    expect(admitClone(fn)).toBe(fn);
    // The array itself is tagged but recursed: the plain object inside is caught.
    refused(() => admitClone(tag([tag({})])));
    refused(() => admitClone(tag(new Map([['k', tag({})]]))));
  });

  it('Map/Set entries are snapshotted before values are read, as V8 copies the table', () => {
    const tagged = tag({});
    const deleting = new Map<string, unknown>();
    deleting.set('a', {
      get g() {
        deleting.delete('b');
        return 1;
      },
    });
    deleting.set('b', tagged);
    refused(() => admitClone(deleting));
    const adding = new Map<string, unknown>();
    adding.set('a', {
      get g() {
        adding.set('c', 1);
        return 1;
      },
    });
    expect([...(admitClone(adding) as Map<string, unknown>).keys()]).toEqual(['a']);
    const growing = new Set<unknown>();
    growing.add({
      get g() {
        growing.add(tagged);
        return 1;
      },
    });
    expect((admitClone(growing) as Set<unknown>).size).toBe(1);
  });

  it('reads an accessor exactly once and projects it as data', () => {
    const tagged = tag({});
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

  it('keeps cycles, shared references and holes', () => {
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
  });

  it('Errors: by reference, tag honoured, own data cause walked, accessors/own props ignored', () => {
    const tagged = tag({});
    refused(() => admitClone(tag(new Error('tagged'))));
    refused(() => admitClone(new Error('x', { cause: { deep: [tagged] } })));
    const plain = new RangeError('x', { cause: { a: 1 } });
    expect(admitClone(plain)).toBe(plain);
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
    let deepReads = 0;
    const getterUnderCause = new Error('x', {
      cause: {
        get g() {
          deepReads++;
          return tagged;
        },
      },
    });
    refused(() => admitClone(getterUnderCause));
    expect(deepReads).toBe(1);
  });

  it('a graph holding an Error with an object cause is walked, not projected (aliasing kept)', () => {
    const shared = { s: 1 };
    const error = new Error('x', { cause: { x: shared } });
    const graph = { error, peer: shared };
    expect(admitClone(graph)).toBe(graph);
    const primitiveCause = { error: new Error('x', { cause: 'why' }), peer: shared };
    expect(admitClone(primitiveCause)).not.toBe(primitiveCause);
    refused(() => admitClone({ error, bad: tag({}) }));
  });

  it('leaves never check their tag: tagged intrinsics and platform objects pass to native', () => {
    const module = tag(new WebAssembly.Module(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0])));
    expect((admitClone({ module }) as { module: unknown }).module).toBe(module);
    const { port1, port2 } = new MessageChannel();
    tag(port1);
    expect((admitClone({ port1 }) as { port1: unknown }).port1).toBe(port1);
    port1.close();
    port2.close();
  });

  it('ignores non-enumerable, symbol-keyed and inherited reach', () => {
    const tagged = tag({});
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
  it('routes structuredClone through one admission: getter read once, transfers and Errors intact', () => {
    installCloneAdmission();
    installCloneAdmission();
    const tagged = tag({});
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

    const error = new RangeError('x', { cause: { a: 1 } });
    const cloned = structuredClone(error);
    expect(cloned).toBeInstanceOf(RangeError);
    expect(cloned.message).toBe('x');
    expect(cloned.stack).toBe(error.stack);
    expect(cloned.cause).toEqual({ a: 1 });

    const { port1, port2 } = new MessageChannel();
    tag(port1);
    const moved = structuredClone({ port: port1 }, { transfer: [port1] });
    expect(moved.port).toBeInstanceOf(MessagePort);
    expect(moved.port).not.toBe(port1);
    moved.port.close();
    port2.close();
    const module = tag(new WebAssembly.Module(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0])));
    expect(structuredClone(module)).toBeInstanceOf(WebAssembly.Module);

    // Native order: the transfer argument is read before the message is serialized.
    const mutated = { v: 1 };
    const clone = structuredClone(mutated, {
      get transfer() {
        mutated.v = 2;
        return [];
      },
    });
    expect(clone.v).toBe(2);

    const peerShared = { s: 1 };
    const aliased = structuredClone({
      error: new Error('x', { cause: { x: peerShared } }),
      peer: peerShared,
    });
    expect(aliased.error.cause).toEqual({ x: { s: 1 } });
    expect((aliased.error.cause as { x: unknown }).x).toBe(aliased.peer);
    const cyclicError = new Error('cycle');
    const cause: { err?: unknown } = {};
    cause.err = cyclicError;
    cyclicError.cause = cause;
    const cycled = structuredClone(cyclicError);
    expect((cycled.cause as { err: unknown }).err).toBe(cycled);
  });
});
