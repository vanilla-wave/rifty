import type { ParityCase } from '../../src/types.ts';

/**
 * setImmediate check-phase drain order (#28, ADR-0085).
 *
 * A setImmediate scheduled from INSIDE a running immediate callback fires in the
 * NEXT check phase, not the current one. Both top-level immediates (A, C) run in
 * the same phase before the nested one (B-nested). This pins the Node-parity
 * CONTRACT. NB: with the ascending-id Map rep the observable string
 * 'A,A-end,C,B-nested' also holds under a greedy drain (B-nested has the max id,
 * iterated last), so this case guards the contract, not the snapshot mechanism;
 * the scheduler invariant is guarded by immediate-vs-timeout.case.ts and
 * clearImmediate FIFO by the conformance suite.
 *
 * MUST drive via `require('node:timers')`, NOT a bare global `setImmediate`:
 * `run-in-rifty` installs NO globals, so a bare global would hit the HOST Node
 * setImmediate on the rifty side and pass spuriously. `require('node:timers')`
 * resolves to rifty's polyfill (the registry), so the rewrite is exercised.
 */
const c: ParityCase = {
  expected: 'A,A-end,C,B-nested',
  code: `
    const { setImmediate } = require('node:timers');
    const o = [];
    setImmediate(() => {
      o.push('A');
      setImmediate(() => {
        o.push('B-nested');
        console.log(o.join(','));
      });
      o.push('A-end');
    });
    setImmediate(() => { o.push('C'); });
  `,
};

export default c;
