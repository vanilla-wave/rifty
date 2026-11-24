/**
 * Node's `isInsideNodeModules(frameLimit)` (`src/node_util.cc`, v24.16.0) for DEP0169 (ADR-0574
 * §4): `CurrentStackTrace(frameLimit)` from the caller (`urlParse`), skip frames with no script
 * name or Node's own, the first remaining one decides by `/node_modules/`. Node's own = every
 * frame that is not guest code: rifty compiles guest CJS/ESM/`-e` with `Function`/indirect eval,
 * so a guest frame is V8 `isEval()`. The guest's `stackTraceLimit` and `prepareStackTrace` are set
 * aside for the walk (Node's native walk sees neither).
 */
import { readPrepareStackTrace, writePrepareStackTrace } from '../vm/script-offsets.ts';

interface CallSite {
  isEval(): boolean;
  getScriptNameOrSourceURL(): unknown;
}
const errorCtor = Error as unknown as { stackTraceLimit?: unknown };
const capture = (Error as { captureStackTrace?: (target: object, fn?: unknown) => void })
  .captureStackTrace;
const { apply, defineProperty, deleteProperty, getOwnPropertyDescriptor } = Reflect;
const isArray = Array.isArray;
const regexpExec = RegExp.prototype.exec;
const rawSites = (_error: unknown, sites: unknown): unknown => sites;
const NODE_MODULES = /[\\/]node_modules[\\/]/;

/**
 * Set `Error.stackTraceLimit` for the walk through its descriptor (a guest's non-writable but
 * configurable limit too) and return the restorer. A non-configurable, non-writable limit stays:
 * the walk then sees at most that many frames (declared, compat modules.md `node:url`).
 */
function setLimit(limit: number): () => void {
  const saved = getOwnPropertyDescriptor(errorCtor, 'stackTraceLimit');
  const writable = {
    value: limit,
    writable: true,
    enumerable: saved?.enumerable ?? true,
    configurable: true,
  };
  if (!defineProperty(errorCtor, 'stackTraceLimit', writable)) return () => {};
  return () => {
    if (saved === undefined) deleteProperty(errorCtor, 'stackTraceLimit');
    else defineProperty(errorCtor, 'stackTraceLimit', saved);
  };
}

function callSites(limit: number): readonly CallSite[] {
  // Every rifty host is V8 (ADR-0469 tiers); without the API there is no stack to walk.
  if (typeof capture !== 'function') return [];
  const hook = readPrepareStackTrace();
  const holder: { stack?: unknown } = {};
  writePrepareStackTrace(rawSites);
  let restoreLimit = (): void => {};
  try {
    restoreLimit = setLimit(limit);
    capture(holder, isInsideNodeModules);
    const sites = holder.stack;
    return isArray(sites) ? (sites as CallSite[]) : [];
  } finally {
    // The guest's hook first: nothing below may leave ours installed.
    writePrepareStackTrace(hook);
    restoreLimit();
  }
}

export function isInsideNodeModules(frameLimit?: unknown): boolean {
  const limit = typeof frameLimit === 'number' && (frameLimit | 0) === frameLimit ? frameLimit : 10;
  for (const site of callSites(limit)) {
    if (typeof site.isEval !== 'function' || !site.isEval()) continue;
    const name = site.getScriptNameOrSourceURL();
    if (typeof name !== 'string' || name === '') continue;
    return apply(regexpExec, NODE_MODULES, [name]) !== null;
  }
  return false;
}
