/**
 * `worker_threads.markAsUntransferable` / `markAsUncloneable` tags and the one
 * clone admission every in-realm structured-clone surface runs first.
 *
 * Node keeps these flags in V8 slots its serializer reads; Chromium's serializer
 * cannot see a JS-side tag. `admitClone` therefore projects the message graph
 * the way V8's ValueSerializer reads it and hands the native clone a copy with
 * data properties only, throwing Node's `DataCloneError` at a tagged object.
 * Intrinsics typed by internal slot (Array, Map, Set, Date, RegExp, buffers,
 * views, primitive wrappers) ignore the tag; ordinary objects — class and
 * null-prototype instances, spoofed prototypes/`Symbol.toStringTag` — honour it
 * and recurse own enumerable string keys (accessors read once); Errors honour
 * it and recurse their own data `cause`. Leaves (platform objects, functions,
 * Proxies, intrinsics) stay by reference and never check a tag: transfer-list
 * identity and the native judgement are untouched. undici tags every Fetch
 * class instance.
 *
 * Tags live in one realm-global record so every bundle copy (node-entry child,
 * kernel host) sees the same marks.
 */

import { installedProxyIdentity } from './proxy-identity.ts';

interface CloneMarks {
  readonly untransferable: WeakSet<object>;
  readonly uncloneable: WeakSet<object>;
  /** Set by the first `markAsUncloneable`; a realm without tags never projects. */
  readonly state: { any: boolean };
}

const MARKS = Symbol.for('rifty.runtime-js.clone-marks.v1');

function realmMarks(): CloneMarks {
  const realm = globalThis as typeof globalThis & { [MARKS]?: CloneMarks };
  const existing = realm[MARKS];
  if (existing !== undefined) return existing;
  const marks: CloneMarks = Object.freeze({
    untransferable: new WeakSet<object>(),
    uncloneable: new WeakSet<object>(),
    state: { any: false },
  });
  Object.defineProperty(realm, MARKS, { value: marks });
  return marks;
}

const marks = realmMarks();

type NativeMethod = (this: unknown, ...args: unknown[]) => unknown;
const apply = Reflect.apply;
const weakHas = WeakSet.prototype.has;
const weakAdd = WeakSet.prototype.add;
const ownKeys = Reflect.ownKeys;
const getDescriptor = Object.getOwnPropertyDescriptor;
const defineProperty = Object.defineProperty;
const reflectGet = Reflect.get;
const getPrototypeOf = Object.getPrototypeOf;
const isArray = Array.isArray;
const isView = ArrayBuffer.isView;
const isError: ((value: unknown) => boolean) | undefined = (
  Error as { isError?: (value: unknown) => boolean }
).isError;
const objectToString = Object.prototype.toString;
const functionToString = Function.prototype.toString;
const mapForEach = Map.prototype.forEach;
const setForEach = Set.prototype.forEach;
const mapSet = Map.prototype.set;
const setAdd = Set.prototype.add;
const MapCtor = Map;
const SetCtor = Set;
const ArrayCtor = Array;
const toStringTag = Symbol.toStringTag;
const ObjectPrototype = Object.prototype;

const getter = (proto: object, key: string): NativeMethod => {
  const get = getDescriptor(proto, key)?.get;
  if (get === undefined) throw new Error(`clone-marks: no ${key} getter`);
  return get as NativeMethod;
};
/** Intrinsic brands (internal-slot checks): the mark is ignored, the native clone types them. */
const mapBrand = Map.prototype.has as NativeMethod;
const setBrand = Set.prototype.has as NativeMethod;
const intrinsicBrands: readonly NativeMethod[] = [
  mapBrand,
  setBrand,
  Date.prototype.getTime as NativeMethod,
  getter(RegExp.prototype, 'source'),
  getter(ArrayBuffer.prototype, 'byteLength'),
  Boolean.prototype.valueOf as NativeMethod,
  Number.prototype.valueOf as NativeMethod,
  String.prototype.valueOf as NativeMethod,
  BigInt.prototype.valueOf as NativeMethod,
  Symbol.prototype.valueOf as NativeMethod,
  ...(typeof SharedArrayBuffer === 'function'
    ? [getter(SharedArrayBuffer.prototype, 'byteLength')]
    : []),
];

const CLONE_MESSAGE = 'Cannot clone object of unsupported type.';

function isObjectLike(value: unknown): value is object {
  return (typeof value === 'object' && value !== null) || typeof value === 'function';
}

/** Tag `object` to be cloned, never transferred. Mirrors Node: ignores non-objects. */
export function markAsUntransferable(object: unknown): void {
  if (isObjectLike(object)) apply(weakAdd, marks.untransferable, [object]);
}

export function isMarkedAsUntransferable(object: unknown): boolean {
  return isObjectLike(object) && apply(weakHas, marks.untransferable, [object]) === true;
}

/** Tag `object` so any clone of a graph reaching it throws `DataCloneError`. */
export function markAsUncloneable(object: unknown): void {
  if (!isObjectLike(object)) return;
  marks.state.any = true;
  apply(weakAdd, marks.uncloneable, [object]);
}

/** Not in Node's public surface; rifty's admission reads it. */
export function isMarkedAsUncloneable(object: unknown): boolean {
  return isObjectLike(object) && apply(weakHas, marks.uncloneable, [object]) === true;
}

function dataCloneError(): DOMException {
  return new DOMException(CLONE_MESSAGE, 'DataCloneError');
}

function branded(method: NativeMethod, value: object): boolean {
  try {
    apply(method, value, [undefined]);
    return true;
  } catch {
    return false;
  }
}

function isIntrinsic(value: object): boolean {
  if (isView(value)) return true;
  for (const brand of intrinsicBrands) if (branded(brand, value)) return true;
  return false;
}

function errorBrand(value: object): boolean {
  if (isError !== undefined) return isError(value);
  return apply(objectToString, value, []) === '[object Error]' && !(toStringTag in value);
}

/**
 * Platform (WebIDL/host) object? Walk to the first prototype that owns
 * `Symbol.toStringTag` or is the `prototype` of a native constructor. A JS
 * constructor there (undici's classes) means ordinary. A native one is probed
 * with one of its own accessors on the value: "Illegal invocation" = a JS object
 * wearing that prototype (ordinary for V8); success = platform object. Without
 * an accessor, a tagged native prototype is platform (WebAssembly.Module); a
 * bare intrinsic one (`Date.prototype`, `Error.prototype` on a non-Date/Error)
 * is ordinary.
 */
function isPlatformObject(value: object): boolean {
  for (let proto = getPrototypeOf(value); proto !== null; proto = getPrototypeOf(proto)) {
    if (proto === ObjectPrototype) return false;
    const hasTag = getDescriptor(proto, toStringTag) !== undefined;
    const ctor = getDescriptor(proto, 'constructor')?.value;
    const nativeCtor =
      typeof ctor === 'function' &&
      getDescriptor(ctor, 'prototype')?.value === proto &&
      apply(functionToString, ctor, []).includes('[native code]');
    if (!nativeCtor) {
      if (hasTag) return false; // JS class wearing a tag (undici Response): ordinary
      continue;
    }
    for (const key of ownKeys(proto)) {
      if (key === toStringTag) continue;
      const get = getDescriptor(proto, key)?.get;
      if (get !== undefined) return branded(get as NativeMethod, value);
    }
    return hasTag;
  }
  return false;
}

function define(target: object, key: string, value: unknown): void {
  defineProperty(target, key, { value, writable: true, enumerable: true, configurable: true });
}

interface Walk {
  readonly copies: WeakMap<object, unknown>;
  /** A real Error with an object `cause` was met: its subgraph cannot be projected. */
  errorCause: boolean;
}

function project(value: unknown, walk: Walk): unknown {
  if (!isObjectLike(value) || typeof value === 'function') return value;
  const seen = walk.copies.get(value);
  if (seen !== undefined) return seen;
  if (installedProxyIdentity()?.isProxy(value) === true) return value;
  if (isArray(value)) {
    const copy = new ArrayCtor((value as unknown[]).length);
    walk.copies.set(value, copy);
    projectOwn(value, copy, walk);
    return copy;
  }
  if (branded(mapBrand, value)) {
    const keys: unknown[] = [];
    const values: unknown[] = [];
    apply(mapForEach, value, [
      (entry: unknown, key: unknown) => {
        keys.push(key);
        values.push(entry);
      },
    ]);
    const copy = new MapCtor();
    walk.copies.set(value, copy);
    for (let i = 0; i < keys.length; i++) {
      apply(mapSet, copy, [project(keys[i], walk), project(values[i], walk)]);
    }
    return copy;
  }
  if (branded(setBrand, value)) {
    const entries: unknown[] = [];
    apply(setForEach, value, [(entry: unknown) => entries.push(entry)]);
    const copy = new SetCtor();
    walk.copies.set(value, copy);
    for (const entry of entries) apply(setAdd, copy, [project(entry, walk)]);
    return copy;
  }
  if (isIntrinsic(value)) return value;
  if (errorBrand(value)) {
    if (apply(weakHas, marks.uncloneable, [value]) === true) throw dataCloneError();
    walk.copies.set(value, value);
    const cause = getDescriptor(value, 'cause');
    if (cause !== undefined && 'value' in cause && isObjectLike(cause.value)) {
      walk.errorCause = true;
      project(cause.value, walk);
    }
    return value;
  }
  if (isPlatformObject(value)) return value;
  if (apply(weakHas, marks.uncloneable, [value]) === true) throw dataCloneError();
  const copy = {};
  walk.copies.set(value, copy);
  projectOwn(value, copy, walk);
  return copy;
}

/** Own enumerable string keys in `Reflect.ownKeys` order; each accessor read once. */
function projectOwn(source: object, copy: object, walk: Walk): void {
  for (const key of ownKeys(source)) {
    if (typeof key !== 'string') continue;
    const descriptor = getDescriptor(source, key);
    if (descriptor === undefined || descriptor.enumerable !== true) continue;
    const raw = 'value' in descriptor ? descriptor.value : reflectGet(source, key);
    define(copy, key, project(raw, walk));
  }
}

/**
 * Admit `value` for a structured clone and return what the native clone gets:
 * `value` itself while this realm has no `markAsUncloneable` tag; otherwise a
 * projection with every accessor read once. Throws the realm's
 * `DOMException('Cannot clone object of unsupported type.', 'DataCloneError')`
 * when the graph reaches a tagged ordinary object or Error. A graph holding a
 * real Error with an object `cause` is only walked: the original goes to the
 * native clone (an Error cannot be copied, and its cause may alias the rest of
 * the graph), so its getters are read again there.
 */
export function admitClone(value: unknown): unknown {
  if (!marks.state.any) return value;
  const walk: Walk = { copies: new WeakMap(), errorCause: false };
  const projection = project(value, walk);
  return walk.errorCause ? value : projection;
}
