import type { ParityCase } from '../../src/types.ts';

// T11 — cross-realm Error marshalling. Node oracle (captured via real Node v24):
//   false TypeError boom        (guest error: instanceof host TypeError FALSE,
//                                constructor.name + message faithful)
//   TypeError true              (guest runtime error: ctor name + Node message)
//   number 42                   (non-Error throw marshals as the raw primitive)
//   RangeError hostboom         (host fn throw, rethrown to host: ctor + message)
//   RangeError:hostboom         (host error caught INSIDE the guest)
const c: ParityCase = {
  code: `
    const vm = require('node:vm');
    try { vm.runInNewContext('throw new TypeError("boom")'); }
    catch (e) { console.log(e instanceof TypeError, e.constructor.name, e.message); }
    try { vm.runInNewContext('null.x'); }
    catch (e) { console.log(e.constructor.name, /Cannot read|null/.test(e.message)); }
    // non-Error throw value
    try { vm.runInNewContext('throw 42'); } catch (e) { console.log(typeof e, e); }
    // host fn throwing, caught in guest, rethrown to host
    let ctx = vm.createContext({ boom: () => { throw new RangeError('hostboom'); } });
    try { vm.runInContext('boom()', ctx); } catch (e) { console.log(e.constructor.name, e.message); }
    // host error caught INSIDE guest
    console.log(vm.runInContext('try { boom() } catch (e) { e.constructor.name + ":" + e.message }', ctx));
  `,
  expected:
    'false TypeError boom\nTypeError true\nnumber 42\nRangeError hostboom\nRangeError:hostboom\n',
};

export default c;
