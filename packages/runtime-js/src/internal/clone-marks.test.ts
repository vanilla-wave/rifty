import { describe, expect, it } from 'vitest';
import { installCloneAdmission } from './clone-admission.ts';
import { assertCloneable, isMarkedAsUncloneable, markAsUncloneable } from './clone-marks.ts';

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
const EMPTY_MODULE = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);

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
    refused(() => assertCloneable({ fromOtherBundle }));
    expect(record.uncloneable.has(tag({}))).toBe(true);
    expect(Object.isFrozen(record)).toBe(true);
  });
});

describe('assertCloneable', () => {
  it('refuses tagged ordinary objects at every data depth', () => {
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
    refused(() => assertCloneable(tagged));
    refused(() => assertCloneable(new Sub()));
    refused(() => assertCloneable({ deep: { list: [1, tagged] } }));
    refused(() => assertCloneable([0, [tagged]]));
    refused(() => assertCloneable(new Map([[tagged, 1]])));
    refused(() => assertCloneable(new Map([['k', tagged]])));
    refused(() => assertCloneable(new Set([{ x: tagged }])));
    refused(() => assertCloneable(new Guest()));
    refused(() => assertCloneable(Object.assign(Object.create(null), { tagged })));
    refused(() => assertCloneable(new Error('x', { cause: { deep: [tagged] } })));
    refused(() => assertCloneable(tag(new Error('tagged'))));
    expect(() => assertCloneable(tagged)).toThrowError(DOMException);
  });

  it('spoofed prototypes and tags are ordinary objects (V8 JS_OBJECT_TYPE)', () => {
    const tagged = tag({});
    const hide = (proto: object | null) =>
      Object.create(proto, { h: { value: tagged, enumerable: true } });
    refused(() => assertCloneable(hide(Date.prototype)));
    refused(() => assertCloneable(hide({ constructor: Date })));
    refused(() => assertCloneable(hide(Error.prototype)));
    refused(() => assertCloneable(hide(Blob.prototype)));
    refused(() => assertCloneable(hide(MessagePort.prototype)));
    refused(() => assertCloneable({ [Symbol.toStringTag]: 'Blob', h: tagged }));
    refused(() => assertCloneable({ [Symbol.toStringTag]: 'Date', h: tagged }));
    refused(() =>
      assertCloneable(
        Object.assign(new Error('x', { cause: tagged }), { [Symbol.toStringTag]: 'Error' }),
      ),
    );
  });

  it('never invokes an accessor: tagged objects behind getters are the documented ceiling', () => {
    const tagged = tag({});
    let reads = 0;
    const graph = {
      get a() {
        reads++;
        return tagged;
      },
      list: [
        {
          get b() {
            reads++;
            return tagged;
          },
        },
      ],
      error: new Error('x', {
        cause: {
          get c() {
            reads++;
            return tagged;
          },
        },
      }),
    };
    Object.defineProperty(graph, 'inherited', {
      value: Object.create({ d: tagged }),
      enumerable: true,
    });
    expect(() => assertCloneable(graph)).not.toThrow();
    expect(reads).toBe(0);
    const accessorCause = new Error('x');
    Object.defineProperty(accessorCause, 'cause', {
      get() {
        reads++;
        return tagged;
      },
      configurable: true,
    });
    expect(() => assertCloneable(accessorCause)).not.toThrow();
    expect(reads).toBe(0);
  });

  it('intrinsics never check their own tag (V8 slots); containers still recurse', () => {
    const leaves = {
      date: tag(new Date(5)),
      list: tag([1, 2]),
      map: tag(new Map([[1, 2]])),
      set: tag(new Set([1])),
      buffer: tag(new ArrayBuffer(4)),
      view: tag(new Uint8Array(2)),
      wrapper: tag(new Number(3)),
      regexp: tag(/x/g),
      fn: tag(() => {}),
    };
    expect(() => assertCloneable(leaves)).not.toThrow();
    refused(() => assertCloneable(tag([tag({})])));
    refused(() => assertCloneable(tag(new Map([['k', tag({})]]))));
    refused(() => assertCloneable(tag(new Set([tag({})]))));
    // Untagged host objects read as ordinary without side effects (no own enumerable data).
    const { port1, port2 } = new MessageChannel();
    expect(() =>
      assertCloneable({ port1, module: new WebAssembly.Module(EMPTY_MODULE) }),
    ).not.toThrow();
    // Documented divergence (compat ⚠️): a tag placed on a host object is honoured; Node ignores it.
    refused(() => assertCloneable(tag(port1)));
    port1.close();
    port2.close();
  });

  it('compat ⚠️: a getter deleting a later tagged sibling still throws (walk never runs getters)', () => {
    const tagged = tag({});
    let reads = 0;
    const graph: { b?: object; readonly a: number } = {
      get a() {
        reads++;
        Reflect.deleteProperty(graph, 'b');
        return 1;
      },
      b: tagged,
    };
    refused(() => assertCloneable(graph));
    expect(reads).toBe(0);
    expect(graph.b).toBe(tagged);
  });

  it('ignores non-enumerable, symbol-keyed and inherited reach; cycles terminate', () => {
    const tagged = tag({});
    const hidden = Object.create(
      { inherited: tagged },
      {
        secret: { value: tagged, enumerable: false },
        [Symbol('s')]: { value: tagged, enumerable: true },
      },
    );
    expect(() => assertCloneable(hidden)).not.toThrow();
    const withProp = Object.assign(new Error('x'), { tagged });
    expect(() => assertCloneable(withProp)).not.toThrow();
    const cyclic: { self?: unknown; list: unknown[] } = { list: [] };
    cyclic.self = cyclic;
    cyclic.list.push(cyclic, new Map([[cyclic, cyclic]]));
    expect(() => assertCloneable(cyclic)).not.toThrow();
  });
});

describe('installCloneAdmission', () => {
  it('valid clones are identical with admission: native reads the original once', () => {
    installCloneAdmission();
    installCloneAdmission();
    const tagged = tag({});
    refused(() => structuredClone({ a: [tagged] }));
    refused(() => structuredClone(new Map([['k', { deep: tagged }]])));
    expect(structuredClone.name).toBe('structuredClone');

    let reads = 0;
    const buffer = new ArrayBuffer(8);
    const shared = { s: 1 };
    const holes: unknown[] = [1];
    holes[2] = 3;
    const graph: Record<string, unknown> = {
      get a() {
        reads++;
        return 1;
      },
      deep: { buffer },
      x: shared,
      y: shared,
      holes,
      date: tag(new Date(5)),
      list: tag([1, 2]),
    };
    graph.self = graph;
    const copy = structuredClone(graph, { transfer: [buffer] }) as typeof graph;
    expect(reads).toBe(1);
    expect(copy.a).toBe(1);
    expect((copy.deep as { buffer: ArrayBuffer }).buffer.byteLength).toBe(8);
    expect(buffer.byteLength).toBe(0);
    expect(copy.x).toBe(copy.y);
    expect(copy.self).toBe(copy);
    expect(1 in (copy.holes as unknown[])).toBe(false);
    expect((copy.date as Date).getTime()).toBe(5);
    expect(copy.list).toEqual([1, 2]);

    const error = new RangeError('x', { cause: { x: shared } });
    const aliased = structuredClone({ error, peer: shared });
    expect(aliased.error).toBeInstanceOf(RangeError);
    expect(aliased.error.message).toBe('x');
    expect(aliased.error.stack).toBe(error.stack);
    expect((aliased.error.cause as { x: unknown }).x).toBe(aliased.peer);
    const cyclicError = new Error('cycle');
    const cause: { err?: unknown } = {};
    cause.err = cyclicError;
    cyclicError.cause = cause;
    expect((structuredClone(cyclicError).cause as { err: unknown }).err).toBeInstanceOf(Error);

    // Native order: the transfer argument is read before the message is serialized.
    const mutated = { v: 1 };
    const clone = structuredClone(mutated, {
      get transfer() {
        mutated.v = 2;
        return [];
      },
    });
    expect(clone.v).toBe(2);

    const { port1, port2 } = new MessageChannel();
    const moved = structuredClone({ port: port1 }, { transfer: [port1] });
    expect(moved.port).toBeInstanceOf(MessagePort);
    expect(moved.port).not.toBe(port1);
    moved.port.close();
    port2.close();
    expect(structuredClone(new WebAssembly.Module(EMPTY_MODULE))).toBeInstanceOf(
      WebAssembly.Module,
    );

    // Ceiling (compat ❌): a tag behind a getter is not seen; native clones its own fields.
    let ceilingReads = 0;
    const behindGetter = {
      get a() {
        ceilingReads++;
        return tagged;
      },
    };
    expect(structuredClone(behindGetter)).toEqual({ a: {} });
    expect(ceilingReads).toBe(1);
  });

  it('touches only captured primordials: guest patches never run during admission', async () => {
    installCloneAdmission();
    const probe = { v: 1, deep: { list: [1, { k: 2 }], map: new Map([['m', { n: 3 }]]) } };
    const tagged = tag({});
    const { port1, port2 } = new MessageChannel();
    const delivered = new Promise<unknown>((resolve) => {
      port2.onmessage = (event) => resolve(event.data);
    });
    let patchedCalls = 0;
    let iteratorNextCalls = 0;
    let callerIteratorCalls = 0;
    let clone: unknown;
    let callsAfterClone = -1;
    let nextAfterClone = -1;
    let callsAfterPost = -1;
    let nextAfterPost = -1;
    let callsAfterRefusal = -1;
    let refusal: unknown;
    const mutate = () => {
      patchedCalls++;
      probe.v = 2;
    };
    const arrayIteratorProto = Object.getPrototypeOf([][Symbol.iterator]()) as {
      next: () => IteratorResult<unknown>;
    };
    const saved = {
      setAdd: Set.prototype.add,
      setHas: Set.prototype.has,
      arrayIterator: Array.prototype[Symbol.iterator],
      iteratorNext: arrayIteratorProto.next,
      slice: Array.prototype.slice,
      push: Array.prototype.push,
      isArray: Array.isArray,
      objectCreate: Object.create,
      reflectApply: Reflect.apply,
      mapForEach: Map.prototype.forEach,
      setForEach: Set.prototype.forEach,
      species: Object.getOwnPropertyDescriptor(Array, Symbol.species) as PropertyDescriptor,
      constructor: Object.getOwnPropertyDescriptor(
        Array.prototype,
        'constructor',
      ) as PropertyDescriptor,
    };
    try {
      Set.prototype.add = function (this: Set<unknown>, value: unknown) {
        mutate();
        return saved.setAdd.call(this, value);
      };
      Set.prototype.has = function (this: Set<unknown>, value: unknown) {
        mutate();
        return saved.setHas.call(this, value);
      };
      // The caller's own transfer list `[]` is read through these, once, as native would.
      Array.prototype[Symbol.iterator] = function (this: unknown[]) {
        callerIteratorCalls++;
        return saved.arrayIterator.call(this);
      };
      arrayIteratorProto.next = function (this: Iterator<unknown>) {
        iteratorNextCalls++;
        return saved.iteratorNext.call(this);
      };
      Array.prototype.slice = function (this: unknown[], ...args: [number?, number?]) {
        mutate();
        return saved.slice.apply(this, args);
      };
      Array.prototype.push = function (this: unknown[], ...items: unknown[]) {
        mutate();
        return saved.push.apply(this, items);
      };
      Array.isArray = ((value: unknown) => {
        mutate();
        return saved.isArray(value);
      }) as typeof Array.isArray;
      Object.create = ((proto: object | null, properties?: PropertyDescriptorMap) => {
        mutate();
        return properties === undefined
          ? saved.objectCreate(proto)
          : saved.objectCreate(proto, properties);
      }) as typeof Object.create;
      Reflect.apply = ((
        target: (...args: unknown[]) => unknown,
        self: unknown,
        args: unknown[],
      ) => {
        mutate();
        return saved.reflectApply(target, self, args);
      }) as typeof Reflect.apply;
      Map.prototype.forEach = function (this: Map<unknown, unknown>, ...args: unknown[]) {
        mutate();
        return saved.mapForEach.apply(this, args as [() => void]);
      } as typeof Map.prototype.forEach;
      Set.prototype.forEach = function (this: Set<unknown>, ...args: unknown[]) {
        mutate();
        return saved.setForEach.apply(this, args as [() => void]);
      } as typeof Set.prototype.forEach;
      Object.defineProperty(Array, Symbol.species, {
        get() {
          mutate();
          return Array;
        },
        configurable: true,
      });
      Object.defineProperty(Array.prototype, 'constructor', {
        get() {
          mutate();
          return Array;
        },
        configurable: true,
      });
      Object.defineProperty(Object.prototype, 'value', {
        get() {
          mutate();
          return undefined;
        },
        configurable: true,
      });
      // Only admission + native run while patched; assertions follow the restore.
      clone = structuredClone(probe, { transfer: [] });
      callsAfterClone = patchedCalls;
      nextAfterClone = iteratorNextCalls;
      port1.postMessage(probe, []);
      callsAfterPost = patchedCalls;
      nextAfterPost = iteratorNextCalls;
      try {
        structuredClone({ hidden: [tagged] });
      } catch (error) {
        refusal = error;
      }
      callsAfterRefusal = patchedCalls;
    } finally {
      // First: descriptor literals below must not see the `Object.prototype.value` getter.
      Reflect.deleteProperty(Object.prototype, 'value');
      Set.prototype.add = saved.setAdd;
      Set.prototype.has = saved.setHas;
      Array.prototype[Symbol.iterator] = saved.arrayIterator;
      arrayIteratorProto.next = saved.iteratorNext;
      Array.prototype.slice = saved.slice;
      Array.prototype.push = saved.push;
      Array.isArray = saved.isArray;
      Object.create = saved.objectCreate;
      Reflect.apply = saved.reflectApply;
      Map.prototype.forEach = saved.mapForEach;
      Set.prototype.forEach = saved.setForEach;
      Object.defineProperty(Array, Symbol.species, saved.species);
      Object.defineProperty(Array.prototype, 'constructor', saved.constructor);
    }
    const expected = { v: 1, deep: { list: [1, { k: 2 }], map: new Map([['m', { n: 3 }]]) } };
    expect(callsAfterClone).toBe(0);
    expect(callsAfterPost).toBe(0);
    expect(callsAfterRefusal).toBe(0);
    // The caller's `[]` is read exactly once per call through its own @@iterator/next (as
    // native would); the forwarded list is a primordial-only iterable the native call consumes.
    expect(nextAfterClone).toBe(1);
    expect(nextAfterPost - nextAfterClone).toBe(1);
    expect(callerIteratorCalls).toBe(2);
    expect(clone).toEqual(expected);
    expect(await delivered).toEqual(expected);
    port1.close();
    port2.close();
    expect(refusal).toMatchObject({ name: 'DataCloneError', code: 25 });
  });

  it('BroadcastChannel.postMessage takes one argument: a stray options getter never runs', async () => {
    installCloneAdmission();
    const sender = new BroadcastChannel('rifty-clone-admission-probe');
    const receiver = new BroadcastChannel('rifty-clone-admission-probe');
    try {
      const delivered = new Promise<unknown>((resolve) => {
        receiver.onmessage = (event) => resolve(event.data);
      });
      const msg = { v: 1 };
      let reads = 0;
      (sender.postMessage as (...args: unknown[]) => void)(msg, {
        get transfer() {
          reads++;
          msg.v = 2;
          return [];
        },
      });
      expect(await delivered).toEqual({ v: 1 });
      expect(reads).toBe(0);
      refused(() => sender.postMessage({ deep: [tag({})] }));
    } finally {
      sender.close();
      receiver.close();
    }
  });
});
