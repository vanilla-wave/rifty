import type { ParityCase } from '../../src/types.ts';

const c: ParityCase = {
  setup: {
    files: {
      'dep.mjs': "export const value = 'cjs-function-import';\n",
      'shadow.cjs': "const Function = () => 'local-shadow';\nmodule.exports = Function();\n",
      'switch-shadow.cjs':
        "switch (0) { case 0: const Function = () => 'switch-local'; module.exports = Function(); break; }\n",
      'static-shadow.cjs':
        "class Holder { static { const Function = () => 'static-local'; module.exports = Function(); } }\n",
      'common-loader.cjs': "module.exports = 'cjs-eval-common';\n",
      'lazy-eval-loader.cjs': `
        let importModule;
        module.exports = function loadLoader(loader) {
          if (loader.type === 'module') {
            if (importModule === undefined) {
              importModule = eval('(url) => import(url)');
            }
            return importModule(loader.path);
          }
          return require(loader.path);
        };
      `,
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
    out.push(['shadow', require('./shadow.cjs')]);
    out.push(['switchShadow', require('./switch-shadow.cjs')]);
    out.push(['staticShadow', require('./static-shadow.cjs')]);
    const dyn = new Function('specifier', 'return import(specifier)');
    out.push(['dynInstance', dyn instanceof Function]);
    out.push(['dynPrototype', Object.getPrototypeOf(dyn) === Function.prototype]);
    const loadLoader = require('./lazy-eval-loader.cjs');
    out.push(['lazyCommon', loadLoader({ type: 'commonjs', path: './common-loader.cjs' })]);
    Promise.all([
      dyn('./dep.mjs'),
      loadLoader({ type: 'module', path: './dep.mjs' }),
    ]).then(
      ([m, lazy]) => {
        out.push(['value', m.value]);
        out.push(['lazyValue', lazy.value]);
        console.log(JSON.stringify(out));
      },
      (err) => {
        out.push(['error', err && err.code]);
        console.log(JSON.stringify(out));
      },
    );
  `,
};

export default c;
