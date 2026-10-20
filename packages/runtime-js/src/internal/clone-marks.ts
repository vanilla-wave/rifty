/**
 * `worker_threads.markAsUntransferable` / `markAsUncloneable` tags and the one
 * clone-admission walk every in-realm structured-clone surface runs first.
 *
 * Node keeps these flags in V8 slots the serializer reads. Chromium's serializer
 * cannot see a JS-side tag, so `assertCloneable` rejects a tagged reachable
 * object before the native clone with Node's `DataCloneError`. Reach mirrors the
 * serializer: plain objects/arrays (own enumerable string keys, accessors
 * invoked), Map keys+values, Set values; everything else is a leaf the native
 * clone judges. undici tags every Fetch class instance in its constructor.
 */

import { installedProxyIdentity } from './proxy-identity.ts';

const untransferable = new WeakSet<object>();
const uncloneable = new WeakSet<object>();
/** Set by the first `markAsUncloneable`; a realm without tags never walks. */
let anyUncloneable = false;

const weakHas = WeakSet.prototype.has;
const weakAdd = WeakSet.prototype.add;
const ownKeys = Reflect.ownKeys;
const getDescriptor = Object.getOwnPropertyDescriptor;
const reflectGet = Reflect.get;
const toStringTag = Object.prototype.toString;
const mapForEach = Map.prototype.forEach;
const setForEach = Set.prototype.forEach;
const apply = Reflect.apply;

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

/** Not in Node's public surface; rifty's admission walk reads it. */
export function isMarkedAsUncloneable(object: unknown): boolean {
  return isObjectLike(object) && apply(weakHas, uncloneable, [object]) === true;
}

function dataCloneError(): DOMException {
  return new DOMException(CLONE_MESSAGE, 'DataCloneError');
}

function walk(value: unknown, visited: Set<object>): void {
  if (!isObjectLike(value)) return;
  if (apply(weakHas, uncloneable, [value]) === true) throw dataCloneError();
  if (typeof value === 'function' || visited.has(value)) return;
  if (installedProxyIdentity()?.isProxy(value) === true) return;
  const tag = apply(toStringTag, value, []) as string;
  if (tag === '[object Map]') {
    visited.add(value);
    apply(mapForEach, value, [
      (entry: unknown, key: unknown) => {
        walk(key, visited);
        walk(entry, visited);
      },
    ]);
    return;
  }
  if (tag === '[object Set]') {
    visited.add(value);
    apply(setForEach, value, [(entry: unknown) => walk(entry, visited)]);
    return;
  }
  if (tag !== '[object Object]' && tag !== '[object Array]') return;
  visited.add(value);
  for (const key of ownKeys(value)) {
    if (typeof key !== 'string') continue;
    const descriptor = getDescriptor(value, key);
    if (descriptor === undefined || descriptor.enumerable !== true) continue;
    walk('value' in descriptor ? descriptor.value : reflectGet(value, key), visited);
  }
}

/**
 * Throw the realm's `DOMException('Cannot clone object of unsupported type.',
 * 'DataCloneError')` when `value`'s clone graph reaches a `markAsUncloneable`
 * tag. Accessors are invoked as the serializer would (so the native clone that
 * follows reads them a second time — documented divergence).
 */
export function assertCloneable(value: unknown): void {
  if (!anyUncloneable) return;
  walk(value, new Set());
}
