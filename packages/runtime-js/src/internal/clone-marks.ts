/**
 * `worker_threads.markAsUntransferable` / `markAsUncloneable` tags and the one
 * clone admission every in-realm structured-clone surface runs first.
 *
 * Node keeps these flags in V8 slots its serializer reads; Chromium's serializer
 * cannot see a JS-side tag. `admitClone` therefore projects the message graph
 * the way the serializer reads it — plain objects/arrays by own enumerable
 * string keys (accessors read once), Map/Set entries, an Error's own data
 * `cause` — throwing Node's `DataCloneError` at a tagged object, and hands the
 * native clone a copy with data properties only. Leaves stay by reference so
 * transfer lists and the native judgement (buffers, platform objects, Date,
 * RegExp, wrappers, functions, Proxies) are untouched. undici tags every Fetch
 * class instance in its constructor.
 */

import { installedProxyIdentity } from './proxy-identity.ts';

const untransferable = new WeakSet<object>();
const uncloneable = new WeakSet<object>();
/** Set by the first `markAsUncloneable`; a realm without tags never projects. */
let anyUncloneable = false;

const apply = Reflect.apply;
const weakHas = WeakSet.prototype.has;
const weakAdd = WeakSet.prototype.add;
const ownKeys = Reflect.ownKeys;
const getDescriptor = Object.getOwnPropertyDescriptor;
const defineProperty = Object.defineProperty;
const reflectGet = Reflect.get;
const getPrototypeOf = Object.getPrototypeOf;
const isArray = Array.isArray;
type NativeMethod = (this: unknown, ...args: unknown[]) => unknown;
const mapHas: NativeMethod = Map.prototype.has;
const setHas: NativeMethod = Set.prototype.has;
const mapForEach = Map.prototype.forEach;
const setForEach = Set.prototype.forEach;
const mapSet = Map.prototype.set;
const setAdd = Set.prototype.add;
const functionToString = Function.prototype.toString;
const ObjectPrototype = Object.prototype;
const ArrayPrototype = Array.prototype;
const ErrorPrototype = Error.prototype;
const MapCtor = Map;
const SetCtor = Set;
const ArrayCtor = Array;

const CLONE_MESSAGE = 'Cannot clone object of unsupported type.';

function isObjectLike(value: unknown): value is object {
  return (typeof value === 'object' && value !== null) || typeof value === 'function';
}

/** Tag `object` to be cloned, never transferred. Mirrors Node: ignores non-objects. */
export function markAsUntransferable(object: unknown): void {
  if (isObjectLike(object)) apply(weakAdd, untransferable, [object]);
}

export function isMarkedAsUntransferable(object: unknown): boolean {
  return isObjectLike(object) && apply(weakHas, untransferable, [object]) === true;
}

/** Tag `object` so any clone of a graph reaching it throws `DataCloneError`. */
export function markAsUncloneable(object: unknown): void {
  if (!isObjectLike(object)) return;
  anyUncloneable = true;
  apply(weakAdd, uncloneable, [object]);
}

/** Not in Node's public surface; rifty's admission reads it. */
export function isMarkedAsUncloneable(object: unknown): boolean {
  return isObjectLike(object) && apply(weakHas, uncloneable, [object]) === true;
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

/** A prototype other than Object/Array's whose own `constructor` is native: platform/intrinsic object. */
function hasNativePrototype(value: object): boolean {
  for (let proto = getPrototypeOf(value); proto !== null; proto = getPrototypeOf(proto)) {
    if (proto === ObjectPrototype || proto === ArrayPrototype) continue;
    const ctor = getDescriptor(proto, 'constructor')?.value;
    if (typeof ctor === 'function' && apply(functionToString, ctor, []).includes('[native code]'))
      return true;
  }
  return false;
}

function isError(value: object): boolean {
  for (let proto = getPrototypeOf(value); proto !== null; proto = getPrototypeOf(proto)) {
    if (proto === ErrorPrototype) return true;
  }
  return false;
}

function define(target: object, key: string, value: unknown): void {
  defineProperty(target, key, { value, writable: true, enumerable: true, configurable: true });
}

function project(value: unknown, copies: WeakMap<object, unknown>): unknown {
  if (!isObjectLike(value)) return value;
  if (apply(weakHas, uncloneable, [value]) === true) throw dataCloneError();
  if (typeof value === 'function') return value;
  const seen = copies.get(value);
  if (seen !== undefined) return seen;
  if (installedProxyIdentity()?.isProxy(value) === true) return value;
  if (branded(mapHas, value)) {
    const copy = new MapCtor();
    copies.set(value, copy);
    apply(mapForEach, value, [
      (entry: unknown, key: unknown) => {
        apply(mapSet, copy, [project(key, copies), project(entry, copies)]);
      },
    ]);
    return copy;
  }
  if (branded(setHas, value)) {
    const copy = new SetCtor();
    copies.set(value, copy);
    apply(setForEach, value, [
      (entry: unknown) => {
        apply(setAdd, copy, [project(entry, copies)]);
      },
    ]);
    return copy;
  }
  if (isArray(value)) {
    const copy = new ArrayCtor((value as unknown[]).length);
    copies.set(value, copy);
    projectOwn(value, copy, copies);
    return copy;
  }
  if (isError(value)) return projectError(value, copies);
  if (hasNativePrototype(value)) return value;
  const copy = {};
  copies.set(value, copy);
  projectOwn(value, copy, copies);
  return copy;
}

/** Own enumerable string keys in `Reflect.ownKeys` order; each accessor read once. */
function projectOwn(source: object, copy: object, copies: WeakMap<object, unknown>): void {
  for (const key of ownKeys(source)) {
    if (typeof key !== 'string') continue;
    const descriptor = getDescriptor(source, key);
    if (descriptor === undefined || descriptor.enumerable !== true) continue;
    const raw = 'value' in descriptor ? descriptor.value : reflectGet(source, key);
    define(copy, key, project(raw, copies));
  }
}

/**
 * V8 serializes an Error's own data `cause` (accessor/inherited ignored). A
 * cause whose projection differs gets an Error copy on the same prototype with
 * the own properties re-applied as data (`stack` is read once), so the native
 * clone never re-reads the graph.
 */
function projectError(error: object, copies: WeakMap<object, unknown>): unknown {
  copies.set(error, error);
  const descriptor = getDescriptor(error, 'cause');
  if (descriptor === undefined || !('value' in descriptor)) return error;
  const cause = project(descriptor.value, copies);
  if (cause === descriptor.value) return error;
  const copy = Object.create(getPrototypeOf(error)) as object;
  copies.set(error, copy);
  for (const key of ownKeys(error)) {
    const own = getDescriptor(error, key);
    if (own === undefined) continue;
    if ('value' in own) defineProperty(copy, key, own);
    else
      defineProperty(copy, key, {
        value: reflectGet(error, key),
        writable: true,
        enumerable: own.enumerable,
        configurable: own.configurable,
      });
  }
  defineProperty(copy, 'cause', { ...descriptor, value: cause });
  return copy;
}

/**
 * Admit `value` for a structured clone: the projection the native clone gets
 * (`value` itself while this realm has no `markAsUncloneable` tag). Throws the
 * realm's `DOMException('Cannot clone object of unsupported type.',
 * 'DataCloneError')` when the graph reaches a tagged object.
 */
export function admitClone(value: unknown): unknown {
  if (!anyUncloneable) return value;
  return project(value, new WeakMap());
}
