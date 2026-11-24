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
const rawSites = (_error: unknown, sites: unknown): unknown => sites;
const NODE_MODULES = /[\\/]node_modules[\\/]/;

function callSites(limit: number): readonly CallSite[] {
  // Every rifty host is V8 (ADR-0469 tiers); without the API there is no stack to walk.
  if (typeof capture !== 'function') return [];
  const hook = readPrepareStackTrace();
  const hadLimit = Object.hasOwn(errorCtor, 'stackTraceLimit');
  const savedLimit = errorCtor.stackTraceLimit;
  const holder: { stack?: unknown } = {};
  writePrepareStackTrace(rawSites);
  try {
    errorCtor.stackTraceLimit = limit;
    capture(holder, isInsideNodeModules);
    const sites = holder.stack;
    return Array.isArray(sites) ? (sites as CallSite[]) : [];
  } finally {
    if (hadLimit) errorCtor.stackTraceLimit = savedLimit;
    else Reflect.deleteProperty(errorCtor, 'stackTraceLimit');
    writePrepareStackTrace(hook);
  }
}

export function isInsideNodeModules(frameLimit?: unknown): boolean {
  const limit = typeof frameLimit === 'number' && (frameLimit | 0) === frameLimit ? frameLimit : 10;
  for (const site of callSites(limit)) {
    if (typeof site.isEval !== 'function' || !site.isEval()) continue;
    const name = site.getScriptNameOrSourceURL();
    if (typeof name !== 'string' || name === '') continue;
    return NODE_MODULES.test(name);
  }
  return false;
}
