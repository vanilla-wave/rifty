import type { ParityCase } from '../../src/types.ts';

/** A failed ESM evaluation is cached once, including the exact thrown value. */
const c: ParityCase = {
  setup: {
    files: {
      'throws.mjs': `
        globalThis.__requireEsmThrowRuns += 1;
        throw globalThis.__requireEsmThrown;
      `,
      'link-entry.mjs': `
        globalThis.__requireEsmLinkEffects += 1;
        import { missing } from './link-dep.mjs';
        export const unreachable = missing;
      `,
      'link-dep.mjs': 'export const present = 1;',
    },
  },
  code: `
    globalThis.__requireEsmThrowRuns = 0;
    globalThis.__requireEsmThrown = new Error('esm-evaluation-boom');
    globalThis.__requireEsmLinkEffects = 0;
    let first;
    let second;
    try { require('./throws.mjs'); } catch (error) { first = error; }
    try { require('./throws.mjs'); } catch (error) { second = error; }
    let linkError;
    try { require('./link-entry.mjs'); } catch (error) { linkError = error; }

    (async () => {
      let imported;
      try { await import('./throws.mjs'); } catch (error) { imported = error; }
      console.log(JSON.stringify({
        message: first && first.message,
        firstIsThrown: first === globalThis.__requireEsmThrown,
        repeatedIdentity: second === first,
        importIdentity: imported === first,
        runs: globalThis.__requireEsmThrowRuns,
        linkName: linkError && linkError.name,
        linkEffects: globalThis.__requireEsmLinkEffects,
      }));
    })();
  `,
  expected:
    '{"message":"esm-evaluation-boom","firstIsThrown":true,"repeatedIdentity":true,"importIdentity":true,"runs":1,"linkName":"SyntaxError","linkEffects":0}\n',
};

export default c;
