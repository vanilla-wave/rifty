import { MemorySyncVfs } from '@rifty/runtime-js/loader';
import { createModuleLoader } from '@rifty/runtime-js/loader';
import { describe, expect, it } from 'vitest';

function setup(files: Record<string, string>): ReturnType<typeof createModuleLoader> {
  const vfs = new MemorySyncVfs();
  vfs.loadFixture(files);
  return createModuleLoader(vfs);
}

describe('CJS resolver — Node algorithm', () => {
  it('resolves explicit .js extension', () => {
    const loader = setup({
      '/app/main.js': "module.exports = require('./other.js');",
      '/app/other.js': 'module.exports = 42;',
    });
    expect(loader.require('./main.js', '/app/entry.js')).toBe(42);
  });

  it('resolves without extension', () => {
    const loader = setup({
      '/app/main.js': "module.exports = require('./other');",
      '/app/other.js': "module.exports = 'hello';",
    });
    expect(loader.require('./main.js', '/app/entry.js')).toBe('hello');
  });

  it('resolves directory via index.js', () => {
    const loader = setup({
      '/app/main.js': "module.exports = require('./dir');",
      '/app/dir/index.js': "module.exports = 'idx';",
    });
    expect(loader.require('./main.js', '/app/entry.js')).toBe('idx');
  });

  it('resolves directory via package.json main', () => {
    const loader = setup({
      '/app/main.js': "module.exports = require('./pkg');",
      '/app/pkg/package.json': '{"main": "./lib/entry.js"}',
      '/app/pkg/lib/entry.js': "module.exports = 'pkg-main';",
    });
    expect(loader.require('./main.js', '/app/entry.js')).toBe('pkg-main');
  });

  it('walks up node_modules', () => {
    const loader = setup({
      '/a/b/c/main.js': "module.exports = require('lib');",
      '/a/node_modules/lib/package.json': '{"main":"./index.js"}',
      '/a/node_modules/lib/index.js': "module.exports = 'lib-from-root';",
    });
    expect(loader.require('./a/b/c/main.js', '/entry.js')).toBe('lib-from-root');
  });

  it('uses nearer node_modules first', () => {
    const loader = setup({
      '/a/b/c/main.js': "module.exports = require('lib');",
      '/a/b/node_modules/lib/index.js': "module.exports = 'near';",
      '/a/node_modules/lib/index.js': "module.exports = 'far';",
    });
    expect(loader.require('./a/b/c/main.js', '/entry.js')).toBe('near');
  });

  it('resolves scoped package subpath', () => {
    const loader = setup({
      '/app/main.js': "module.exports = require('@scope/pkg/sub');",
      '/app/node_modules/@scope/pkg/package.json': '{"main":"./main.js"}',
      '/app/node_modules/@scope/pkg/sub.js': "module.exports = 'sub';",
    });
    expect(loader.require('./main.js', '/app/entry.js')).toBe('sub');
  });

  it('honours package.json exports (conditional, require)', () => {
    const loader = setup({
      '/app/main.js': "module.exports = require('lib');",
      '/app/node_modules/lib/package.json':
        '{"exports": {"require": "./cjs.js", "import": "./esm.mjs"}}',
      '/app/node_modules/lib/cjs.js': "module.exports = 'cjs';",
      '/app/node_modules/lib/esm.mjs': "export default 'esm';",
    });
    expect(loader.require('./main.js', '/app/entry.js')).toBe('cjs');
  });

  it('honours package.json exports subpath', () => {
    const loader = setup({
      '/app/main.js': "module.exports = require('lib/fp');",
      '/app/node_modules/lib/package.json': '{"exports": {"./fp": "./lib-fp.js"}}',
      '/app/node_modules/lib/lib-fp.js': "module.exports = 'fp';",
    });
    expect(loader.require('./main.js', '/app/entry.js')).toBe('fp');
  });

  it('throws PACKAGE_PATH_NOT_EXPORTED for missing subpath', () => {
    const loader = setup({
      '/app/main.js': "module.exports = require('lib/nope');",
      '/app/node_modules/lib/package.json': '{"exports": {"./ok": "./ok.js"}}',
      '/app/node_modules/lib/ok.js': "module.exports = 'ok';",
    });
    expect(() => loader.require('./main.js', '/app/entry.js')).toThrow(
      /PACKAGE_PATH_NOT_EXPORTED|exports/,
    );
  });

  it('resolves node: built-ins (M3 added support)', () => {
    const loader = setup({
      '/app/main.js': "module.exports = typeof require('node:path').join;",
    });
    expect(loader.require('./main.js', '/app/entry.js')).toBe('function');
  });

  it('throws MODULE_NOT_FOUND for unknown node: built-in', () => {
    const loader = setup({
      '/app/main.js': "module.exports = require('node:nonexistent');",
    });
    expect(() => loader.require('./main.js', '/app/entry.js')).toThrow(
      /MODULE_NOT_FOUND|nonexistent/,
    );
  });

  it('throws MODULE_NOT_FOUND for missing', () => {
    const loader = setup({
      '/app/main.js': "module.exports = require('./missing');",
    });
    expect(() => loader.require('./main.js', '/app/entry.js')).toThrow(/MODULE_NOT_FOUND|missing/);
  });

  it('require.resolve returns absolute path', () => {
    const loader = setup({
      '/app/main.js': "module.exports = require.resolve('./other');",
      '/app/other.js': 'module.exports = 1;',
    });
    expect(loader.require('./main.js', '/app/entry.js')).toBe('/app/other.js');
  });

  it('resolves .mjs explicitly', () => {
    const loader = setup({
      '/app/main.js': "module.exports = 'ok';",
      '/app/lib.mjs': 'export default 1;',
    });
    expect(loader.require('./main.js', '/app/entry.js')).toBe('ok');
  });

  it('loads JSON files', () => {
    const loader = setup({
      '/app/main.js': "module.exports = require('./data.json');",
      '/app/data.json': '{"hello":"world"}',
    });
    expect(loader.require('./main.js', '/app/entry.js')).toEqual({ hello: 'world' });
  });
});

describe('CJS — module semantics', () => {
  it('module.exports assignment replaces exports object', () => {
    const loader = setup({
      '/m.js': 'function foo() {} foo.bar = 1; module.exports = foo;',
    });
    const result = loader.require('./m.js', '/entry.js') as Record<string, unknown>;
    expect(typeof result).toBe('function');
    expect((result as { bar?: number }).bar).toBe(1);
  });

  it('exports shorthand works (named exports on `exports`)', () => {
    const loader = setup({
      '/m.js': 'exports.a = 1; exports.b = 2;',
    });
    expect(loader.require('./m.js', '/entry.js')).toMatchObject({ a: 1, b: 2 });
  });

  it('cycles: half-populated module visible', () => {
    const loader = setup({
      '/a.js':
        "exports.done = false; const b = require('./b'); exports.b = b; exports.done = true;",
      '/b.js': "const a = require('./a'); module.exports = { aDoneAtImport: a.done };",
    });
    const a = loader.require('./a.js', '/entry.js') as Record<string, unknown>;
    expect(a.done).toBe(true);
    expect(a.b).toMatchObject({ aDoneAtImport: false });
  });

  it('caches modules (single execution)', () => {
    const loader = setup({
      '/counter.js': 'let n = 0; module.exports = () => ++n;',
      '/main.js':
        "const a = require('./counter'); const b = require('./counter'); module.exports = [a(), b(), a === b];",
    });
    expect(loader.require('./main.js', '/entry.js')).toEqual([1, 2, true]);
  });

  it('__dirname / __filename are set', () => {
    const loader = setup({
      '/app/sub/m.js': 'module.exports = { dirname: __dirname, filename: __filename };',
    });
    expect(loader.require('./app/sub/m.js', '/entry.js')).toEqual({
      dirname: '/app/sub',
      filename: '/app/sub/m.js',
    });
  });

  it('require() of ESM throws helpful error', () => {
    const loader = setup({
      '/main.js': "module.exports = require('./esm.mjs');",
      '/esm.mjs': 'export default 1;',
    });
    expect(() => loader.require('./main.js', '/entry.js')).toThrow(/ES Module/);
  });
});

describe('ESM — import / export', () => {
  it('static default import', async () => {
    const loader = setup({
      '/a.mjs': "export default 'hi';",
      '/b.mjs': "import x from './a.mjs'; export const value = x + '!';",
    });
    const ns = await loader.import('./b.mjs', '/entry.mjs');
    expect(ns.value).toBe('hi!');
  });

  it('static named import + named export', async () => {
    const loader = setup({
      '/a.mjs': 'export const a = 1; export const b = 2;',
      '/main.mjs': "import { a, b } from './a.mjs'; export const sum = a + b;",
    });
    const ns = await loader.import('./main.mjs', '/entry.mjs');
    expect(ns.sum).toBe(3);
  });

  it('export with rename', async () => {
    const loader = setup({
      '/a.mjs': 'const inner = 7; export { inner as outer };',
      '/main.mjs': "import { outer } from './a.mjs'; export const v = outer;",
    });
    const ns = await loader.import('./main.mjs', '/entry.mjs');
    expect(ns.v).toBe(7);
  });

  it('namespace import', async () => {
    const loader = setup({
      '/a.mjs': 'export const a = 1; export const b = 2; export default 99;',
      '/main.mjs': "import * as A from './a.mjs'; export const value = A.a + A.b + A.default;",
    });
    const ns = await loader.import('./main.mjs', '/entry.mjs');
    expect(ns.value).toBe(102);
  });

  it('top-level await', async () => {
    const loader = setup({
      '/a.mjs': 'const x = await Promise.resolve(42); export const v = x;',
    });
    const ns = await loader.import('./a.mjs', '/entry.mjs');
    expect(ns.v).toBe(42);
  });

  it('dynamic import()', async () => {
    const loader = setup({
      '/a.mjs': "export const v = 'dyn';",
      '/main.mjs': "export const value = await (await import('./a.mjs')).v;",
    });
    const ns = await loader.import('./main.mjs', '/entry.mjs');
    expect(ns.value).toBe('dyn');
  });

  it('live bindings via re-export', async () => {
    const loader = setup({
      '/counter.mjs': 'export let count = 0; export function inc() { count += 1; }',
      '/reexport.mjs': "export { count, inc } from './counter.mjs';",
      '/main.mjs':
        "import { count, inc } from './reexport.mjs'; export const before = count; inc(); inc(); export const after = count;",
    });
    const ns = await loader.import('./main.mjs', '/entry.mjs');
    expect(ns.before).toBe(0);
    expect(ns.after).toBe(2);
  });

  it('live bindings on direct named import', async () => {
    const loader = setup({
      '/state.mjs': "export let value = 'a'; export function setValue(v) { value = v; }",
      '/main.mjs':
        "import { value, setValue } from './state.mjs'; export const initial = value; setValue('b'); export const after = value;",
    });
    const ns = await loader.import('./main.mjs', '/entry.mjs');
    expect(ns.initial).toBe('a');
    expect(ns.after).toBe('b');
  });

  it('export * from re-exports all names', async () => {
    const loader = setup({
      '/a.mjs': 'export const a = 1; export const b = 2;',
      '/b.mjs': "export * from './a.mjs';",
      '/main.mjs': "import * as B from './b.mjs'; export const sum = B.a + B.b;",
    });
    const ns = await loader.import('./main.mjs', '/entry.mjs');
    expect(ns.sum).toBe(3);
  });

  it('ESM importing CJS gets default export', async () => {
    const loader = setup({
      '/c.js': "module.exports = { name: 'cjs', n: 5 };",
      '/main.mjs':
        "import mod from './c.js'; import { n } from './c.js'; export const v = mod.name + ':' + n;",
    });
    const ns = await loader.import('./main.mjs', '/entry.mjs');
    expect(ns.v).toBe('cjs:5');
  });

  it('export default of a function preserves name', async () => {
    const loader = setup({
      '/m.mjs': "export default function hello() { return 'hi'; }",
    });
    const ns = await loader.import('./m.mjs', '/entry.mjs');
    expect((ns.default as () => string)()).toBe('hi');
  });

  it('CJS↔ESM interop: ESM import of CJS without explicit default', async () => {
    const loader = setup({
      '/c.js': 'exports.a = 1; exports.b = 2;',
      '/main.mjs': "import * as C from './c.js'; export const sum = C.a + C.b;",
    });
    const ns = await loader.import('./main.mjs', '/entry.mjs');
    expect(ns.sum).toBe(3);
  });
});
