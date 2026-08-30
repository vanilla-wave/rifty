/**
 * Dedicated MODULE Worker realm for the no-COI probe. Fresh realm per
 * construction (TextDecoder.prototype patching is realm-global, so each
 * install mode gets its own Worker). Mode rides the query string:
 * `new Worker('/probe-worker.mjs?mode=direct', { type: 'module' })`.
 *
 * `poison=<coi|sab|brand|instanceof>` (precondition-detection pins ONLY):
 * violate ONE precondition predicate sibling — `crossOriginIsolated` forced
 * true / a `SharedArrayBuffer` binding present / shared memory whose `.buffer`
 * is a PRIVATE ArrayBuffer / right brand but `instanceof ArrayBuffer` true.
 * runProbe must REJECT before any built-module import, install, or DECODE:
 * the failure message rides back with `decodeMarked` AND a realm decode-call
 * COUNTER (`decodeCalls` — a spy over the real `TextDecoder.prototype.decode`
 * installed before the probe runs; an unpatched NATIVE decode before the gate
 * leaves no marker and no /dist/ request, only this counter sees it).
 */
import { runProbe } from './probe-lib.mjs';

const params = new URL(self.location.href).searchParams;
const mode = params.get('mode') ?? 'direct';
const poison = params.get('poison');
if (poison === 'coi') {
  Object.defineProperty(globalThis, 'crossOriginIsolated', { configurable: true, value: true });
} else if (poison === 'sab') {
  globalThis.SharedArrayBuffer = function SharedArrayBuffer() {};
} else if (poison === 'brand') {
  WebAssembly.Memory = class {
    constructor() {
      this.buffer = new ArrayBuffer(65536);
    }
  };
} else if (poison === 'instanceof') {
  class FakeSharedArrayBuffer extends ArrayBuffer {
    get [Symbol.toStringTag]() {
      return 'SharedArrayBuffer';
    }
  }
  WebAssembly.Memory = class {
    constructor() {
      this.buffer = new FakeSharedArrayBuffer(65536);
    }
  };
}
let decodeCalls = 0;
if (poison !== null) {
  const realDecode = TextDecoder.prototype.decode;
  TextDecoder.prototype.decode = function decode(...args) {
    decodeCalls += 1;
    return realDecode.apply(this, args);
  };
}
try {
  self.postMessage({ ok: true, result: await runProbe(mode) });
} catch (err) {
  self.postMessage({
    ok: false,
    error: err instanceof Error ? err.message : String(err),
    decodeMarked: TextDecoder.prototype.decode.__riftyShared === true,
    decodeCalls,
  });
}
