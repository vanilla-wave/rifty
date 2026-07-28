import type { ParityCase } from '../../src/types.ts';

/**
 * The visible CJS module object owns metadata, graph links, exports identity,
 * cache identity, and load/failure transitions. No require.cache facade is used:
 * that adjacent surface remains outside ADR-0325.
 */
const c: ParityCase = {
  setup: {
    files: {
      'shared.js': `
        module.exports = {
          self: module,
          loadedDuring: module.loaded,
          loadedAfter: () => module.loaded,
        };
      `,
      'first.js': `
        const shared = require('./shared.js');
        const cached = require('./shared.js');
        module.exports = {
          self: module,
          loadedDuring: module.loaded,
          shared,
          cached,
        };
      `,
      'second.js': `
        const shared = require('./shared.js');
        module.exports = { self: module, shared };
      `,
      'cycle-a.js': `
        exports.self = module;
        exports.loadedDuring = module.loaded;
        exports.partial = 'a-before-b';
        exports.b = require('./cycle-b.js');
        exports.loadedAfter = () => module.loaded;
      `,
      'cycle-b.js': `
        const a = require('./cycle-a.js');
        module.exports = {
          self: module,
          loadedDuring: module.loaded,
          parentIsA: module.parent === a.self,
          parentHadChildDuring: module.parent.children.includes(module),
          a,
          aLoadedDuring: a.self.loaded,
          aPartialDuring: a.partial,
          aExportsIdentityDuring: a.self.exports === a,
          loadedAfter: () => module.loaded,
        };
      `,
      'retry-parent.js': `
        let message;
        try {
          require('./retry-child.js');
        } catch (error) {
          message = error.message;
        }
        const childrenAfterFailure = module.children.slice();
        const child = require('./retry-child.js');
        module.exports = {
          self: module,
          message,
          childrenAfterFailure,
          child,
        };
      `,
      'retry-child.js': `
        const attempts = globalThis.__adr0325Attempts ||= [];
        attempts.push(module);
        if (attempts.length === 1) throw new Error('first load fails');
        module.exports = {
          self: module,
          loadedDuring: module.loaded,
          loadedAfter: () => module.loaded,
        };
      `,
    },
  },
  code: `
    const path = require('node:path');
    const first = require('./first.js');
    const firstParent = first.shared.self.parent;
    const second = require('./second.js');
    const cycle = require('./cycle-a.js');
    const retry = require('./retry-parent.js');
    const attempts = globalThis.__adr0325Attempts;
    const base = (value) => path.basename(value);

    console.log(JSON.stringify({
      freshCached: {
        sameExports: first.shared === first.cached && first.shared === second.shared,
        sameRecord: first.shared.self === first.cached.self && first.shared.self === second.shared.self,
        loadedDuring: first.shared.loadedDuring,
        loadedAfter: first.shared.loadedAfter(),
        recordOwnsExports: first.shared.self.exports === first.shared,
        idEqualsFilename: first.shared.self.id === first.shared.self.filename,
        filename: base(first.shared.self.filename),
        pathMatchesDirname: first.shared.self.path === path.dirname(first.shared.self.filename),
        pathsIsArray: Array.isArray(first.shared.self.paths),
        firstParentIsFirst: firstParent === first.self,
        firstParentStableAfterSecond: first.shared.self.parent === firstParent,
        firstLinksOnce: first.self.children.filter((child) => child === first.shared.self).length,
        secondLinksOnce: second.self.children.filter((child) => child === first.shared.self).length,
      },
      cycle: {
        aLoadedDuring: cycle.loadedDuring,
        bLoadedDuring: cycle.b.loadedDuring,
        bParentIsA: cycle.b.parentIsA,
        aLinkedBBeforeBody: cycle.b.parentHadChildDuring,
        bSawSameAExports: cycle.b.a === cycle && cycle.b.aExportsIdentityDuring,
        bSawAPartial: cycle.b.aPartialDuring,
        aLoadedDuringB: cycle.b.aLoadedDuring,
        bLinksAOnce: cycle.b.self.children.filter((child) => child === cycle.self).length,
        loadedAfter: [cycle.loadedAfter(), cycle.b.loadedAfter()],
      },
      failedRetry: {
        message: retry.message,
        calls: attempts.length,
        freshRecord: attempts[0] !== attempts[1],
        unlinkedBeforeRetry: retry.childrenAfterFailure.length === 0,
        failedRecordStillAbsent:
          !retry.self.children.includes(attempts[0]) &&
          retry.self.children.filter((child) => child === retry.child.self).length === 1,
        retryRecordIdentity: retry.child.self === attempts[1],
        retryRecordOwnsExports: retry.child.self.exports === retry.child,
        retryParentIsParent: retry.child.self.parent === retry.self,
        retryLoadedDuring: retry.child.loadedDuring,
        retryLoadedAfter: retry.child.loadedAfter(),
      },
    }));
  `,
  expected:
    '{"freshCached":{"sameExports":true,"sameRecord":true,"loadedDuring":false,"loadedAfter":true,"recordOwnsExports":true,"idEqualsFilename":true,"filename":"shared.js","pathMatchesDirname":true,"pathsIsArray":true,"firstParentIsFirst":true,"firstParentStableAfterSecond":true,"firstLinksOnce":1,"secondLinksOnce":1},"cycle":{"aLoadedDuring":false,"bLoadedDuring":false,"bParentIsA":true,"aLinkedBBeforeBody":true,"bSawSameAExports":true,"bSawAPartial":"a-before-b","aLoadedDuringB":false,"bLinksAOnce":1,"loadedAfter":[true,true]},"failedRetry":{"message":"first load fails","calls":2,"freshRecord":true,"unlinkedBeforeRetry":true,"failedRecordStillAbsent":true,"retryRecordIdentity":true,"retryRecordOwnsExports":true,"retryParentIsParent":true,"retryLoadedDuring":false,"retryLoadedAfter":true}}\n',
};

export default c;
