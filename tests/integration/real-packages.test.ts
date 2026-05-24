import { MemorySyncVfs, createModuleLoader } from '@rifty/runtime-js/loader';
/**
 * Integration smoke: simulate a real CJS-shaped package (lodash-style) and an
 * ESM-shaped package (nanoid-style) loaded through the rifty module loader.
 *
 * We don't ship real npm tarballs here yet — M9 will do that. For now we use
 * minimal hand-shaped fixtures that exercise the package.json fields the real
 * packages use: `main`, `exports` with `import`/`require` conditions,
 * `"type": "module"`.
 */
import { describe, expect, it } from 'vitest';

function loader(files: Record<string, string>) {
  const vfs = new MemorySyncVfs();
  vfs.loadFixture(files);
  return createModuleLoader(vfs);
}

describe('integration — lodash-style CJS package', () => {
  it('loads via package.json main + chained call', () => {
    const l = loader({
      '/app/main.js': `
        const _ = require('lodash');
        module.exports = _.chunk([1, 2, 3, 4, 5], 2);
      `,
      '/app/node_modules/lodash/package.json':
        '{"name":"lodash","version":"4.17.21","main":"./lodash.js"}',
      '/app/node_modules/lodash/lodash.js': `
        function chunk(arr, size) {
          const out = [];
          for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
          return out;
        }
        module.exports = { chunk };
      `,
    });
    expect(l.require('./main.js', '/app/entry.js')).toEqual([[1, 2], [3, 4], [5]]);
  });

  it('loads a submodule via direct path require', () => {
    const l = loader({
      '/app/main.js': "module.exports = require('lodash/fp');",
      '/app/node_modules/lodash/package.json':
        '{"name":"lodash","version":"4.17.21","main":"./lodash.js"}',
      '/app/node_modules/lodash/lodash.js': 'module.exports = "main";',
      '/app/node_modules/lodash/fp.js': 'module.exports = "fp";',
    });
    expect(l.require('./main.js', '/app/entry.js')).toBe('fp');
  });
});

describe('integration — nanoid-style ESM package', () => {
  it('loads via package.json exports.import condition and default export', async () => {
    const l = loader({
      '/app/main.mjs': `
        import { nanoid } from 'nanoid';
        export const id = nanoid(6);
      `,
      '/app/node_modules/nanoid/package.json': JSON.stringify({
        name: 'nanoid',
        version: '5.0.0',
        type: 'module',
        exports: {
          '.': {
            import: './index.js',
            require: './index.cjs',
          },
        },
      }),
      '/app/node_modules/nanoid/index.js': `
        const ALPHA = 'abcdefghijklmnopqrstuvwxyz0123456789';
        export function nanoid(size = 21) {
          let id = '';
          let i = size;
          while (i--) id += ALPHA[(Math.random() * ALPHA.length) | 0];
          return id;
        }
      `,
      '/app/node_modules/nanoid/index.cjs': `
        module.exports = { nanoid: () => 'cjs-fallback' };
      `,
    });
    const ns = await l.import('./main.mjs', '/app/entry.mjs');
    expect(typeof ns.id).toBe('string');
    expect((ns.id as string).length).toBe(6);
  });

  it('honours type:module for plain .js extension in package', async () => {
    const l = loader({
      '/app/main.mjs': "import { v } from 'inner'; export const value = v;",
      '/app/node_modules/inner/package.json':
        '{"name":"inner","type":"module","main":"./entry.js"}',
      '/app/node_modules/inner/entry.js': 'export const v = "esm-via-js";',
    });
    const ns = await l.import('./main.mjs', '/app/entry.mjs');
    expect(ns.value).toBe('esm-via-js');
  });
});
