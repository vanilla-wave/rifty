import type { ParityCase } from '../../src/types.ts';

/**
 * setImmediate beats setTimeout(0) (#28, ADR-0085).
 *
 * rifty schedules its immediate drain via `MessageChannel.postMessage`, whose
 * task is dispatched ahead of a `setTimeout(0)` task — so the immediate fires
 * first, matching Node's check-vs-timer phase order. The rewrite MUST keep the
 * MessageChannel scheduler (NOT setTimeout(0)) or this inverts.
 *
 * Gate on MessageChannel presence: without it the rifty fallback uses
 * setTimeout(0) for BOTH and ordering degenerates. When absent the case prints a
 * sentinel both runtimes agree on (the conformance suite covers this ordering
 * under installTimerGlobals where MessageChannel is guaranteed). Driven via
 * `require('node:timers')` so the rifty side exercises the polyfill, not a host
 * global (run-in-rifty installs no globals).
 */
const c: ParityCase = {
  expected: /^(immediate,timeout0|skipped:no-MessageChannel)$/,
  code: `
    const { setImmediate, setTimeout: stO } = require('node:timers');
    if (typeof MessageChannel !== 'function') {
      console.log('skipped:no-MessageChannel');
    } else {
      const o = [];
      stO(() => { o.push('timeout0'); }, 0);
      setImmediate(() => { o.push('immediate'); });
      stO(() => { console.log(o.join(',')); }, 5);
    }
  `,
};

export default c;
