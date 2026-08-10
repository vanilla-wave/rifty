import type { ParityCase } from '../../src/types.ts';

/** A transitive TLA rejects synchronous loading before any graph evaluation. */
const c: ParityCase = {
  setup: {
    files: {
      'tla-entry.mjs': `
        globalThis.__requireEsmTlaEffects.push('entry');
        import './tla-middle.mjs';
        export const done = true;
      `,
      'tla-middle.mjs': `
        globalThis.__requireEsmTlaEffects.push('middle');
        import './tla-leaf.mjs';
      `,
      'tla-leaf.mjs': `
        globalThis.__requireEsmTlaEffects.push('leaf-before');
        await Promise.resolve();
        globalThis.__requireEsmTlaEffects.push('leaf-after');
      `,
      'tla-cycle.mjs': `
        import './tla-cycle.cjs';
        await Promise.resolve();
        export const unreachable = true;
      `,
      'tla-cycle.cjs': "module.exports = require('./tla-cycle.mjs');",
      'for-await.mjs': `
        export const out = [];
        for await (const value of [1, 2]) out.push(value);
      `,
    },
  },
  code: `
    globalThis.__requireEsmTlaEffects = [];
    let error;
    try { require('./tla-entry.mjs'); }
    catch (caught) { error = caught; }
    const beforeImport = [...globalThis.__requireEsmTlaEffects];

    (async () => {
      const imported = await import('./tla-entry.mjs');
      let secondError;
      try { require('./tla-entry.mjs'); }
      catch (caught) { secondError = caught; }
      let cycleError;
      try { await import('./tla-cycle.mjs'); }
      catch (caught) { cycleError = caught; }
      const forAwait = await import('./for-await.mjs');
      console.log(JSON.stringify({
        firstCode: error && error.code,
        firstName: error && error.name,
        beforeImport,
        importedDone: imported.done,
        secondCode: secondError && secondError.code,
        sameError: secondError === error,
        effects: globalThis.__requireEsmTlaEffects,
        cycleCode: cycleError && cycleError.code,
        forAwait: forAwait.out,
      }));
    })();
  `,
  expected:
    '{"firstCode":"ERR_REQUIRE_ASYNC_MODULE","firstName":"Error","beforeImport":[],"importedDone":true,"secondCode":"ERR_REQUIRE_ASYNC_MODULE","sameError":false,"effects":["leaf-before","leaf-after","middle","entry"],"cycleCode":"ERR_REQUIRE_ASYNC_MODULE","forAwait":[1,2]}\n',
};

export default c;
