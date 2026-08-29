/**
 * Dedicated MODULE Worker realm for the no-COI probe. Fresh realm per
 * construction (TextDecoder.prototype patching is realm-global, so each
 * install mode gets its own Worker). Mode rides the query string:
 * `new Worker('/probe-worker.mjs?mode=direct', { type: 'module' })`.
 */
import { runProbe } from './probe-lib.mjs';

const mode = new URL(self.location.href).searchParams.get('mode') ?? 'direct';
try {
  self.postMessage({ ok: true, result: await runProbe(mode) });
} catch (err) {
  self.postMessage({ ok: false, error: err instanceof Error ? err.message : String(err) });
}
