/**
 * `vm.constants` is Node's data: a frozen null-prototype object of two symbols
 * (jsdom 30 reads `DONT_CONTEXTIFY` in `Window.js`). Options passed with
 * `DONT_CONTEXTIFY` validate as for any context object. The vanilla context
 * itself is a rifty ceiling (`packages/runtime-js/src/builtins/vm/dont-contextify-ceiling.test.ts`),
 * not parity.
 */
import type { ParityCase } from '../../src/types.ts';

const c: ParityCase = {
  kind: 'esm',
  code: `
    import vm, { constants } from 'node:vm';
    import * as vmNs from 'node:vm';
    const d = Object.getOwnPropertyDescriptor(vm, 'constants');
    console.log(JSON.stringify({
      descriptor: [typeof d.value, d.writable, d.enumerable, d.configurable, Object.keys(vm).includes('constants')],
      linked: [constants === vm.constants, vmNs.constants === vm.constants],
      proto: Object.getPrototypeOf(constants),
      frozen: Object.isFrozen(constants),
      keys: Reflect.ownKeys(constants),
      values: Object.values(constants).map((s) => [typeof s, String(s), Symbol.keyFor(s) === undefined]),
    }));
    for (const options of [{ name: 1 }, { origin: 2 }, { codeGeneration: 1 }, { microtaskMode: 'x' }]) {
      try {
        vm.createContext(constants.DONT_CONTEXTIFY, options);
        console.log('no-throw');
      } catch (error) {
        console.log(error.name, error.code, error.message);
      }
    }
  `,
};

export default c;
