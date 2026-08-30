/**
 * Dedicated MODULE Worker realm for the no-COI probe. Fresh realm per
 * construction (TextDecoder.prototype patching is realm-global, so each
 * install mode gets its own Worker). Mode rides the query string:
 * `new Worker('/probe-worker.mjs?mode=direct', { type: 'module' })`.
 *
 * `poisonWasmBrand=1` (precondition-detection pin ONLY): shared memory whose
 * `.buffer` is a PRIVATE ArrayBuffer — runProbe must REJECT before any
 * built-module import/install/decode; the failure message rides back with a
 * `decodeMarked` side-effect sentinel (realm decode must stay unmarked).
 */
import { runProbe } from './probe-lib.mjs';

const params = new URL(self.location.href).searchParams;
const mode = params.get('mode') ?? 'direct';
if (params.get('poisonWasmBrand') === '1') {
  WebAssembly.Memory = class {
    constructor() {
      this.buffer = new ArrayBuffer(65536);
    }
  };
}
try {
  self.postMessage({ ok: true, result: await runProbe(mode) });
} catch (err) {
  self.postMessage({
    ok: false,
    error: err instanceof Error ? err.message : String(err),
    decodeMarked: TextDecoder.prototype.decode.__riftyShared === true,
  });
}
