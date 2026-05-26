import { createModuleLoader } from '@rifty/runtime-js/loader';
import { MemoryFsSync } from '@rifty/vfs/internal';
import { describe, expect, it } from 'vitest';

function setup(files: Record<string, string>): ReturnType<typeof createModuleLoader> {
  const vfs = new MemoryFsSync();
  vfs.loadFixture(files);
  return createModuleLoader(vfs);
}

describe('CJS resolver — `imports` field (`#name` specifiers)', () => {
  it('resolves an exact `#dep` to its mapped file', () => {
    const loader = setup({
      '/app/package.json': '{"imports": {"#dep": "./lib/internal.js"}}',
      '/app/main.js': "module.exports = require('#dep');",
      '/app/lib/internal.js': "module.exports = 'internal';",
    });
    expect(loader.require('./app/main.js', '/entry.js')).toBe('internal');
  });

  it('resolves a wildcard `#deps/*` to a `*`-substituted file', () => {
    const loader = setup({
      '/app/package.json': '{"imports": {"#deps/*": "./lib/deps/*.js"}}',
      '/app/main.js': "module.exports = require('#deps/foo');",
      '/app/lib/deps/foo.js': "module.exports = 'foo-content';",
    });
    expect(loader.require('./app/main.js', '/entry.js')).toBe('foo-content');
  });

  it('honours conditions in an `imports` target (picks `node`)', () => {
    const loader = setup({
      '/app/package.json':
        '{"imports": {"#dep": {"node": "./node-target.js", "default": "./default-target.js"}}}',
      '/app/main.js': "module.exports = require('#dep');",
      '/app/node-target.js': "module.exports = 'node-branch';",
      '/app/default-target.js': "module.exports = 'default-branch';",
    });
    expect(loader.require('./app/main.js', '/entry.js')).toBe('node-branch');
  });

  it('throws MODULE_NOT_FOUND for an unmapped `#dep`', () => {
    const loader = setup({
      '/app/package.json': '{"imports": {"#ok": "./ok.js"}}',
      '/app/main.js': "module.exports = require('#missing');",
      '/app/ok.js': "module.exports = 'ok';",
    });
    expect(() => loader.require('./app/main.js', '/entry.js')).toThrow(/MODULE_NOT_FOUND|missing/);
  });

  it('throws MODULE_NOT_FOUND when no enclosing package.json has `imports`', () => {
    const loader = setup({
      '/app/main.js': "module.exports = require('#dep');",
    });
    expect(() => loader.require('./app/main.js', '/entry.js')).toThrow(
      /MODULE_NOT_FOUND|Cannot find package import/,
    );
  });
});
