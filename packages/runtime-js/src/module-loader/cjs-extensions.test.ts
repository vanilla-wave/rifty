import { MemoryFsSync } from '@riftydev/vfs/internal';
import { describe, expect, it } from 'vitest';
import { createModuleLoader } from './loader.ts';

describe('CJS extension hooks', () => {
  it('shares one hook table and compiles replacement source against its filename', () => {
    const vfs = new MemoryFsSync();
    vfs.loadFixture({
      '/work/main.js': `
        const { createRequire } = require('node:module');
        const externalRequire = createRequire('/work/external.mjs');
        const sharedExtensions = require.extensions === externalRequire.extensions;
        const target = externalRequire.resolve('./target.js');
        const defaultLoader = externalRequire.extensions['.js'];
        const seen = [];
        externalRequire.extensions['.js'] = (module, filename) => {
          seen.push(filename);
          if (filename === target) {
            module._compile(
              "module.exports = { filename: __filename, dep: require('./dep.js') };",
              '/work/generated/bundle.cjs',
            );
          } else {
            defaultLoader(module, filename);
          }
        };
        try {
          module.exports = {
            loaded: externalRequire('./target.js'),
            seen,
            sharedExtensions,
          };
        } finally {
          externalRequire.extensions['.js'] = defaultLoader;
        }
      `,
      '/work/target.js': 'export default "original";\n',
      '/work/generated/dep.js': 'module.exports = "nested-default";\n',
    });

    const loader = createModuleLoader(vfs, { cwd: '/work' });

    expect(loader.require('./main.js', '/work/entry.js')).toEqual({
      loaded: {
        filename: '/work/generated/bundle.cjs',
        dep: 'nested-default',
      },
      seen: ['/work/target.js', '/work/generated/dep.js'],
      sharedExtensions: true,
    });
  });
});
