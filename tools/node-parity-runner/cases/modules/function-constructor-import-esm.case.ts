import type { ParityCase } from '../../src/types.ts';

const c: ParityCase = {
  kind: 'esm',
  setup: {
    files: {
      'dep.mjs': "export const value = 'esm-function-import';\n",
    },
  },
  code: `
    const out = [];
    out.push(['asyncType', typeof AsyncFunction]);
    out.push(['generatorType', typeof GeneratorFunction]);
    out.push(['asyncGeneratorType', typeof AsyncGeneratorFunction]);
    out.push(['name', Function.name]);
    out.push(['length', Function.length]);
    out.push(['constructorPrototype', Object.getPrototypeOf(Function) === Function.prototype]);
    const plain = new Function('return 1');
    out.push(['plainInstance', plain instanceof Function]);
    out.push(['plainPrototype', Object.getPrototypeOf(plain) === Function.prototype]);
    const dyn = new Function('specifier', 'return import(specifier)');
    out.push(['dynInstance', dyn instanceof Function]);
    out.push(['dynPrototype', Object.getPrototypeOf(dyn) === Function.prototype]);
    const m = await dyn('./dep.mjs');
    out.push(['value', m.value]);
    console.log(JSON.stringify(out));
  `,
};

export default c;
