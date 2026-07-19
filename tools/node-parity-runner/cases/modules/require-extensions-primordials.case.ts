import type { ParityCase } from '../../src/types.ts';

const c: ParityCase = {
  setup: {
    files: {
      'index.foo.bar': 'this source must not execute',
      'slice.foo.bar': 'this source must not execute',
      'bad.badjson': 'this source must not execute',
      'bad.badtype': 'this source must not execute',
    },
  },
  code: `
    const results = [];
    const poisonSelection = (method, target) => {
      const longDescriptor = Object.getOwnPropertyDescriptor(require.extensions, '.foo.bar');
      const shortDescriptor = Object.getOwnPropertyDescriptor(require.extensions, '.bar');
      const originalMethod = String.prototype[method];
      Object.defineProperty(require.extensions, '.foo.bar', {
        configurable: true,
        enumerable: true,
        get() {
          String.prototype[method] = null;
          return 0;
        },
      });
      require.extensions['.bar'] = function (module) { module.exports = method; };
      try {
        try { results.push(require(target)); }
        catch (error) { results.push({ method, error: error.name }); }
      } finally {
        String.prototype[method] = originalMethod;
        if (longDescriptor) {
          Object.defineProperty(require.extensions, '.foo.bar', longDescriptor);
        } else {
          delete require.extensions['.foo.bar'];
        }
        if (shortDescriptor) Object.defineProperty(require.extensions, '.bar', shortDescriptor);
        else delete require.extensions['.bar'];
      }
    };

    poisonSelection('indexOf', './index.foo.bar');
    poisonSelection('slice', './slice.foo.bar');

    const poisonErrorPath = (extension, globalName, owner, replacement, target) => {
      const extensionDescriptor = Object.getOwnPropertyDescriptor(require.extensions, extension);
      const original = owner[globalName];
      const sentinel = { sentinel: globalName };
      require.extensions[extension] = { not: 'callable' };
      owner[globalName] = replacement(sentinel);
      let thrown;
      try { require(target); } catch (error) { thrown = error; }
      finally {
        owner[globalName] = original;
        if (extensionDescriptor) {
          Object.defineProperty(require.extensions, extension, extensionDescriptor);
        } else {
          delete require.extensions[extension];
        }
      }
      results.push({ globalName, exact: thrown === sentinel, name: thrown && thrown.name });
    };

    poisonErrorPath(
      '.badjson',
      'stringify',
      JSON,
      (sentinel) => function () { throw sentinel; },
      './bad.badjson',
    );
    poisonErrorPath(
      '.badtype',
      'TypeError',
      globalThis,
      (sentinel) => function () { return sentinel; },
      './bad.badtype',
    );

    console.log(JSON.stringify(results));
  `,
  expected:
    '["indexOf","slice",{"globalName":"stringify","exact":false,"name":"TypeError"},{"globalName":"TypeError","exact":false,"name":"TypeError"}]\n',
};

export default c;
