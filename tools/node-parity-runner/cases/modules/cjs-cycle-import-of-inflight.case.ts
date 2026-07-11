import type { ParityCase } from '../../src/types.ts';

/**
 * A self-import started while CJS evaluation is in flight must settle from the
 * final record: before or after `module.exports` reassignment it sees the final
 * outer, while a throwing evaluation rejects with that same error. Every wait
 * has a finite timer so a broken loader produces a timeout row, not a hung case.
 */
const c: ParityCase = {
  setup: {
    files: {
      'after-reassign.cjs': `
        module.exports = function afterReassign() { return 'after'; };
        module.exports.tag = 'after-tag';
        const selfImport = import('./after-reassign.cjs');
        module.exports.report = () => selfImport;
      `,
      'before-reassign.cjs': `
        const selfImport = import('./before-reassign.cjs');
        module.exports = function beforeReassign() { return 'before'; };
        module.exports.tag = 'before-tag';
        module.exports.report = () => selfImport;
      `,
      'throwing.cjs': `
        const state = globalThis.__cjsThrowState;
        state.runs += 1;
        if (!state.error) state.error = new Error('inflight-cjs-boom');
        if (!state.selfImport) state.selfImport = import('./throwing.cjs');
        throw state.error;
      `,
    },
  },
  code: `
    function settleWithin(label, promise, onFulfilled, onRejected) {
      return new Promise((resolve) => {
        let done = false;
        const finish = (value) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          resolve(value);
        };
        const timer = setTimeout(() => finish({ label, status: 'timeout' }), 250);
        Promise.resolve(promise).then(
          (value) => finish({ label, status: 'fulfilled', ...onFulfilled(value) }),
          (error) => finish({ label, status: 'rejected', ...onRejected(error) }),
        );
      });
    }

    globalThis.__cjsThrowState = { runs: 0, error: null, selfImport: null };
    const after = require('./after-reassign.cjs');
    const before = require('./before-reassign.cjs');
    let outerImportError = null;
    const throwingOuterImport = import('./throwing.cjs');

    (async () => {
      const rows = await Promise.all([
        settleWithin(
          'after-reassign',
          after.report(),
          (namespace) => ({
            defaultType: typeof namespace.default,
            defaultIsRequiredOuter: namespace.default === after,
            markerIsRequiredOuter: namespace['module.exports'] === after,
            tag: namespace.default && namespace.default.tag,
          }),
          (error) => ({ message: error && error.message }),
        ),
        settleWithin(
          'before-reassign',
          before.report(),
          (namespace) => ({
            defaultType: typeof namespace.default,
            defaultIsRequiredOuter: namespace.default === before,
            markerIsRequiredOuter: namespace['module.exports'] === before,
            tag: namespace.default && namespace.default.tag,
          }),
          (error) => ({ message: error && error.message }),
        ),
        settleWithin(
          'throwing-outer-import',
          throwingOuterImport,
          (namespace) => ({ defaultType: typeof namespace.default }),
          (error) => {
            outerImportError = error;
            return { message: error && error.message };
          },
        ),
      ]);
      rows.push(await settleWithin(
        'throwing-self-import',
        globalThis.__cjsThrowState.selfImport,
        (namespace) => ({ defaultType: typeof namespace.default }),
        (error) => ({
          message: error && error.message,
          sameErrorAsOuterImport: error === outerImportError,
        }),
      ));
      for (const row of rows) console.log(JSON.stringify(row));
      console.log(JSON.stringify({
        throwingRuns: globalThis.__cjsThrowState.runs,
      }));
    })();
  `,
};

export default c;
