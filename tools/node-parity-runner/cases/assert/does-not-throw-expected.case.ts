import type { ParityCase } from '../../src/types.ts';

/**
 * Pins Node's `assert.doesNotThrow(fn, expected)` semantics:
 *   1. fn throws, no `expected`        → AssertionError ('ERR_ASSERTION')
 *   2. fn throws, RegExp matches       → AssertionError
 *   3. fn throws, RegExp doesn't match → original error re-thrown unchanged
 *   4. fn throws, Error subclass match → AssertionError
 *   5. fn throws, class doesn't match  → original error re-thrown unchanged
 *   6. fn throws, predicate true       → AssertionError
 *   7. fn throws, predicate false      → original error re-thrown unchanged
 *   8. fn doesn't throw                → silent success
 *
 * The previous rifty implementation always wrapped throws as AssertionError,
 * silently dropping cases 3/5/7.
 */
const c: ParityCase = {
  code: `
    const assert = require('node:assert');
    class CustomErr extends Error { constructor(m) { super(m); this.name = 'CustomErr'; } }

    function tag(n, e) {
      // Normalise output: print constructor name + code (if set) for assertion errors,
      // message for everything else.
      if (e && e.code === 'ERR_ASSERTION') console.log(n + ':AssertionError');
      else if (e instanceof Error) console.log(n + ':' + e.constructor.name + ':' + e.message);
      else console.log(n + ':no-error');
    }

    try { assert.doesNotThrow(() => { throw new Error('boom'); }); tag(1, null); }
    catch (e) { tag(1, e); }

    try { assert.doesNotThrow(() => { throw new Error('boom'); }, /boom/); tag(2, null); }
    catch (e) { tag(2, e); }

    try { assert.doesNotThrow(() => { throw new Error('boom'); }, /other/); tag(3, null); }
    catch (e) { tag(3, e); }

    try { assert.doesNotThrow(() => { throw new CustomErr('c'); }, CustomErr); tag(4, null); }
    catch (e) { tag(4, e); }

    try { assert.doesNotThrow(() => { throw new Error('plain'); }, CustomErr); tag(5, null); }
    catch (e) { tag(5, e); }

    try { assert.doesNotThrow(() => { throw new Error('m'); }, function check(e) { return e.message === 'm'; }); tag(6, null); }
    catch (e) { tag(6, e); }

    try { assert.doesNotThrow(() => { throw new Error('m'); }, function check(e) { return false; }); tag(7, null); }
    catch (e) { tag(7, e); }

    try { assert.doesNotThrow(() => 42); tag(8, null); }
    catch (e) { tag(8, e); }
  `,
};

export default c;
