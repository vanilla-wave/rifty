import type { ParityCase } from '../../src/types.ts';

/** `module-sync` matches both loaders, while earlier `default` shadows it. */
const c: ParityCase = {
  setup: {
    files: {
      'node_modules/sync-first/package.json':
        '{"name":"sync-first","type":"module","exports":{"module-sync":"./sync.mjs","default":"./default.mjs"}}',
      'node_modules/sync-first/sync.mjs': `
        globalThis.__syncFirstRuns = (globalThis.__syncFirstRuns || 0) + 1;
        export const branch = 'module-sync';
        export const runs = globalThis.__syncFirstRuns;
      `,
      'node_modules/sync-first/default.mjs':
        "export const branch = 'default'; export const runs = -1;",
      'node_modules/default-first/package.json':
        '{"name":"default-first","type":"module","exports":{"default":"./default.mjs","module-sync":"./sync.mjs"}}',
      'node_modules/default-first/default.mjs': `
        globalThis.__defaultFirstRuns = (globalThis.__defaultFirstRuns || 0) + 1;
        export const branch = 'default';
        export const runs = globalThis.__defaultFirstRuns;
      `,
      'node_modules/default-first/sync.mjs':
        "export const branch = 'module-sync'; export const runs = -1;",
      'node_modules/mode-split/package.json':
        '{"name":"mode-split","type":"module","exports":{"import":"./import.mjs","require":"./require.mjs","module-sync":"./sync.mjs","default":"./default.mjs"}}',
      'node_modules/mode-split/import.mjs': "export const branch = 'import';",
      'node_modules/mode-split/require.mjs': "export const branch = 'require';",
      'node_modules/mode-split/sync.mjs': "export const branch = 'module-sync';",
      'node_modules/mode-split/default.mjs': "export const branch = 'default';",
      'scope/package.json':
        '{"name":"imports-scope","type":"module","imports":{"#choice":{"module-sync":"./sync.mjs","default":"./default.mjs"}}}',
      'scope/sync.mjs': "export const branch = 'imports-sync';",
      'scope/default.mjs': "export const branch = 'imports-default';",
      'scope/required.cjs': "module.exports = require('#choice');",
      'scope/imported.mjs': "import * as choice from '#choice'; export { choice };",
    },
  },
  code: `
    globalThis.__syncFirstRuns = 0;
    globalThis.__defaultFirstRuns = 0;
    const syncRequired = require('sync-first');
    const defaultRequired = require('default-first');
    const splitRequired = require('mode-split');
    const importsRequired = require('./scope/required.cjs');

    (async () => {
      const syncImported = await import('sync-first');
      const defaultImported = await import('default-first');
      const splitImported = await import('mode-split');
      const importsImported = await import('./scope/imported.mjs');
      console.log(JSON.stringify({
        sync: [syncRequired.branch, syncImported.branch],
        syncIdentity: syncRequired === syncImported,
        syncRuns: [syncRequired.runs, globalThis.__syncFirstRuns],
        default: [defaultRequired.branch, defaultImported.branch],
        defaultIdentity: defaultRequired === defaultImported,
        defaultRuns: [defaultRequired.runs, globalThis.__defaultFirstRuns],
        split: [splitRequired.branch, splitImported.branch],
        imports: [importsRequired.branch, importsImported.choice.branch],
        importsIdentity: importsRequired === importsImported.choice,
      }));
    })();
  `,
  expected:
    '{"sync":["module-sync","module-sync"],"syncIdentity":true,"syncRuns":[1,1],"default":["default","default"],"defaultIdentity":true,"defaultRuns":[1,1],"split":["require","import"],"imports":["imports-sync","imports-sync"],"importsIdentity":true}\n',
};

export default c;
