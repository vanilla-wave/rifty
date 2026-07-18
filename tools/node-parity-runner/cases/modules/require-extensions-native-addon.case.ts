import type { ParityCase } from '../../src/types.ts';

const c: ParityCase = {
  setup: {
    files: {
      'addon.node': 'this is not a native binary',
    },
  },
  code: `
    const original = require.extensions['.node'];
    const surface = {
      keys: Object.keys(require.extensions),
      nativeType: typeof original,
    };
    require.extensions['.node'] = function (module, filename) {
      module.exports = {
        receiver: this === require.extensions,
        filename: filename.slice(filename.lastIndexOf('/') + 1),
      };
    };
    try {
      console.log(JSON.stringify({ surface, loaded: require('./addon.node') }));
    } finally {
      require.extensions['.node'] = original;
    }
  `,
  expected:
    '{"surface":{"keys":[".js",".json",".node"],"nativeType":"function"},"loaded":{"receiver":true,"filename":"addon.node"}}\n',
};

export default c;
