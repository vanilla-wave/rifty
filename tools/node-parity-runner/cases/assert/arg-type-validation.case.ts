import type { ParityCase } from '../../src/types.ts';

/**
 * First-arg type validation for the assert function-takers. `throws`/`doesNotThrow`
 * require a function (`ERR_INVALID_ARG_TYPE` for "fn"); `rejects`/`doesNotReject`
 * require a function or thenable ("promiseFn") — never silently call/await a non-callable
 * (which would mis-report). Valid forms still work; happy paths live in `matchers.case.ts`.
 */
const c: ParityCase = {
  code: `
    const assert = require('node:assert');
    const tag = (n, fn) => { try { fn(); console.log(n, 'ok'); } catch (e) { console.log(n, e.code || e.name); } };
    const atag = async (n, fn) => { try { await fn(); console.log(n, 'ok'); } catch (e) { console.log(n, e.code || e.name); } };
    tag('throws.str',       () => assert.throws('not a fn'));
    tag('throws.num',       () => assert.throws(123));
    tag('doesNotThrow.str', () => assert.doesNotThrow('not a fn'));
    tag('throws.ok',        () => assert.throws(() => { throw new Error('x'); }));
    (async () => {
      await atag('rejects.str',  () => assert.rejects('nope'));
      await atag('rejects.num',  () => assert.rejects(123));
      await atag('rejects.null', () => assert.rejects(null));
      await atag('dnr.str',      () => assert.doesNotReject('nope'));
      // function returning a non-thenable → ERR_INVALID_RETURN_VALUE (not silent resolve)
      await atag('rejects.retStr',   () => assert.rejects(() => 'x'));
      await atag('rejects.retUndef', () => assert.rejects(() => {}));
      await atag('dnr.retStr',       () => assert.doesNotReject(() => 'x'));
      await atag('rejects.promise', () => assert.rejects(Promise.reject(new Error('x'))));
      await atag('rejects.fn',      () => assert.rejects(async () => { throw new Error('y'); }));
      await atag('dnr.promise',     () => assert.doesNotReject(Promise.resolve(1)));
    })();
  `,
};

export default c;
