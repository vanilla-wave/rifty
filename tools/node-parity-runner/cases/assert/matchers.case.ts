import type { ParityCase } from '../../src/types.ts';

/**
 * Pins observable throw/no-throw + error CODE for the new assert matchers
 * (match/doesNotMatch/ifError/rejects/doesNotReject, the throws object/Error-
 * instance form, and partialDeepStrictEqual incl. its in-order array subsequence
 * semantics). Like the existing does-not-throw case, it tags by code, not by
 * Node's elaborate AssertionError message prose.
 */
const c: ParityCase = {
  code: `
    const assert = require('node:assert');
    const tag = (n, fn) => { try { fn(); console.log(n + ':ok'); } catch (e) { console.log(n + ':' + (e.code || e.name)); } };
    const atag = async (n, fn) => { try { await fn(); console.log(n + ':ok'); } catch (e) { console.log(n + ':' + (e.code || e.name)); } };
    (async () => {
      tag('match_ok', () => assert.match('abc', /b/));
      tag('match_fail', () => assert.match('abc', /z/));
      tag('match_type', () => assert.match('a', 'notregex'));
      tag('doesNotMatch_ok', () => assert.doesNotMatch('abc', /z/));
      tag('doesNotMatch_fail', () => assert.doesNotMatch('abc', /b/));
      tag('ifError_null', () => assert.ifError(null));
      tag('ifError_err', () => assert.ifError(new Error('boom')));
      tag('ifError_val', () => assert.ifError('xyz'));
      tag('throws_obj_ok', () => assert.throws(() => { const e = new TypeError('bad'); e.code = 'ERR_X'; throw e; }, { code: 'ERR_X', name: 'TypeError' }));
      tag('throws_obj_msgRe', () => assert.throws(() => { throw new Error('hello world'); }, { message: /world/ }));
      tag('throws_obj_miss', () => assert.throws(() => { const e = new Error('x'); e.code = 'A'; throw e; }, { code: 'B' }));
      tag('throws_errinst_ok', () => assert.throws(() => { throw new TypeError('bad'); }, new TypeError('bad')));
      tag('throws_errinst_miss', () => assert.throws(() => { throw new TypeError('bad'); }, new TypeError('other')));
      tag('pdse_ok', () => assert.partialDeepStrictEqual({ a: 1, b: 2, c: 3 }, { a: 1, c: 3 }));
      tag('pdse_nested', () => assert.partialDeepStrictEqual({ a: { x: 1, y: 2 }, b: 5 }, { a: { x: 1 } }));
      tag('pdse_arr_subseq', () => assert.partialDeepStrictEqual([1, 2, 3], [2]));
      tag('pdse_arr_order', () => assert.partialDeepStrictEqual([1, 2, 3], [3, 1]));
      tag('pdse_fail', () => assert.partialDeepStrictEqual({ a: 1 }, { a: 2 }));
      tag('pdse_type', () => assert.partialDeepStrictEqual({ a: 1 }, { a: '1' }));
      await atag('rejects_ok', () => assert.rejects(Promise.reject(new Error('r'))));
      await atag('rejects_resolve', () => assert.rejects(Promise.resolve(1)));
      await atag('rejects_match', () => assert.rejects(async () => { throw new Error('boom'); }, /boom/));
      await atag('doesNotReject_ok', () => assert.doesNotReject(Promise.resolve(1)));
      await atag('doesNotReject_fail', () => assert.doesNotReject(Promise.reject(new Error('q'))));
    })();
  `,
};

export default c;
