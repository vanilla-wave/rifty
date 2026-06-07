import type { ParityCase } from '../../src/types.ts';

/**
 * Microtask checkpoint BETWEEN consecutive immediates (#28, ADR-0085, BLOCKER #2).
 *
 * Node drains the microtask queue between two consecutive setImmediate callbacks
 * (one immediate per check-phase macrotask). So A's post-await continuation runs
 * BEFORE B, and B reads the value A set after its await. A greedy batched drain
 * (run A,B,C synchronously in one macrotask) would skip that checkpoint and B
 * would read the stale 'init'. Verified RED on the batched drain, GREEN on
 * drain-EXACTLY-ONE-per-message.
 *
 * MUST drive via `require('node:timers')`, NOT a bare global `setImmediate`:
 * `run-in-rifty` installs NO globals, so a bare global would hit the HOST Node
 * setImmediate on the rifty side and pass spuriously. `require('node:timers')`
 * resolves to rifty's polyfill (the registry), so the drain is exercised.
 */
const c: ParityCase = {
  expected: 'A-start | A-after-await | B-reads:set-by-A | C',
  code: `
    const { setImmediate } = require('node:timers');
    const o = []; let shared = 'init';
    setImmediate(async () => { o.push('A-start'); await Promise.resolve(); shared = 'set-by-A'; o.push('A-after-await'); });
    setImmediate(() => { o.push('B-reads:' + shared); });
    setImmediate(() => { o.push('C'); console.log(o.join(' | ')); });
  `,
};

export default c;
