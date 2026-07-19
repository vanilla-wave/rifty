import type { ParityCase } from '../../src/types.ts';

const c: ParityCase = {
  setup: {
    files: {
      'explicit.hook': 'this source must not execute',
      'fallback.unknown': 'this source must not execute',
      'data.json': 'this is deliberately invalid JSON',
      'target.retry': 'this source must not execute',
    },
  },
  code: `
    const results = [];
    const probe = (extension, target) => {
      const descriptor = Object.getOwnPropertyDescriptor(require.extensions, extension);
      let getterCalls = 0;
      let nested;
      Object.defineProperty(require.extensions, extension, {
        configurable: true,
        enumerable: true,
        get() {
          getterCalls += 1;
          nested = require(target);
          return function (module) {
            results.push({
              extension,
              phase: 'hook',
              getterCalls,
              same: module.exports === nested,
            });
            module.exports.loaded = true;
          };
        },
      });
      try {
        const loaded = require(target);
        results.push({
          extension,
          phase: 'done',
          getterCalls,
          same: loaded === nested,
          loaded: loaded.loaded,
        });
      } catch (error) {
        results.push({ extension, error: error.name });
      } finally {
        if (descriptor) Object.defineProperty(require.extensions, extension, descriptor);
        else delete require.extensions[extension];
      }
    };

    probe('.hook', './explicit.hook');
    probe('.js', './fallback.unknown');
    probe('.json', './data.json');

    const sentinel = new Error('getter failed');
    const retryDescriptor = Object.getOwnPropertyDescriptor(require.extensions, '.retry');
    let attempts = 0;
    Object.defineProperty(require.extensions, '.retry', {
      configurable: true,
      enumerable: true,
      get() {
        attempts += 1;
        if (attempts === 1) throw sentinel;
        return function (module) { module.exports = { attempts }; };
      },
    });
    let exactThrow = false;
    try {
      try { require('./target.retry'); } catch (error) { exactThrow = error === sentinel; }
      results.push({ exactThrow, retried: require('./target.retry') });
    } finally {
      if (retryDescriptor) {
        Object.defineProperty(require.extensions, '.retry', retryDescriptor);
      } else {
        delete require.extensions['.retry'];
      }
    }

    console.log(JSON.stringify(results));
  `,
  expected:
    '[{"extension":".hook","phase":"hook","getterCalls":2,"same":true},{"extension":".hook","phase":"done","getterCalls":2,"same":true,"loaded":true},{"extension":".js","phase":"hook","getterCalls":1,"same":true},{"extension":".js","phase":"done","getterCalls":1,"same":true,"loaded":true},{"extension":".json","phase":"hook","getterCalls":2,"same":true},{"extension":".json","phase":"done","getterCalls":2,"same":true,"loaded":true},{"exactThrow":true,"retried":{"attempts":3}}]\n',
};

export default c;
