/**
 * ADR-0447: Node's manual `MessagePort` reference API (`ref`/`unref`/`hasRef`)
 * in Node child realms. A referenced port holds one ADR-0152 keepalive ref until
 * it is unref'd or either end of its pair closes. Pairs are recorded by the
 * guest-visible `MessageChannel` Proxy. Chromium has no close/detach signal, so a
 * release beyond a transfer is unobservable: moving a referenced pair, or
 * referencing a port of a split pair, is a named throw, never a hang.
 */

import { NotImplementedError } from '@riftydev/io';
import { ref as keepaliveRef, unref as keepaliveUnref } from './event-loop-keepalive.ts';

interface PortRecord {
  referenced: boolean;
  closed: boolean;
  /** This end was transferred away; its copy lives elsewhere. */
  moved: boolean;
  peer: PortRecord;
}

interface MessagePortRefState {
  readonly channel: typeof MessageChannel;
}

type NativeMethod = (this: unknown, ...args: unknown[]) => unknown;
type Forward = (list: readonly unknown[]) => unknown;

const STATE = Symbol.for('rifty.runtime-js.message-port-ref.v1');
const TRANSFERRED_HINT =
  'rifty cannot observe the release of a MessagePort whose pair was split by a transfer (ADR-0447)';

function isObject(value: unknown): value is object {
  return (typeof value === 'object' && value !== null) || typeof value === 'function';
}

function nativeGetter(target: object, key: PropertyKey): NativeMethod {
  const get = Object.getOwnPropertyDescriptor(target, key)?.get;
  if (get === undefined) throw new Error(`message-port-ref: no native ${String(key)} getter`);
  return get as NativeMethod;
}

function ownerOf(object: object, key: PropertyKey): object | null {
  for (let owner: object | null = object; owner !== null; owner = Object.getPrototypeOf(owner)) {
    if (Object.prototype.hasOwnProperty.call(owner, key)) return owner;
  }
  return null;
}

/**
 * Replace a method in place, keeping its descriptor attributes, `name` and
 * `length`. The wrapper is a method (no `prototype`, not constructible).
 */
function wrapMethod(
  owner: object,
  key: string,
  wrap: (native: NativeMethod, receiver: unknown, args: unknown[]) => unknown,
): void {
  const descriptor = Object.getOwnPropertyDescriptor(owner, key);
  const native = descriptor?.value as NativeMethod | undefined;
  if (typeof native !== 'function') return;
  const wrapper = {
    [key](this: unknown, ...args: unknown[]): unknown {
      return wrap(native, this, args);
    },
  }[key] as NativeMethod;
  Object.defineProperty(wrapper, 'length', { value: native.length });
  Object.defineProperty(owner, key, { ...descriptor, value: wrapper });
}

/**
 * WebIDL sequence conversion, read once: stops at the first non-object, where the
 * native conversion throws its own TypeError when handed the list.
 */
function readSequence(iterable: object, method: NativeMethod): unknown[] {
  const iterator = Reflect.apply(method, iterable, []);
  if (!isObject(iterator))
    throw new TypeError('Result of the Symbol.iterator method is not an object');
  const next = (iterator as { next?: unknown }).next as NativeMethod;
  const list: unknown[] = [];
  for (;;) {
    const step = Reflect.apply(next, iterator, []);
    if (!isObject(step)) throw new TypeError(`Iterator result ${String(step)} is not an object`);
    if ((step as IteratorResult<unknown>).done) return list;
    const value = (step as IteratorResult<unknown>).value;
    list.push(value);
    if (!isObject(value)) return list;
  }
}

/**
 * Read a transfer argument exactly once and build the argument the native call
 * gets instead. `null` = nothing to read (native handles `undefined`/`null`/
 * primitives itself). Non-iterable shapes are forwarded so native throws its own
 * TypeError. Options keep the caller's object as prototype, so any other member
 * the native reads (`includeUserActivation`) is read from it, once.
 */
function readTransfer(
  argument: unknown,
  sequenceOverload: boolean,
): { readonly list: readonly unknown[]; readonly forward: Forward } | null {
  if (!isObject(argument)) return null;
  if (sequenceOverload) {
    const method = (argument as { [Symbol.iterator]?: unknown })[Symbol.iterator];
    if (method !== undefined && method !== null) {
      if (typeof method !== 'function') {
        return { list: [], forward: () => ({ [Symbol.iterator]: method }) };
      }
      return { list: readSequence(argument, method as NativeMethod), forward: (list) => list };
    }
  }
  const options = (transfer: unknown): object =>
    Object.create(argument, {
      [Symbol.iterator]: { value: undefined },
      transfer: { value: transfer },
    });
  const transfer = (argument as { transfer?: unknown }).transfer;
  if (!isObject(transfer)) return { list: [], forward: () => options(transfer) };
  const method = (transfer as { [Symbol.iterator]?: unknown })[Symbol.iterator];
  if (typeof method !== 'function') {
    return { list: [], forward: () => options({ [Symbol.iterator]: method }) };
  }
  return {
    list: readSequence(transfer, method as NativeMethod),
    forward: (list) => options(list),
  };
}

/** `require('node:worker_threads').MessageChannel`: the recorded constructor once installed. */
export function nodeMessageChannel(): typeof MessageChannel | undefined {
  const state = (globalThis as { [STATE]?: MessagePortRefState })[STATE];
  return state?.channel ?? globalThis.MessageChannel;
}

/**
 * Install ADR-0447 in this realm (Node child realms, pre-entry). Skipped where
 * ports already have `ref` (the Node host, or a second bundle in the realm).
 */
export function installMessagePortReference(): void {
  const realm = globalThis as typeof globalThis & { [STATE]?: MessagePortRefState };
  const Port = realm.MessagePort;
  const Channel = realm.MessageChannel;
  if (typeof Port !== 'function' || typeof Channel !== 'function') return;
  if ('ref' in Port.prototype || realm[STATE] !== undefined) return;

  const records = new WeakMap<object, PortRecord>();
  const portBrand = nativeGetter(Port.prototype, 'onmessage');
  const port1 = nativeGetter(Channel.prototype, 'port1');
  const port2 = nativeGetter(Channel.prototype, 'port2');
  const isDetached = nativeGetter(ArrayBuffer.prototype, 'detached');

  const recordOf = (port: unknown): PortRecord | undefined => {
    Reflect.apply(portBrand, port, []); // TypeError: Illegal invocation, as in Node
    return records.get(port as object);
  };
  const release = (record: PortRecord): void => {
    record.closed = true;
    if (!record.referenced) return;
    record.referenced = false;
    keepaliveUnref();
  };

  const channel = new Proxy(Channel, {
    construct(target, args, newTarget) {
      const created = Reflect.construct(target, args, newTarget) as MessageChannel;
      const first = { referenced: false, closed: false, moved: false } as PortRecord;
      const second: PortRecord = { referenced: false, closed: false, moved: false, peer: first };
      first.peer = second;
      records.set(Reflect.apply(port1, created, []) as object, first);
      records.set(Reflect.apply(port2, created, []) as object, second);
      return created;
    },
  });

  const methods = {
    ref(this: unknown): void {
      const record = recordOf(this);
      if (record?.closed === true) return;
      if (record === undefined || record.peer.moved) {
        throw new NotImplementedError('MessagePort.ref.transferred', TRANSFERRED_HINT);
      }
      if (record.referenced) return;
      record.referenced = true;
      keepaliveRef();
    },
    unref(this: unknown): void {
      const record = recordOf(this);
      if (record?.referenced !== true) return;
      record.referenced = false;
      keepaliveUnref();
    },
    hasRef(this: unknown): boolean {
      return recordOf(this)?.referenced === true;
    },
  };
  for (const [key, value] of Object.entries(methods)) {
    Object.defineProperty(Port.prototype, key, {
      value,
      writable: true,
      enumerable: true,
      configurable: true,
    });
  }

  // Node: closing either end closes the pair. A moved end's close is a native no-op.
  wrapMethod(Port.prototype, 'close', (native, receiver, args) => {
    const result = Reflect.apply(native, receiver, args);
    const record = records.get(receiver as object);
    if (record !== undefined && !record.moved) {
      release(record);
      release(record.peer);
    }
    return result;
  });

  /**
   * One transfer check for every entry point that moves a port. A referenced
   * pair is refused before anything detaches; recorded ports that really moved
   * (a probe buffer rides along: Chromium drops a closed port's transfer) are
   * released as closed. The native return value is kept.
   */
  const transferring =
    (receiverOk: (receiver: unknown) => boolean, sequenceOverload: boolean) =>
    (native: NativeMethod, receiver: unknown, args: unknown[]): unknown => {
      if (args.length < 2 || !receiverOk(receiver)) return Reflect.apply(native, receiver, args);
      const read = readTransfer(args[1], sequenceOverload);
      if (read === null) return Reflect.apply(native, receiver, args);
      const moving: PortRecord[] = [];
      for (const item of read.list) {
        const record = records.get(item as object);
        if (record === undefined) continue;
        if (record.referenced || record.peer.referenced) {
          throw new NotImplementedError(
            'MessagePort.transfer.referenced',
            'a referenced MessagePort pair cannot be transferred in rifty (ADR-0447)',
          );
        }
        moving.push(record);
      }
      const forwarded = args.slice();
      if (moving.length === 0) {
        forwarded[1] = read.forward(read.list);
        return Reflect.apply(native, receiver, forwarded);
      }
      const probe = new ArrayBuffer(0);
      forwarded[1] = read.forward([...read.list, probe]);
      const result = Reflect.apply(native, receiver, forwarded);
      if (Reflect.apply(isDetached, probe, []) === true) {
        for (const record of moving) {
          record.moved = true;
          release(record);
        }
      }
      return result;
    };
  const branded =
    (brand: NativeMethod) =>
    (receiver: unknown): boolean => {
      try {
        Reflect.apply(brand, receiver, []);
        return true;
      } catch {
        return false;
      }
    };

  wrapMethod(Port.prototype, 'postMessage', transferring(branded(portBrand), true));
  const WorkerCtor = realm.Worker;
  if (typeof WorkerCtor === 'function') {
    const workerBrand = nativeGetter(WorkerCtor.prototype, 'onmessage');
    wrapMethod(WorkerCtor.prototype, 'postMessage', transferring(branded(workerBrand), true));
  }
  // Realm operations (`postMessage` on the worker global, `structuredClone`).
  const isRealm = (receiver: unknown): boolean =>
    receiver === undefined || receiver === null || receiver === realm;
  for (const [key, sequenceOverload] of [
    ['postMessage', true],
    ['structuredClone', false],
  ] as const) {
    const owner = ownerOf(realm, key);
    const operation = transferring(isRealm, sequenceOverload);
    if (owner !== null) {
      wrapMethod(owner, key, (native, receiver, args) =>
        operation(native, receiver ?? realm, args),
      );
    }
  }

  const prototypeConstructor = Object.getOwnPropertyDescriptor(Channel.prototype, 'constructor');
  Object.defineProperty(Channel.prototype, 'constructor', {
    ...prototypeConstructor,
    value: channel,
  });
  const globalChannel = Object.getOwnPropertyDescriptor(realm, 'MessageChannel');
  Object.defineProperty(realm, 'MessageChannel', { ...globalChannel, value: channel });
  Object.defineProperty(realm, STATE, { value: { channel } satisfies MessagePortRefState });
}
