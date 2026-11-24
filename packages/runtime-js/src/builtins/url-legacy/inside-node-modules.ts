/**
 * Node's `isInsideNodeModules(frameLimit)` (`src/node_util.cc`, v24.16.0) for DEP0169 (ADR-0574
 * §4): `CurrentStackTrace(frameLimit)` from the caller (`urlParse`), skip frames with no script
 * name or Node's own, the first remaining one decides by `/node_modules/`. Node's own = every
 * frame that is not guest code: rifty compiles guest CJS/ESM/`-e` with `Function`/indirect eval,
 * so a guest frame is V8 `isEval()`.
 *
 * A lookup, never a side effect (review round 2): it runs no guest code, throws nothing and leaves
 * `Error` as it found it. When the walk is impossible — the guest made `Error.prepareStackTrace`
 * or `Error.stackTraceLimit` unsettable (frozen, non-extensible, an accessor, a sealed limit
 * below the window) or the capture throws — the answer is "unknown", reported as inside
 * `node_modules`: DEP0169 is then not emitted (declared, compat modules.md `node:url`).
 */
import {
  ownsPrepareStackTrace,
  readPrepareStackTrace,
  writePrepareStackTrace,
} from '../vm/script-offsets.ts';

interface CallSite {
  isEval(): boolean;
  getScriptNameOrSourceURL(): unknown;
}
const errorCtor = Error as unknown as Record<string, unknown>;
const capture = (Error as { captureStackTrace?: (target: object, fn?: unknown) => void })
  .captureStackTrace;
const { apply, defineProperty, deleteProperty, getOwnPropertyDescriptor, isExtensible } = Reflect;
const isArray = Array.isArray;
const regexpExec = RegExp.prototype.exec;
const rawSites = (_error: unknown, sites: unknown): unknown => sites;
const NODE_MODULES = /[\\/]node_modules[\\/]/;
type Restore = () => void;

/**
 * Give `Error`'s own data slot `key` the value `value` and return its exact restorer, or
 * `undefined` where that needs guest code (an accessor) or cannot be undone. `enough`: a value
 * the slot may keep as is.
 */
function setSlot(
  key: string,
  value: unknown,
  enough?: (current: unknown) => boolean,
): Restore | undefined {
  const saved = getOwnPropertyDescriptor(errorCtor, key);
  if (saved === undefined) {
    if (!isExtensible(errorCtor)) return undefined;
    const fresh = { value, writable: true, enumerable: true, configurable: true };
    return defineProperty(errorCtor, key, fresh)
      ? () => void deleteProperty(errorCtor, key)
      : undefined;
  }
  if (!('value' in saved)) return undefined;
  if (enough?.(saved.value)) return () => {};
  if (saved.writable)
    return defineProperty(errorCtor, key, { value })
      ? () => void defineProperty(errorCtor, key, { value: saved.value })
      : undefined;
  if (!saved.configurable) return undefined;
  return defineProperty(errorCtor, key, { value, writable: true })
    ? () => void defineProperty(errorCtor, key, saved)
    : undefined;
}

/** Our hook in the slot: through rifty's owner when it holds the slot (no guest code), else the data slot. */
function setHook(): Restore | undefined {
  if (ownsPrepareStackTrace()) {
    const hook = readPrepareStackTrace();
    writePrepareStackTrace(rawSites);
    return () => writePrepareStackTrace(hook);
  }
  return setSlot('prepareStackTrace', rawSites);
}

/** The first `limit` call sites above `isInsideNodeModules`, or `undefined` when they cannot be read. */
function callSites(limit: number): readonly CallSite[] | undefined {
  // Every rifty host is V8 (ADR-0469 tiers); without the API there is no stack to walk.
  if (typeof capture !== 'function') return undefined;
  let restoreHook: Restore | undefined;
  let restoreLimit: Restore | undefined;
  try {
    restoreHook = setHook();
    if (restoreHook === undefined) return undefined;
    restoreLimit = setSlot('stackTraceLimit', limit, (v) => typeof v === 'number' && v >= limit);
    if (restoreLimit === undefined) return undefined;
    const holder: { stack?: unknown } = {};
    capture(holder, isInsideNodeModules);
    const sites = holder.stack;
    return isArray(sites) ? (sites as CallSite[]) : undefined;
  } catch {
    return undefined;
  } finally {
    // The guest's hook first: nothing below may leave ours installed.
    try {
      restoreHook?.();
    } finally {
      restoreLimit?.();
    }
  }
}

export function isInsideNodeModules(frameLimit?: unknown): boolean {
  const limit = typeof frameLimit === 'number' && (frameLimit | 0) === frameLimit ? frameLimit : 10;
  const sites = callSites(limit);
  if (sites === undefined) return true;
  for (let i = 0; i < sites.length && i < limit; i++) {
    const site = sites[i] as CallSite;
    if (typeof site.isEval !== 'function' || !site.isEval()) continue;
    const name = site.getScriptNameOrSourceURL();
    if (typeof name !== 'string' || name === '') continue;
    return apply(regexpExec, NODE_MODULES, [name]) !== null;
  }
  return false;
}
