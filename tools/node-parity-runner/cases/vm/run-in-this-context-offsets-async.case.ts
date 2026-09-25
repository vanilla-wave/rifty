import type { ParityCase } from '../../src/types.ts';

// Async frames (`at async …`) of an offset script (unit
// runtime-js/vm-run-in-this-context-offsets): vitest awaits every test body,
// so a failing assertion's stack crosses await boundaries of the evaluated
// module. Default rendering and a guest hook's CallSites.
const c: ParityCase = {
  code: String.raw`
    const vm = require('node:vm');
    const VIRTUAL = /\/virtual\/[^\s():]+(?::-?\d+){0,2}/;
    const frames = (stack) =>
      String(stack)
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.startsWith('at ') && VIRTUAL.test(line))
        .join(' | ');
    const settle = (make) => make().then(() => 'no-throw', (error) => error);
    const line2 = vm.runInThisContext('(async function outer() {\n  await null; await inner();\n  async function inner() { await null; throw new Error("async") } })', { filename: '/virtual/async.js', lineOffset: 10, columnOffset: 5 });
    const line1 = vm.runInThisContext('(async function outer1() { await null; await inner1(); async function inner1() { await null; throw new Error("a1") } })', { filename: '/virtual/async1.js', lineOffset: 3, columnOffset: -10 });
    const hooked = vm.runInThisContext('(async function outer2() {\n  await null; await inner2();\n  async function inner2() { await null; throw new Error("a2") } })', { filename: '/virtual/async2.js', lineOffset: 10, columnOffset: 5 });

    (async () => {
      console.log('async-default', frames((await settle(line2)).stack));
      console.log('async-line1', frames((await settle(line1)).stack));
      const original = Error.prepareStackTrace;
      Error.prepareStackTrace = (error, sites) =>
        sites
          .filter((site) => String(site.getScriptNameOrSourceURL()).startsWith('/virtual/'))
          .map((site) => [site.isAsync(), site.getFunctionName(), site.getLineNumber(), site.getColumnNumber(), String(site)].join(','))
          .join(' | ');
      const hookedError = await settle(hooked);
      console.log('async-hook', hookedError.stack);
      Error.prepareStackTrace = original;
    })();
  `,
};

export default c;
