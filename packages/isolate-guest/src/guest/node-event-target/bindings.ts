/**
 * Inputs of Node v24.16.0's generated `internal/event_target`/`internal/abort_controller`
 * (ADR-0579): `primordials` captured at bundle load (before guest code, Node's `makeSafe` shape),
 * the five validators and `internal/errors` texts those files throw, `internal/webidl` (node-blob's
 * evaluated copy), and the runtime's `events`, `inspect`, timers and `process`, the guest's
 * `DOMException` and clock. Everything else is upstream's text.
 */
import { EventEmitter } from '@riftydev/io';
import { riftyProcess } from '@riftydev/runtime-js/builtins/process';
import { clearTimeout, setTimeout } from '@riftydev/runtime-js/builtins/timers';
import { inspect } from '@riftydev/runtime-js/internal';
import { notImplemented } from '../loud.ts';
import { codes, hideStackFrames } from '../node-errors.ts';
import {
  customInspectSymbol,
  jsTransferable,
  kEmptyObject,
  kEnumerableProperty,
} from '../node-internal.ts';
import { DOMException, bridge } from '../web-shim.ts';
import createNodeEventTarget from './generated/node-event-target.js';

type Fn = (...args: never[]) => unknown;
type Ctor = abstract new (...args: never[]) => object;
const apply = Reflect.apply;
const ownKeys = Reflect.ownKeys;
const getOwnPropertyDescriptor = Reflect.getOwnPropertyDescriptor;
const reflectDefineProperty = Reflect.defineProperty;
const setPrototypeOf = Object.setPrototypeOf;
const freeze = Object.freeze;
const hasOwn = Object.hasOwn;
const isArray = Array.isArray;
const NumberIsInteger = Number.isInteger;
const uncurry =
  <T extends Fn>(f: T) =>
  (self: unknown, ...args: Parameters<T>): ReturnType<T> =>
    apply(f, self, args) as ReturnType<T>;
const SymbolIterator = Symbol.iterator;

// --- per_context/primordials: Node's `makeSafe` (copied members, safe iterators, frozen) ---
function createSafeIterator(factory: (self: unknown) => unknown, next: (it: unknown) => unknown) {
  class SafeIterator {
    _iterator: unknown;
    constructor(iterable: unknown) {
      this._iterator = factory(iterable);
    }
    next(): unknown {
      return next(this._iterator);
    }
    [SymbolIterator](): this {
      return this;
    }
  }
  setPrototypeOf(SafeIterator.prototype, null);
  freeze(SafeIterator.prototype);
  freeze(SafeIterator);
  return SafeIterator;
}
function copyProps(src: object, dest: object): void {
  for (const key of ownKeys(src))
    if (!getOwnPropertyDescriptor(dest, key))
      reflectDefineProperty(dest, key, {
        __proto__: null,
        ...getOwnPropertyDescriptor(src, key),
      } as PropertyDescriptor);
}
function makeSafe<T extends Ctor>(unsafe: Ctor, safe: T): T {
  const unsafeProto = unsafe.prototype as Record<PropertyKey, unknown>;
  const safeProto = safe.prototype as object;
  if (SymbolIterator in unsafeProto) {
    const dummy = new (unsafe as unknown as new () => object)();
    let next: ((it: unknown) => unknown) | undefined;
    for (const key of ownKeys(unsafeProto)) {
      if (getOwnPropertyDescriptor(safeProto, key)) continue;
      const desc = getOwnPropertyDescriptor(unsafeProto, key) as PropertyDescriptor;
      if (
        typeof desc.value === 'function' &&
        desc.value.length === 0 &&
        SymbolIterator in ((apply(desc.value, dummy, []) as object) ?? {})
      ) {
        const createIterator = uncurry(desc.value as Fn) as (self: unknown) => { next: Fn };
        next ??= uncurry(createIterator(dummy).next) as (it: unknown) => unknown;
        const SafeIterator = createSafeIterator(createIterator, next);
        desc.value = function (this: unknown) {
          return new SafeIterator(this);
        };
      }
      reflectDefineProperty(safeProto, key, { __proto__: null, ...desc } as PropertyDescriptor);
    }
  } else {
    copyProps(unsafeProto, safeProto);
  }
  copyProps(unsafe, safe);
  setPrototypeOf(safeProto, null);
  freeze(safeProto);
  freeze(safe);
  return safe;
}
const SafeMap = makeSafe(Map, class SafeMap extends Map {});
const SafeSet = makeSafe(Set, class SafeSet extends Set {});
const SafeWeakMap = makeSafe(WeakMap, class SafeWeakMap extends WeakMap {});
const SafeWeakSet = makeSafe(WeakSet, class SafeWeakSet extends WeakSet {});
const SafeWeakRef = makeSafe(WeakRef, class SafeWeakRef extends WeakRef<object> {});
const SafeFinalizationRegistry = makeSafe(
  FinalizationRegistry,
  class SafeFinalizationRegistry extends FinalizationRegistry<unknown> {},
);

const PromiseCtor = Promise;
const promiseResolve = Promise.resolve;
const primordials = freeze({
  __proto__: null,
  ArrayFrom: Array.from,
  ArrayPrototypePush: uncurry(Array.prototype.push),
  ArrayPrototypeReduce: uncurry(Array.prototype.reduce),
  Boolean,
  Error,
  FunctionPrototypeCall: uncurry(Function.prototype.call),
  NumberIsInteger,
  ObjectAssign: Object.assign,
  ObjectDefineProperties: Object.defineProperties,
  ObjectDefineProperty: Object.defineProperty,
  ObjectGetOwnPropertyDescriptor: Object.getOwnPropertyDescriptor,
  ObjectSetPrototypeOf: setPrototypeOf,
  PromiseResolve: (value?: unknown) => apply(promiseResolve, PromiseCtor, [value]),
  // Node: `Promise.withResolvers` (ES2024); its ES2022 equivalent (the shipped-bundle floor, ADR-0469).
  PromiseWithResolvers: () => {
    let resolve: unknown;
    let reject: unknown;
    const promise = new PromiseCtor((yes, no) => {
      resolve = yes;
      reject = no;
    });
    return { promise, resolve, reject };
  },
  ReflectApply: apply,
  SafeFinalizationRegistry,
  SafeMap,
  SafeSet,
  SafeWeakMap,
  SafeWeakRef,
  SafeWeakSet,
  String,
  Symbol,
  SymbolFor: Symbol.for,
  SymbolToStringTag: Symbol.toStringTag,
});

// --- internal/validators: the five these files call, Node's text ---
type HideErr = new (...args: unknown[]) => Error;
const ERR_INVALID_ARG_TYPE = codes.ERR_INVALID_ARG_TYPE.HideStackFramesError as HideErr;
const ERR_INVALID_THIS = codes.ERR_INVALID_THIS.HideStackFramesError as HideErr;
const ERR_OUT_OF_RANGE = codes.ERR_OUT_OF_RANGE.HideStackFramesError as HideErr;
const kValidateObjectNone = 0;
const kValidateObjectAllowNullable = 1 << 0;
const kValidateObjectAllowArray = 1 << 1;
const kValidateObjectAllowFunction = 1 << 2;
const kValidateObjectAllowObjects = kValidateObjectAllowArray | kValidateObjectAllowFunction;
const hasOwnProperty = uncurry(Object.prototype.hasOwnProperty);
const validators = freeze({
  __proto__: null,
  kValidateObjectAllowObjects,
  validateObject: hideStackFrames(
    (value: unknown, name: string, options: number = kValidateObjectNone) => {
      if (options === kValidateObjectNone) {
        if (value === null || isArray(value)) throw new ERR_INVALID_ARG_TYPE(name, 'Object', value);
        if (typeof value !== 'object') throw new ERR_INVALID_ARG_TYPE(name, 'Object', value);
      } else {
        const throwOnNullable = (kValidateObjectAllowNullable & options) === 0;
        if (throwOnNullable && value === null)
          throw new ERR_INVALID_ARG_TYPE(name, 'Object', value);
        const throwOnArray = (kValidateObjectAllowArray & options) === 0;
        if (throwOnArray && isArray(value)) throw new ERR_INVALID_ARG_TYPE(name, 'Object', value);
        const throwOnFunction = (kValidateObjectAllowFunction & options) === 0;
        const typeofValue = typeof value;
        if (typeofValue !== 'object' && (throwOnFunction || typeofValue !== 'function'))
          throw new ERR_INVALID_ARG_TYPE(name, 'Object', value);
      }
    },
  ),
  validateUint32: hideStackFrames((value: unknown, name: string, positive = false) => {
    if (typeof value !== 'number') throw new ERR_INVALID_ARG_TYPE(name, 'number', value);
    if (!NumberIsInteger(value)) throw new ERR_OUT_OF_RANGE(name, 'an integer', value);
    const min = positive ? 1 : 0;
    const max = 4_294_967_295;
    if (value < min || value > max)
      throw new ERR_OUT_OF_RANGE(name, `>= ${min} && <= ${max}`, value);
  }),
  validateString: hideStackFrames((value: unknown, name: string) => {
    if (typeof value !== 'string') throw new ERR_INVALID_ARG_TYPE(name, 'string', value);
  }),
  validateAbortSignal: hideStackFrames((signal: unknown, name: string) => {
    if (
      signal !== undefined &&
      (signal === null || typeof signal !== 'object' || !('aborted' in signal))
    )
      throw new ERR_INVALID_ARG_TYPE(name, 'AbortSignal', signal);
  }),
  validateThisInternalField: hideStackFrames(
    (object: unknown, fieldKey: PropertyKey, className: string) => {
      if (typeof object !== 'object' || object === null || !hasOwnProperty(object, fieldKey))
        throw new ERR_INVALID_THIS(className);
    },
  ),
});

/** `internal/assert`: an invariant the sources state, not a guest input. */
function assert(value: unknown, message?: string): void {
  if (!value) throw new codes.ERR_INTERNAL_ASSERTION(message as never);
}
const now = () => bridge.now();
const messageChannelGap = (): never => {
  throw notImplemented(
    'isolate-host.MessageChannel',
    'not available in the rifty isolate host, ADR-0557',
  );
};

function bound(table: Readonly<Record<string, unknown>>, id: string): unknown {
  if (!hasOwn(table, id)) throw new Error(`node-event-target: unbound ${id}`);
  return table[id];
}

export interface EventClasses {
  readonly EventTarget: unknown;
  readonly Event: unknown;
  readonly CustomEvent: unknown;
  readonly AbortController: unknown;
  readonly AbortSignal: unknown;
  /** The modules' exports, for Node sources that `require` them (the stream core, ADR-0575). */
  readonly eventTarget: Readonly<Record<string, unknown>>;
  readonly abortController: Readonly<Record<string, unknown>>;
}

/** Evaluates Node's two files once, over node-blob's evaluated `internal/webidl`. */
export function createEventClasses(webidl: unknown): EventClasses {
  const BOUND: Readonly<Record<string, unknown>> = {
    events: EventEmitter,
    'internal/assert': assert,
    'internal/errors': { codes },
    'internal/perf/utils': { now },
    'internal/util': { customInspectSymbol, kEmptyObject, kEnumerableProperty },
    'internal/util/inspect': { inspect },
    'internal/validators': validators,
    'internal/webidl': webidl,
    // Reached only by transferring a signal (`structuredClone`/`postMessage`, ceilings here).
    'internal/worker/io': {
      get MessageChannel() {
        return messageChannelGap();
      },
    },
    'internal/worker/js_transferable': jsTransferable,
    timers: { clearTimeout, setTimeout },
    util: { inspect },
  };
  const BINDINGS: Readonly<Record<string, unknown>> = { messaging: { DOMException } };
  const { eventTarget, abortController } = createNodeEventTarget(
    primordials,
    (id) => bound(BINDINGS, id),
    (id) => bound(BOUND, id),
    riftyProcess,
  );
  return {
    EventTarget: eventTarget.EventTarget,
    Event: eventTarget.Event,
    CustomEvent: eventTarget.CustomEvent,
    AbortController: abortController.AbortController,
    AbortSignal: abortController.AbortSignal,
    eventTarget,
    abortController,
  };
}
