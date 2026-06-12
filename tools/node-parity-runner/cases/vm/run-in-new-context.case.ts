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

    const shadowed = {};
    const shadowedResult = vm.runInNewContext(\`
      function write(globalThis) {
        shadowedWrite = 7;
        return globalThis.shadowedWrite;
      }
      ({ returned: write({}), sandboxValue: shadowedWrite });
    \`, shadowed);
    console.log(JSON.stringify(shadowedResult));
    console.log(JSON.stringify(shadowed));

    const hoisted = {};
    const hoistedResult = vm.runInNewContext(\`
      before = typeof x + ':' + String(x);
      var x = 1;
      var y = y === undefined ? 2 : 9;
      ({ before, x, y });
    \`, hoisted);
    console.log(JSON.stringify(hoistedResult));
    console.log(JSON.stringify(hoisted));

    const add = vm.compileFunction('return a + b;', ['a', 'b']);
    console.log(add(2, 5));

    const functions = {};
    console.log(vm.runInNewContext('function f() { return 9; } f();', functions));
    console.log(typeof functions.f);

    const writes = {};
    globalThis.__riftyVmParityInitLeak = undefined;
    globalThis.__riftyVmParityDeleteHost = 'host';
    const writesResult = vm.runInNewContext(\`
      var fromInit = (function () { __riftyVmParityInitLeak = 11; return 12; })();
      ({ a: dA, b: dB = 8 } = { a: 4 });
      [dC, ...dR] = [1, 2, 3];
      switch (1) { case 1: let local = 1; local = 2; caseLocal = local; }
      for (var k in { a: 1, b: 1 }) ;
      for (loose of [14]) ;
      removedHost = delete __riftyVmParityDeleteHost;
      ({ fromInit, dA, dB, dC, dR, caseLocal, k, loose, removedHost });
    \`, writes);
    console.log(JSON.stringify(writesResult));
    console.log(JSON.stringify(writes, Object.keys(writes).sort()));
    console.log(typeof globalThis.__riftyVmParityInitLeak);
    console.log(globalThis.__riftyVmParityDeleteHost);
    delete globalThis.__riftyVmParityInitLeak;
    delete globalThis.__riftyVmParityDeleteHost;

    try {
      vm.runInNewContext('missingCompound += 1;', {});
    } catch (err) {
      console.log(err.name);
    }
    try {
      vm.runInNewContext('missingUpdate++;', {});
    } catch (err) {
      console.log(err.name);
    }
    try {
      vm.runInNewContext('missingLogical &&= 1;', {});
    } catch (err) {
      console.log(err.name);
    }

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
