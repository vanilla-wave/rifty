import type { ParityCase } from '../../src/types.ts';

/** ESM support does not extend CommonJS file/directory fallback to `.mjs`. */
const c: ParityCase = {
  setup: {
    files: {
      'extension-only.mjs': 'export const value = 1;',
      'directory-only/index.mjs': 'export const value = 2;',
      'cjs-extension-only.cjs': 'module.exports = 3;',
      'directory-cjs/index.cjs': 'module.exports = 4;',
      'ts-extension-only.ts': 'export const value: number = 5;',
      'directory-ts/index.ts': 'export const value: number = 6;',
      'tsx-extension-only.tsx': 'export const view = <div />;',
      'directory-tsx/index.tsx': 'export const view = <div />;',
      'data-only.json': '{"value":7}',
      'native-only.node': 'not a native binary: the registered hook owns it',
      'node_modules/module-only/package.json':
        '{"name":"module-only","type":"module","module":"./entry.mjs"}',
      'node_modules/module-only/entry.mjs': 'export const value = 3;',
      'scope/package.json': '{"imports":{"#implicit":"./implicit"}}',
      'scope/implicit.js': 'module.exports = 9;',
      'scope/probe.cjs': "module.exports = () => require('#implicit');",
    },
  },
  code: `
    require.extensions['.node'] = (module, filename) => {
      module.exports = filename.endsWith('/native-only.node') ? 'node-hook' : 'wrong-file';
    };
    const code = (specifier) => {
      try { require(specifier); return 'NO_THROW'; }
      catch (error) { return error && error.code; }
    };
    const callCode = (fn) => {
      try { fn(); return 'NO_THROW'; }
      catch (error) { return error && error.code; }
    };
    console.log(JSON.stringify({
      extensionless: code('./extension-only'),
      indexMjs: code('./directory-only'),
      extensionlessCjs: code('./cjs-extension-only'),
      indexCjs: code('./directory-cjs'),
      extensionlessTs: code('./ts-extension-only'),
      indexTs: code('./directory-ts'),
      extensionlessTsx: code('./tsx-extension-only'),
      indexTsx: code('./directory-tsx'),
      moduleOnlyPackage: code('module-only'),
      implicitImportsTarget: callCode(require('./scope/probe.cjs')),
      json: require('./data-only').value,
      node: require('./native-only'),
    }));
  `,
  expected:
    '{"extensionless":"MODULE_NOT_FOUND","indexMjs":"MODULE_NOT_FOUND","extensionlessCjs":"MODULE_NOT_FOUND","indexCjs":"MODULE_NOT_FOUND","extensionlessTs":"MODULE_NOT_FOUND","indexTs":"MODULE_NOT_FOUND","extensionlessTsx":"MODULE_NOT_FOUND","indexTsx":"MODULE_NOT_FOUND","moduleOnlyPackage":"MODULE_NOT_FOUND","implicitImportsTarget":"MODULE_NOT_FOUND","json":7,"node":"node-hook"}\n',
};

export default c;
