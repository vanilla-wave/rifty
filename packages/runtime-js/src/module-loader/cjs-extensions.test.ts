import { MemoryFsSync } from '@riftydev/vfs/internal';
import { describe, expect, it } from 'vitest';
import { createModuleLoader } from './loader.ts';

function extensionFixture(extension: string): Record<string, string> {
  const target = `target${extension}`;
  return {
    '/work/package.json': JSON.stringify({ type: 'commonjs' }),
    '/work/main.js': `
      const target = require.resolve('./${target}');
      const seen = [];
      require.extensions[${JSON.stringify(extension)}] = function (module, filename) {
        seen.push({
          receiver: this === require.extensions,
          filename: filename.endsWith('${target}'),
          compile: typeof module._compile,
        });
        module._compile(
          ${JSON.stringify(`module.exports = { extension: ${JSON.stringify(extension)}, dep: require('./dep.js') };`)},
          filename,
        );
      };
      try {
        module.exports = { loaded: require('./${target}'), seen };
      } finally {
        delete require.extensions[${JSON.stringify(extension)}];
      }
    `,
    [`/work/${target}`]: 'this is deliberately not JavaScript or JSON',
    '/work/dep.js': 'module.exports = "dep";\n',
  };
}

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

  it.each(['.ts', '.tsx', '.jsx', '.cjs', '.json', '.node', '.txt', '.coffee', '.foo.bar'])(
    'dispatches a registered %s suffix like Node',
    (extension) => {
      const vfs = new MemoryFsSync();
      vfs.loadFixture(extensionFixture(extension));
      const loader = createModuleLoader(vfs, { cwd: '/work' });

      expect(loader.require('./main.js', '/work/entry.js')).toEqual({
        loaded: { extension, dep: 'dep' },
        seen: [{ receiver: true, filename: true, compile: 'function' }],
      });
    },
  );

  it('selects the longest truthy basename suffix and skips leading or parent-directory dots', () => {
    const vfs = new MemoryFsSync();
    vfs.loadFixture({
      '/work/package.json': JSON.stringify({ type: 'commonjs' }),
      '/work/main.js': `
        const seen = [];
        const hook = (label) => function (module, filename) {
          seen.push(label);
          module.exports = { label, filename: filename.slice(filename.lastIndexOf('/') + 1) };
        };
        const defaultJs = require.extensions['.js'];
        require.extensions['.bar'] = hook('short');
        require.extensions['.foo.bar'] = hook('long');
        require.extensions['.hidden'] = hook('hidden');
        require.extensions['.with.dot/plain'] = hook('parent');
        try {
          const longest = require('./long.foo.bar');
          require.extensions['.foo.bar'] = 0;
          const shorter = require('./short.foo.bar');
          require.extensions['.js'] = hook('js');
          const hidden = require('./.hidden');
          const parent = require('./dir.with.dot/plain');
          module.exports = { longest, shorter, hidden, parent, seen };
        } finally {
          require.extensions['.js'] = defaultJs;
          delete require.extensions['.bar'];
          delete require.extensions['.foo.bar'];
          delete require.extensions['.hidden'];
          delete require.extensions['.with.dot/plain'];
        }
      `,
      '/work/long.foo.bar': 'not JavaScript',
      '/work/short.foo.bar': 'not JavaScript',
      '/work/.hidden': 'not JavaScript',
      '/work/dir.with.dot/plain': 'not JavaScript',
    });
    const loader = createModuleLoader(vfs, { cwd: '/work' });

    expect(loader.require('./main.js', '/work/entry.js')).toEqual({
      longest: { label: 'long', filename: 'long.foo.bar' },
      shorter: { label: 'short', filename: 'short.foo.bar' },
      hidden: { label: 'js', filename: '.hidden' },
      parent: { label: 'js', filename: 'plain' },
      seen: ['long', 'short', 'js', 'js'],
    });
  });

  it('uses the current .js hook as Node fallback for an unregistered suffix', () => {
    const vfs = new MemoryFsSync();
    vfs.loadFixture({
      '/work/package.json': JSON.stringify({ type: 'commonjs' }),
      '/work/main.js': `
        const target = require.resolve('./config.ts');
        const defaultLoader = require.extensions['.js'];
        require.extensions['.js'] = function (module, filename) {
          if (filename === target) {
            module._compile(
              'module.exports = { compiled: true, receiver: ' +
                (this === require.extensions) +
                ' };',
              filename,
            );
          } else {
            defaultLoader.call(this, module, filename);
          }
        };
        try {
          module.exports = require('./config.ts');
        } finally {
          require.extensions['.js'] = defaultLoader;
        }
      `,
      '/work/config.ts': 'const uncompiled: never = "must not execute";\n',
    });
    const loader = createModuleLoader(vfs, { cwd: '/work' });

    expect(loader.require('./main.js', '/work/entry.js')).toEqual({
      compiled: true,
      receiver: true,
    });
  });

  it('routes resolver-owned text through the current .js fallback', () => {
    const vfs = new MemoryFsSync();
    vfs.loadFixture({
      '/work/package.json': JSON.stringify({ type: 'commonjs' }),
      '/work/main.js': `
        const defaultLoader = require.extensions['.js'];
        require.extensions['.js'] = function (module, filename) {
          module.exports = {
            receiver: this === require.extensions,
            filename: filename.slice(filename.lastIndexOf('/') + 1),
          };
        };
        try {
          module.exports = require('./message.txt');
        } finally {
          require.extensions['.js'] = defaultLoader;
        }
      `,
      '/work/message.txt': 'raw text must not bypass the current js hook',
    });
    const loader = createModuleLoader(vfs, { cwd: '/work' });

    expect(loader.require('./main.js', '/work/entry.js')).toEqual({
      receiver: true,
      filename: 'message.txt',
    });
  });

  it('starts with Node default extension keys and a callable native-addon ceiling', () => {
    const vfs = new MemoryFsSync();
    vfs.loadFixture({
      '/work/main.js': `
        const surface = {
          keys: Object.keys(require.extensions),
          nativeType: typeof require.extensions['.node'],
        };
        let missing;
        let failure;
        try { require('./missing.node'); }
        catch (error) { missing = { name: error.name, code: error.code }; }
        try { require('./addon.node'); }
        catch (error) { failure = { name: error.name, feature: error.feature }; }
        const nativeLoader = require.extensions['.node'];
        require.extensions['.node'] = function (module, filename) {
          module.exports = {
            receiver: this === require.extensions,
            filename: filename.slice(filename.lastIndexOf('/') + 1),
          };
        };
        try {
          module.exports = {
            surface,
            missing,
            failure,
            retried: require('./addon.node'),
          };
        } finally {
          require.extensions['.node'] = nativeLoader;
        }
      `,
      '/work/addon.node': 'module.exports = "must not execute as JavaScript";\n',
    });
    const loader = createModuleLoader(vfs, { cwd: '/work' });

    expect(loader.require('./main.js', '/work/entry.js')).toEqual({
      surface: {
        keys: ['.js', '.json', '.node'],
        nativeType: 'function',
      },
      missing: { name: 'ModuleLoadError', code: 'MODULE_NOT_FOUND' },
      failure: {
        name: 'NotImplementedError',
        feature: 'module-loader.native-addon',
      },
      retried: { receiver: true, filename: 'addon.node' },
    });
  });

  it('returns cached exports before consulting a changed suffix hook', () => {
    const vfs = new MemoryFsSync();
    vfs.loadFixture({
      '/work/package.json': JSON.stringify({ type: 'commonjs' }),
      '/work/main.js': `
        let calls = 0;
        require.extensions['.coffee'] = function (module) {
          calls += 1;
          module.exports = { calls };
        };
        try {
          const first = require('./target.coffee');
          require.extensions['.coffee'] = { not: 'callable' };
          const second = require('./target.coffee');
          module.exports = { same: first === second, calls, second };
        } finally {
          delete require.extensions['.coffee'];
        }
      `,
      '/work/target.coffee': 'not JavaScript',
    });
    const loader = createModuleLoader(vfs, { cwd: '/work' });

    expect(loader.require('./main.js', '/work/entry.js')).toEqual({
      same: true,
      calls: 1,
      second: { calls: 1 },
    });
  });

  it('preserves the exact value thrown by a registered suffix hook', () => {
    const vfs = new MemoryFsSync();
    vfs.loadFixture({
      '/work/package.json': JSON.stringify({ type: 'commonjs' }),
      '/work/main.js': `
        const sentinel = new Error('registered hook failed');
        sentinel.code = 'HOOK_SENTINEL';
        require.extensions['.coffee'] = function () { throw sentinel; };
        try {
          require('./target.coffee');
          module.exports = { returned: true };
        } catch (error) {
          module.exports = {
            same: error === sentinel,
            name: error.name,
            message: error.message,
            code: error.code,
          };
        } finally {
          delete require.extensions['.coffee'];
        }
      `,
      '/work/target.coffee': 'this source must not execute',
    });
    const loader = createModuleLoader(vfs, { cwd: '/work' });

    expect(loader.require('./main.js', '/work/entry.js')).toEqual({
      same: true,
      name: 'Error',
      message: 'registered hook failed',
      code: 'HOOK_SENTINEL',
    });
  });

  it('removes a hook failure from the cache before retrying the same suffix', () => {
    const vfs = new MemoryFsSync();
    vfs.loadFixture({
      '/work/package.json': JSON.stringify({ type: 'commonjs' }),
      '/work/main.js': `
        let attempts = 0;
        const sentinel = new Error('first attempt');
        require.extensions['.coffee'] = function (module) {
          attempts += 1;
          if (attempts === 1) throw sentinel;
          module.exports = { attempts };
        };
        let firstIsSentinel = false;
        try {
          require('./target.coffee');
        } catch (error) {
          firstIsSentinel = error === sentinel;
        }
        try {
          module.exports = { firstIsSentinel, loaded: require('./target.coffee'), attempts };
        } finally {
          delete require.extensions['.coffee'];
        }
      `,
      '/work/target.coffee': 'not JavaScript',
    });
    const loader = createModuleLoader(vfs, { cwd: '/work' });

    expect(loader.require('./main.js', '/work/entry.js')).toEqual({
      firstIsSentinel: true,
      loaded: { attempts: 2 },
      attempts: 2,
    });
  });

  it.each(['.ts', '.tsx', '.jsx'])(
    'keeps the loud synchronous transform ceiling for unhandled %s',
    (extension) => {
      const vfs = new MemoryFsSync();
      vfs.loadFixture({
        '/work/package.json': JSON.stringify({ type: 'commonjs' }),
        [`/work/target${extension}`]: 'const answer: number = 42;\n',
      });
      const loader = createModuleLoader(vfs, { cwd: '/work' });

      expect(() => loader.require(`./target${extension}`, '/work/entry.js')).toThrow(
        'module-loader.ts-via-require',
      );
    },
  );

  it('keeps the synchronous transform ceiling after an extension accessor poisons endsWith', () => {
    const vfs = new MemoryFsSync();
    vfs.loadFixture({
      '/work/package.json': JSON.stringify({ type: 'commonjs' }),
      '/work/main.js': `
        const descriptor = Object.getOwnPropertyDescriptor(require.extensions, '.ts');
        const originalEndsWith = String.prototype.endsWith;
        Object.defineProperty(require.extensions, '.ts', {
          configurable: true,
          enumerable: true,
          get() {
            String.prototype.endsWith = null;
            return 0;
          },
        });
        let failure;
        try { require('./target.ts'); }
        catch (error) { failure = { name: error.name, feature: error.feature }; }
        finally {
          String.prototype.endsWith = originalEndsWith;
          if (descriptor) Object.defineProperty(require.extensions, '.ts', descriptor);
          else delete require.extensions['.ts'];
        }
        module.exports = failure;
      `,
      '/work/target.ts': 'const answer: number = 42;\n',
    });
    const loader = createModuleLoader(vfs, { cwd: '/work' });

    expect(loader.require('./main.js', '/work/entry.js')).toEqual({
      name: 'NotImplementedError',
      feature: 'module-loader.ts-via-require',
    });
  });
});
