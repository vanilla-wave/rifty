// What the isolate guest's web-shim already gives every candidate (ADR-0557 §5): queueMicrotask,
// host timers, TextEncoder/TextDecoder (the guest's own text-codec.ts, bundled), DOMException
// (a copy of web-shim's class). Not counted in a candidate's size.
import {
  TextDecoder,
  TextEncoder,
} from '../../../../../../packages/isolate-guest/src/guest/text-codec.ts';
const g = globalThis;
const LEGACY_CODES = {
  IndexSizeError: 1,
  HierarchyRequestError: 3,
  WrongDocumentError: 4,
  InvalidCharacterError: 5,
  NoModificationAllowedError: 7,
  NotFoundError: 8,
  NotSupportedError: 9,
  InvalidStateError: 11,
  SyntaxError: 12,
  InvalidModificationError: 13,
  NamespaceError: 14,
  InvalidAccessError: 15,
  TypeMismatchError: 17,
  SecurityError: 18,
  NetworkError: 19,
  AbortError: 20,
  URLMismatchError: 21,
  QuotaExceededError: 22,
  TimeoutError: 23,
  InvalidNodeTypeError: 24,
  DataCloneError: 25,
};
class DOMException extends Error {
  #name;
  constructor(message = '', name = 'Error') {
    super(String(message));
    this.#name = String(name);
  }
  get name() {
    return this.#name;
  }
  get code() {
    return LEGACY_CODES[this.#name] ?? 0;
  }
}
const define = (k, v) =>
  Object.defineProperty(g, k, { value: v, writable: true, configurable: true, enumerable: false });
define('DOMException', DOMException);
define('TextEncoder', TextEncoder);
define('TextDecoder', TextDecoder);
define('queueMicrotask', (f) => {
  Promise.resolve().then(f);
});
const timers = new Map();
let next = 1;
define('setTimeout', (fn, ms, ...args) => {
  const id = next++;
  timers.set(id, () => fn(...args));
  g.__hostTimer(id, Number(ms) || 0);
  return id;
});
define('clearTimeout', (id) => {
  timers.delete(id);
});
define('__fire', (id) => {
  const f = timers.get(id);
  timers.delete(id);
  if (f) f();
});
// Stand-in for rifty's `process` (the guest has the real one): Node's files call nextTick and
// emitWarning. Here nextTick is a microtask, so it does not run before already-queued promise jobs.
define('process', {
  platform: 'linux',
  versions: {},
  nextTick: (f, ...a) => queueMicrotask(() => f(...a)),
  emitWarning() {},
});
define('global', g); // rifty's installWebGlobals sets it
