/**
 * `worker_threads.markAsUntransferable` / `markAsUncloneable` tags and the one
 * clone admission every in-realm structured-clone surface runs first.
 *
 * Node keeps these flags in V8 slots its serializer reads; Chromium's serializer
 * cannot see a JS-side tag. `assertCloneable` walks the message graph the way
 * V8's ValueSerializer types it and throws Node's `DataCloneError` at a tagged
 * object; the native clone then runs on the ORIGINAL graph. The walk runs no
 * guest code and copies nothing: own enumerable string-keyed DATA properties
 * only, Map/Set entries via captured `forEach`, an Error's own data `cause`.
 * Ordinary objects (class/null-prototype instances, spoofed prototypes or
 * `Symbol.toStringTag`) and Errors honour the tag; intrinsics typed by internal
 * slot (Array, Map, Set, Date, RegExp, buffers, views, wrappers) ignore theirs;
 * functions and Proxies are leaves. A host object reads as ordinary: no own
 * enumerable data properties, no side effect, native still judges it — a tag
 * on it is honoured where Node ignores it (compat ⚠️). Ceilings: a tagged
 * object reachable only through an accessor is not seen (compat ❌); a getter
 * whose side effect removes a later tagged sibling still throws (compat ⚠️) —
 * running getters would make the native clone read them twice. undici tags
 * every Fetch class instance.
 *
 * Tags live in one realm-global record so every bundle copy (node-entry child,
 * kernel host) sees the same marks.
 */

import { installedProxyIdentity } from './proxy-identity.ts';

interface CloneMarks {
  readonly untransferable: WeakSet<object>;
  readonly uncloneable: WeakSet<object>;
  /** Set by the first `markAsUncloneable`; a realm without tags never walks. */
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

// Primordials captured at load: the walk runs in a realm the guest may have
// patched (`Set.prototype`, array iteration, `Object.prototype` accessors …) and
// must never execute guest code before the native clone reads the graph.
type NativeMethod = (this: unknown, ...args: unknown[]) => unknown;
const apply = Reflect.apply;
const WeakSetCtor = WeakSet;
const weakHas = WeakSet.prototype.has;
const weakAdd = WeakSet.prototype.add;
const ownKeys = Reflect.ownKeys;
const getDescriptor = Object.getOwnPropertyDescriptor;
const hasOwn = Object.prototype.hasOwnProperty;
const DOMExceptionCtor = DOMException;
const isArray = Array.isArray;
const isView = ArrayBuffer.isView;
const isError: ((value: unknown) => boolean) | undefined = (
  Error as { isError?: (value: unknown) => boolean }
).isError;
const mapForEach = Map.prototype.forEach;
const setForEach = Set.prototype.forEach;

const getter = (proto: object, key: string): NativeMethod => {
  const get = getDescriptor(proto, key)?.get;
  if (get === undefined) throw new Error(`clone-marks: no ${key} getter`);
  return get as NativeMethod;
};
const mapBrand = Map.prototype.has as NativeMethod;
const setBrand = Set.prototype.has as NativeMethod;
/** Intrinsic brands (internal-slot checks): the mark is ignored, the native clone types them. */
const intrinsicBrands: readonly NativeMethod[] = [
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
  return new DOMExceptionCtor(CLONE_MESSAGE, 'DataCloneError');
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
  for (let i = 0; i < intrinsicBrands.length; i++) {
    const brand = intrinsicBrands[i];
    if (brand !== undefined && branded(brand, value)) return true;
  }
  return false;
}

/** `Error.isError` (Chromium ≥134, Node 24); without it Errors read as ordinary — no getter runs. */
function errorBrand(value: object): boolean {
  return isError?.(value) === true;
}

function refuseTagged(value: object): void {
  if (apply(weakHas, marks.uncloneable, [value]) === true) throw dataCloneError();
}

function walk(value: unknown, visited: WeakSet<object>): void {
  if (!isObjectLike(value) || typeof value === 'function') return;
  if (apply(weakHas, visited, [value]) === true) return;
  apply(weakAdd, visited, [value]);
  if (installedProxyIdentity()?.isProxy(value) === true) return;
  if (isArray(value)) {
    walkOwnData(value, visited);
    return;
  }
  if (branded(mapBrand, value)) {
    apply(mapForEach, value, [
      (entry: unknown, key: unknown) => {
        walk(key, visited);
        walk(entry, visited);
      },
    ]);
    return;
  }
  if (branded(setBrand, value)) {
    apply(setForEach, value, [(entry: unknown) => walk(entry, visited)]);
    return;
  }
  if (isIntrinsic(value)) return;
  refuseTagged(value);
  if (errorBrand(value)) {
    const cause = getDescriptor(value, 'cause');
    if (cause !== undefined && isData(cause)) walk(cause.value, visited);
    return;
  }
  walkOwnData(value, visited);
}

/** Descriptor is a fresh object; `in` would also see a guest `Object.prototype.value` accessor. */
function isData(descriptor: PropertyDescriptor): boolean {
  return apply(hasOwn, descriptor, ['value']) === true;
}

/** Own enumerable string-keyed data properties; accessors are never read. */
function walkOwnData(source: object, visited: WeakSet<object>): void {
  const keys = ownKeys(source);
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    if (typeof key !== 'string') continue;
    const descriptor = getDescriptor(source, key);
    if (descriptor !== undefined && descriptor.enumerable === true && isData(descriptor)) {
      walk(descriptor.value, visited);
    }
  }
}

/**
 * Throw the realm's `DOMException('Cannot clone object of unsupported type.',
 * 'DataCloneError')` when `value`'s clone graph reaches a tagged ordinary
 * object or Error through data properties. Returns at once while this realm has
 * no `markAsUncloneable` tag.
 */
export function assertCloneable(value: unknown): void {
  if (!marks.state.any) return;
  walk(value, new WeakSetCtor());
}
