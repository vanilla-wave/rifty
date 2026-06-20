import type { ParityCase } from '../../src/types.ts';

const c: ParityCase = {
  kind: 'esm',
  setup: {
    files: {
      'package.json': JSON.stringify({
        type: 'module',
        imports: {
          '#dep': './lib/node-target.mjs',
          '#deps/*': './lib/deps/*.mjs',
          '#conditional': {
            node: './lib/node-target.mjs',
            default: './lib/default-target.mjs',
          },
        },
      }),
      'lib/node-target.mjs': 'export const value = "node";',
      'lib/default-target.mjs': 'export const value = "default";',
      'lib/deps/foo.mjs': 'export default "foo";',
    },
  },
  code: `
    import { value as exact } from '#dep';
    import wildcard from '#deps/foo';
    import { value as conditional } from '#conditional';
    console.log([exact, wildcard, conditional].join('|'));
  `,
  expected: 'node|foo|node\n',
};

export default c;
