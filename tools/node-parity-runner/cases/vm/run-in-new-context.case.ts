import type { ParityCase } from '../../src/types.ts';

const c: ParityCase = {
  code: `
    const vm = require('node:vm');

    const sandbox = { count: 1, nested: { label: 'kept' } };
    const result = vm.runInNewContext(\`
      count += 2;
      nested.extra = count;
      ({ count, extra: nested.extra });
    \`, sandbox);
    console.log(JSON.stringify(result));
    console.log(JSON.stringify(sandbox));

    const context = vm.createContext({ value: 5 });
    console.log(vm.isContext(context));
    const script = new vm.Script('value *= 3; value;');
    console.log(script.runInContext(context));
    console.log(context.value);
    console.log(vm.runInContext('value += 1; value;', context));

    const globals = {};
    globalThis.__riftyVmParityBlockLeak = undefined;
    globalThis.__riftyVmParityLoopLeak = undefined;
    const globalResult = vm.runInNewContext(\`
      created = 1;
      var declared = 2;
      if (true) __riftyVmParityBlockLeak = 5;
      for (let i = 0; i < 1; i++) __riftyVmParityLoopLeak = 6;
      this.viaThis = 3;
      globalThis.viaGlobal = 4;
      ({ created, declared, __riftyVmParityBlockLeak, __riftyVmParityLoopLeak, viaThis, viaGlobal });
    \`, globals);
    console.log(JSON.stringify(globalResult));
    console.log(JSON.stringify(globals));
    console.log(typeof globalThis.created);
    console.log(typeof globalThis.__riftyVmParityBlockLeak);
    console.log(typeof globalThis.__riftyVmParityLoopLeak);

    const add = vm.compileFunction('return a + b;', ['a', 'b']);
    console.log(add(2, 5));

    const functions = {};
    console.log(vm.runInNewContext('function f() { return 9; } f();', functions));
    console.log(typeof functions.f);

    try {
      vm.runInNewContext('missing', {});
    } catch (err) {
      console.log(err.name);
    }

    try {
      vm.runInContext('1 + 1', {});
    } catch (err) {
      console.log(err.name);
    }
  `,
};

export default c;
