import type { ParityCase } from '../../src/types.ts';

const c: ParityCase = {
  setup: {
    files: {
      'explicit.hook': 'this source must not execute',
      'fallback.unknown': 'this source must not execute',
      'data.json': 'this is deliberately invalid JSON',
    },
  },
  code: `
    const results = [];
    const poisonedHook = (label) => {
      const hook = function (module, filename) {
        module.exports = {
          label,
          receiver: this === require.extensions,
          filename: filename.slice(filename.lastIndexOf('/') + 1),
        };
      };
      Object.defineProperty(hook, 'call', { value: null });
      return hook;
    };
    const descriptors = new Map();
    for (const extension of ['.hook', '.js', '.json']) {
      descriptors.set(extension, Object.getOwnPropertyDescriptor(require.extensions, extension));
    }
    require.extensions['.hook'] = poisonedHook('explicit');
    require.extensions['.js'] = poisonedHook('fallback');
    require.extensions['.json'] = poisonedHook('json');
    try {
      for (const target of ['./explicit.hook', './fallback.unknown', './data.json']) {
        try { results.push(require(target)); }
        catch (error) { results.push({ error: error.name }); }
      }
    } finally {
      for (const [extension, descriptor] of descriptors) {
        if (descriptor) Object.defineProperty(require.extensions, extension, descriptor);
        else delete require.extensions[extension];
      }
    }
    console.log(JSON.stringify(results));
  `,
  expected:
    '[{"label":"explicit","receiver":true,"filename":"explicit.hook"},{"label":"fallback","receiver":true,"filename":"fallback.unknown"},{"label":"json","receiver":true,"filename":"data.json"}]\n',
};

export default c;
