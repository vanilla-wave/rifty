import type { ParityCase } from '../../src/types.ts';

/** Import-first reuse, race exclusion, and evaluation-error identity share one ESM job. */
const c: ParityCase = {
  setup: {
    files: {
      'success.mjs': `
        globalThis.__requireEsmSuccessRuns = (globalThis.__requireEsmSuccessRuns || 0) + 1;
        export const runs = globalThis.__requireEsmSuccessRuns;
        export default { source: 'import-first' };
      `,
      'race.mjs': `
        globalThis.__requireEsmRaceRuns = (globalThis.__requireEsmRaceRuns || 0) + 1;
        export const runs = globalThis.__requireEsmRaceRuns;
      `,
      'import-throws.mjs': `
        globalThis.__requireEsmImportThrowRuns += 1;
        throw globalThis.__requireEsmImportThrown;
      `,
      'sibling-entry.mjs': `
        import './sibling-b.mjs';
        import './sibling-c.mjs';
        globalThis.__requireEsmSiblingEffects.push('entry');
      `,
      'sibling-b.mjs': `
        globalThis.__requireEsmSiblingEffects.push('b-start');
        await Promise.resolve();
        globalThis.__requireEsmSiblingEffects.push('b-end');
      `,
      'sibling-c.mjs': "globalThis.__requireEsmSiblingEffects.push('c');",
      'hook-loaded.js': `
        globalThis.__requireEsmHookLoadedRuns += 1;
        export default { source: 'loaded-esm' };
      `,
      'hook-inflight.js': `
        globalThis.__requireEsmHookInflightRuns += 1;
        globalThis.__requireEsmHookSignal();
        await new Promise((resolve) => { globalThis.__requireEsmHookRelease = resolve; });
        export default { source: 'inflight-esm' };
      `,
      'cjs-identity.cjs': 'module.exports = { value: 1 };',
      'cjs-identity-entry.mjs': "import * as ns from './cjs-identity.cjs'; export { ns };",
      'shared-link.mjs': 'export const ok = 7;',
      'bad-link-root.mjs': "import { missing } from './shared-link.mjs'; export { missing };",
      'good-link-root.mjs': "import { ok } from './shared-link.mjs'; export { ok };",
      'cjs-microtask.cjs': `
        globalThis.__requireEsmCjsSiblingEffects.push('cjs');
        queueMicrotask(() => globalThis.__requireEsmCjsSiblingEffects.push('microtask'));
      `,
      'microtask-later.mjs': "globalThis.__requireEsmCjsSiblingEffects.push('later');",
      'microtask-root.mjs': `
        import './cjs-microtask.cjs';
        import './microtask-later.mjs';
        globalThis.__requireEsmCjsSiblingEffects.push('root');
      `,
      'esm-microtask-first.mjs': `
        globalThis.__requireEsmEsmSiblingEffects.push('first');
        queueMicrotask(() => globalThis.__requireEsmEsmSiblingEffects.push('microtask'));
      `,
      'esm-microtask-later.mjs': "globalThis.__requireEsmEsmSiblingEffects.push('later');",
      'esm-microtask-root.mjs': `
        import './esm-microtask-first.mjs';
        import './esm-microtask-later.mjs';
        globalThis.__requireEsmEsmSiblingEffects.push('root');
      `,
      'nested-x.mjs': `
        globalThis.__requireEsmNestedEffects.push('x-start');
        await Promise.resolve();
        globalThis.__requireEsmNestedEffects.push('x-end');
      `,
      'nested-y.mjs': "globalThis.__requireEsmNestedEffects.push('y');",
      'nested-a.mjs': `
        import './nested-x.mjs';
        import './nested-y.mjs';
        globalThis.__requireEsmNestedEffects.push('a');
      `,
      'nested-b.mjs': "globalThis.__requireEsmNestedEffects.push('b');",
      'nested-root.mjs': `
        import './nested-a.mjs';
        import './nested-b.mjs';
        globalThis.__requireEsmNestedEffects.push('root');
      `,
      'adopt-shared.mjs': 'export const x = 1;',
      'adopt-a.mjs': "import { x } from './adopt-shared.mjs'; export { x };",
      'adopt-b.mjs': "import { x } from './adopt-shared.mjs'; export { x };",
    },
  },
  code: `
    globalThis.__requireEsmSuccessRuns = 0;
    globalThis.__requireEsmRaceRuns = 0;
    globalThis.__requireEsmImportThrowRuns = 0;
    globalThis.__requireEsmImportThrown = new Error('import-first-boom');
    globalThis.__requireEsmSiblingEffects = [];
    globalThis.__requireEsmHookLoadedRuns = 0;
    globalThis.__requireEsmHookInflightRuns = 0;
    globalThis.__requireEsmCjsSiblingEffects = [];
    globalThis.__requireEsmEsmSiblingEffects = [];
    globalThis.__requireEsmNestedEffects = [];
    globalThis.__requireEsmHookStarted = new Promise((resolve) => {
      globalThis.__requireEsmHookSignal = resolve;
    });

    (async () => {
      const successImported = await import('./success.mjs');
      let successRequired;
      let successRequireError;
      try { successRequired = require('./success.mjs'); }
      catch (error) { successRequireError = error; }
      let successRequiredAgain;
      try { successRequiredAgain = require('./success.mjs'); }
      catch (error) { successRequireError ||= error; }

      const racingImport = import('./race.mjs');
      let raceError;
      try { require('./race.mjs'); } catch (error) { raceError = error; }
      const raceImported = await racingImport;
      let raceRequired;
      let raceAfterError;
      try { raceRequired = require('./race.mjs'); }
      catch (error) { raceAfterError = error; }

      let importError;
      try { await import('./import-throws.mjs'); } catch (error) { importError = error; }
      let requireError;
      try { require('./import-throws.mjs'); } catch (error) { requireError = error; }

      await import('./sibling-entry.mjs');

      const hookLoadedImported = await import('./hook-loaded.js');
      const hookInflightPromise = import('./hook-inflight.js');
      await globalThis.__requireEsmHookStarted;
      const defaultJsLoader = require.extensions['.js'];
      let hookRuns = 0;
      require.extensions['.js'] = function (module, filename) {
        if (filename.endsWith('/hook-loaded.js') || filename.endsWith('/hook-inflight.js')) {
          hookRuns += 1;
          module.exports = { custom: filename.slice(filename.lastIndexOf('/') + 1) };
          return;
        }
        return defaultJsLoader.call(this, module, filename);
      };
      let hookLoadedRequired;
      let hookLoadedRequiredAgain;
      let hookInflightRequired;
      try {
        hookLoadedRequired = require('./hook-loaded.js');
        hookLoadedRequiredAgain = require('./hook-loaded.js');
        hookInflightRequired = require('./hook-inflight.js');
      } finally {
        require.extensions['.js'] = defaultJsLoader;
      }
      const hookLoadedAfterRestore = require('./hook-loaded.js');
      globalThis.__requireEsmHookRelease();
      const hookInflightImported = await hookInflightPromise;
      const cjsIdentityEntry = await import('./cjs-identity-entry.mjs');
      const cjsIdentityDirect = await import('./cjs-identity.cjs');
      const [badLink, goodLink] = await Promise.allSettled([
        import('./bad-link-root.mjs'),
        import('./good-link-root.mjs'),
      ]);
      const adoptImportPromise = import('./adopt-a.mjs');
      let adoptRequired;
      let adoptError;
      try { adoptRequired = require('./adopt-b.mjs'); }
      catch (error) { adoptError = error; }
      const adoptImported = await adoptImportPromise;
      await import('./microtask-root.mjs');
      await import('./esm-microtask-root.mjs');
      await import('./nested-root.mjs');

      console.log(JSON.stringify({
        successImportIdentity: successImported === successRequired,
        successRepeatedIdentity:
          successRequired !== undefined && successRequiredAgain === successRequired,
        successDefaultIdentity: successImported.default === successRequired?.default,
        successEsModule: successRequired?.__esModule,
        successCode: successRequireError ? successRequireError.code : null,
        successRuns: [successImported.runs, globalThis.__requireEsmSuccessRuns],
        raceCode: raceError && raceError.code,
        raceName: raceError && raceError.name,
        raceIdentity: raceImported === raceRequired,
        raceAfterCode: raceAfterError ? raceAfterError.code : null,
        raceRuns: [raceImported.runs, globalThis.__requireEsmRaceRuns],
        failureMessage: importError && importError.message,
        failureIdentity: importError === requireError,
        failureRuns: globalThis.__requireEsmImportThrowRuns,
        siblingEffects: globalThis.__requireEsmSiblingEffects,
        hook: {
          runs: hookRuns,
          loadedRequiredIdentity:
            hookLoadedRequired === hookLoadedRequiredAgain &&
            hookLoadedRequired === hookLoadedAfterRestore,
          loadedValues: [hookLoadedImported.default.source, hookLoadedRequired.custom],
          loadedImportIdentity: hookLoadedImported === hookLoadedRequired,
          inflightValues: [hookInflightImported.default.source, hookInflightRequired.custom],
          inflightImportIdentity: hookInflightImported === hookInflightRequired,
          esmRuns: [globalThis.__requireEsmHookLoadedRuns, globalThis.__requireEsmHookInflightRuns],
        },
        cjsNamespaceIdentity: cjsIdentityEntry.ns === cjsIdentityDirect,
        concurrentLink: [
          badLink.status === 'rejected' && badLink.reason.name,
          goodLink.status === 'fulfilled' && goodLink.value.ok,
        ],
        sharedAdoption: [
          adoptError ? adoptError.code : null,
          adoptRequired && adoptRequired.x,
          adoptImported.x,
        ],
        cjsSiblingEffects: globalThis.__requireEsmCjsSiblingEffects,
        esmSiblingEffects: globalThis.__requireEsmEsmSiblingEffects,
        nestedEffects: globalThis.__requireEsmNestedEffects,
      }));
    })();
  `,
  expected:
    '{"successImportIdentity":false,"successRepeatedIdentity":true,"successDefaultIdentity":true,"successEsModule":true,"successCode":null,"successRuns":[1,1],"raceCode":"ERR_REQUIRE_ESM_RACE_CONDITION","raceName":"Error","raceIdentity":true,"raceAfterCode":null,"raceRuns":[1,1],"failureMessage":"import-first-boom","failureIdentity":true,"failureRuns":1,"siblingEffects":["b-start","c","b-end","entry"],"hook":{"runs":2,"loadedRequiredIdentity":true,"loadedValues":["loaded-esm","hook-loaded.js"],"loadedImportIdentity":false,"inflightValues":["inflight-esm","hook-inflight.js"],"inflightImportIdentity":false,"esmRuns":[1,1]},"cjsNamespaceIdentity":true,"concurrentLink":["SyntaxError",7],"sharedAdoption":[null,1,1],"cjsSiblingEffects":["cjs","later","root","microtask"],"esmSiblingEffects":["first","later","root","microtask"],"nestedEffects":["x-start","y","b","x-end","a","root"]}\n',
};

export default c;
