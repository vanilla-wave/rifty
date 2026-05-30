import { createModuleLoader } from '@rifty/runtime-js/loader';
import { MemoryFsSync } from '@rifty/vfs/internal';
import { describe, expect, it } from 'vitest';

function setup(files: Record<string, string>): ReturnType<typeof createModuleLoader> {
  const vfs = new MemoryFsSync();
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

describe('TS extension resolution', () => {
  it('resolves foo.ts when foo.js is absent', () => {
    const loader = setup({
      '/app/foo.ts': 'export const x: number = 1;',
    });
    const resolved = loader.resolver.resolve('./foo', { fromFile: '/app/entry.ts', esm: true });
    expect(resolved.id).toBe('/app/foo.ts');
  });

  it('prefers foo.js over foo.ts when both exist (Node-deviation guard)', () => {
    const loader = setup({
      '/app/foo.js': "module.exports = 'js';",
      '/app/foo.ts': 'export const x: number = 1;',
    });
    const resolved = loader.resolver.resolve('./foo', { fromFile: '/app/entry.ts', esm: true });
    expect(resolved.id.endsWith('.js')).toBe(true);
    expect(resolved.id).toBe('/app/foo.js');
  });

  it('resolves a directory via index.ts', () => {
    const loader = setup({
      '/app/dir/index.ts': 'export const v: number = 7;',
    });
    const resolved = loader.resolver.resolve('./dir', { fromFile: '/app/entry.ts', esm: true });
    expect(resolved.id).toBe('/app/dir/index.ts');
  });

  it('detectKind: a .ts under {"type":"module"} classifies as esm', () => {
    const loader = setup({
      '/p/package.json': '{"type":"module"}',
      '/p/a.ts': 'export const a: number = 1;',
    });
    const resolved = loader.resolver.resolve('./a.ts', { fromFile: '/p/entry.ts', esm: true });
    expect(resolved.kind).toBe('esm');
  });

  it('detectKind: a .ts under a non-module package.json classifies as cjs', () => {
    const loader = setup({
      '/q/package.json': '{"name":"q"}',
      '/q/b.ts': 'export const b = 1;',
    });
    const resolved = loader.resolver.resolve('./b.ts', { fromFile: '/q/entry.js', esm: false });
    expect(resolved.kind).toBe('cjs');
  });

  it('a package that ships both index.ts and index.js still resolves index.js (Node parity)', () => {
    // Regression guard for ADR-0053 (decision 2): a real package shipping its
    // build artefact `index.js` alongside source `index.ts` and NO `exports`
    // field MUST still pick `.js` — Node never resolves bare `.ts`, so the
    // `.js` family ordering in INDEX_FILES is the safety property the "unchanged
    // for all existing consumers / vite path / conformance" merge claim rests on.
    // Asserts the EXECUTED export, not just the resolved id, so a kind/ordering
    // drift that resolved `.ts` here would surface as the wrong runtime value.
    const loader = setup({
      '/app/main.js': "module.exports = require('lib');",
      '/app/node_modules/lib/index.js': "module.exports = 'js-build';",
      '/app/node_modules/lib/index.ts': 'export const x: number = 1;',
    });
    expect(loader.require('./main.js', '/app/entry.js')).toBe('js-build');
    const resolved = loader.resolver.resolve('lib', { fromFile: '/app/main.js', esm: false });
    expect(resolved.id).toBe('/app/node_modules/lib/index.js');
  });
});

describe('declaration-file exclusion', () => {
  // review.md correctness-MAJOR: `.ts` entered DEFAULT_EXTENSIONS/INDEX_FILES with
  // no `.d.ts` exclusion, so a target shipping ONLY a declaration file resolved the
  // `.d.ts` and tried to EXECUTE it -> acorn SYNTAX_ERROR. Node's own strip-types
  // loaders deliberately skip `.d.ts`/`.d.cts`/`.d.mts` — they are types-only, never
  // runnable. The resolver must treat a `.d.ts` candidate as if it did not exist.

  it('does NOT resolve a subpath that ships only foo.d.ts', () => {
    // `./foo.d` makes `${base}.ts` === `foo.d.ts`; today that matched and resolved
    // the declaration file. After the fix it must MODULE_NOT_FOUND (no runnable file).
    const loader = setup({
      '/app/foo.d.ts': 'export interface Box { n: number }',
    });
    expect(() =>
      loader.resolver.resolve('./foo.d', { fromFile: '/app/entry.ts', esm: true }),
    ).toThrow(/MODULE_NOT_FOUND|Cannot find module/);
  });

  it('does NOT resolve an explicit ./foo.d.ts import as a runnable module', () => {
    // An explicit `.d.ts` specifier hits the `st.isFile` early-return in
    // resolveAsFileOrDir; that path must also reject declaration files.
    const loader = setup({
      '/app/foo.d.ts': 'export interface Box { n: number }',
    });
    expect(() =>
      loader.resolver.resolve('./foo.d.ts', { fromFile: '/app/entry.ts', esm: true }),
    ).toThrow(/MODULE_NOT_FOUND|Cannot find module/);
  });

  it('does NOT resolve a directory whose only index is index.d.ts', () => {
    // A package whose `main` (or directory index) lands on a declaration file must
    // not resolve it. Uses `main: "./index.d.ts"` so the candidate is reached and
    // rejected (rather than relying on INDEX_FILES, which carries no `.d.ts` entry).
    const loader = setup({
      '/app/main.ts': "import x from './pkg'; export const v = x;",
      '/app/pkg/package.json': '{"main":"./index.d.ts"}',
      '/app/pkg/index.d.ts': 'export interface Box { n: number }',
    });
    expect(() => loader.resolver.resolve('./pkg', { fromFile: '/app/main.ts', esm: true })).toThrow(
      /MODULE_NOT_FOUND|Cannot find module/,
    );
  });

  it('does NOT resolve a package exports target that points at a .d.ts', () => {
    // A real package can ship `"exports": { "./types": "./types.d.ts" }`; resolving
    // that subpath must not hand back the declaration file to be executed.
    const loader = setup({
      '/app/node_modules/lib/package.json': '{"exports":{"./types":"./types.d.ts"}}',
      '/app/node_modules/lib/types.d.ts': 'export interface Box { n: number }',
    });
    expect(() =>
      loader.resolver.resolve('lib/types', { fromFile: '/app/main.ts', esm: true }),
    ).toThrow(/MODULE_NOT_FOUND|Cannot find module/);
  });

  it('still resolves a sibling .js when the directory also carries a .d.ts', () => {
    // The exclusion must be surgical: a runnable `foo.js` next to a `foo.d.ts`
    // must still resolve (the `.d.ts` is skipped, the `.js` wins as before).
    const loader = setup({
      '/app/foo.js': "module.exports = 'js';",
      '/app/foo.d.ts': 'export interface Box { n: number }',
    });
    const resolved = loader.resolver.resolve('./foo', { fromFile: '/app/entry.ts', esm: true });
    expect(resolved.id).toBe('/app/foo.js');
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
