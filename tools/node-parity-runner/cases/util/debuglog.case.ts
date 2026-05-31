import type { ParityCase } from '../../src/types.ts';

// `util.debuglog` parity. With NODE_DEBUG unset (the default in both runtimes)
// every section is disabled, which is exactly the path undici's
// `lib/core/diagnostics.js` takes at import: it reads `.enabled` and skips
// event tracking. We assert the observable surface on stdout (debuglog itself
// writes to stderr, which the runner does not compare):
//   - debuglog is a function and `util.debug` is the same reference
//   - the returned debug fn carries a boolean `.enabled` (false when disabled)
//   - calling a disabled debug fn is a no-op that returns undefined and throws
//     nothing
//   - the optional init callback fires LAZILY on the first call (not at
//     creation) and receives the resolved debug function
const c: ParityCase = {
  code: `
    const util = require('node:util');
    const out = [];
    out.push(['is-fn', typeof util.debuglog]);
    out.push(['debug-alias', util.debuglog === util.debug]);

    const d = util.debuglog('rifty-section');
    out.push(['returns-fn', typeof d]);
    out.push(['enabled-type', typeof d.enabled]);
    out.push(['enabled-default', d.enabled]);

    let ret;
    let threw = false;
    try {
      ret = d('hidden %s', 'msg'); // disabled -> no stderr, no throw
    } catch (e) {
      threw = true;
    }
    out.push(['call-return', ret]);
    out.push(['call-threw', threw]);

    // Lazy init callback: fires on FIRST call, receiving the debug fn.
    let cbFiredBeforeCall = 'no';
    let cbArgType = 'none';
    const d2 = util.debuglog('rifty-cb', (fn) => {
      cbArgType = typeof fn;
    });
    out.push(['cb-before-call', cbArgType]);
    d2('x');
    out.push(['cb-after-call', cbArgType]);

    console.log(JSON.stringify(out));
  `,
};

export default c;
