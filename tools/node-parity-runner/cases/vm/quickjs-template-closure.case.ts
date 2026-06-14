import type { ParityCase } from '../../src/types.ts';

// T19 — realistic corpus: the npm "template engine" pattern. Compile a renderer
// FUNCTION inside a context that closes over sandbox data, return it to the host,
// and call it with host args to produce a string. Mirrors how lodash/ejs-style
// templates compile a closure in a vm context. Default (quickjs) engine.
const c: ParityCase = {
  code: `
    const vm = require('node:vm');
    const ctx = vm.createContext({ prefix: '>> ', items: ['x', 'y', 'z'] });
    const render = vm.runInContext(
      '(function (name) { return prefix + name + ": " + items.map(function (i) { return i.toUpperCase(); }).join("-"); })',
      ctx,
    );
    console.log(typeof render);
    console.log(render('row'));
    console.log(render('two'));
  `,
};

export default c;
