import { createModuleLoader } from '@riftydev/runtime-js/loader';
import { MemoryFsSync } from '@riftydev/vfs/internal';
import ts from 'typescript';
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

describe('exports subpath patterns — effect@4 / opencode-workspace shapes', () => {
  // These pin the EXACT `exports`-map shapes the opencode server graph leans on,
  // verified against the vendored tree (`effect@4.0.0-beta.66`, the
  // `@opencode-ai/*` workspace packages). The resolutions here are head-to-head
  // with real Node 24 (`createRequire(...).resolve(...)` on the same maps):
  //   effect: { "./unstable/http": "./dist/unstable/http/index.js",
  //             "./*": "./dist/*.js", "./internal/*": null, "./*/index": null }
  //   @opencode-ai/core: { "./*": "./src/*.ts" }
  // Each test reproduces a real specifier opencode emits and asserts the file the
  // resolver lands on, so a regression in subpath/wildcard/null-block handling
  // surfaces as a wrong target (or a missing block) rather than a silent boot.

  it('resolves an explicit deep subpath key (effect/unstable/http)', () => {
    // The exact key `./unstable/http` wins as a literal — not the `./*` wildcard.
    const loader = setup({
      '/app/main.mjs': "import * as http from 'effect/unstable/http'; export const v = http.x;",
      '/app/node_modules/effect/package.json': JSON.stringify({
        type: 'module',
        exports: { './unstable/http': './dist/unstable/http/index.js', './*': './dist/*.js' },
      }),
      '/app/node_modules/effect/dist/unstable/http/index.js': 'export const x = 1;',
    });
    const resolved = loader.resolver.resolve('effect/unstable/http', {
      fromFile: '/app/main.mjs',
      esm: true,
    });
    expect(resolved.id).toBe('/app/node_modules/effect/dist/unstable/http/index.js');
  });

  it('resolves a deep subpath via the catch-all "./*" wildcard (effect/unstable/http/HttpClientError)', () => {
    // No explicit `./unstable/http/HttpClientError` key exists; Node falls through
    // to `./*` -> `./dist/unstable/http/HttpClientError.js` (the `*` captures the
    // whole multi-segment tail). Verified against Node 24 on the real effect map.
    const loader = setup({
      '/app/main.mjs':
        "import * as e from 'effect/unstable/http/HttpClientError'; export const v = e.x;",
      '/app/node_modules/effect/package.json': JSON.stringify({
        type: 'module',
        exports: { './unstable/http': './dist/unstable/http/index.js', './*': './dist/*.js' },
      }),
      '/app/node_modules/effect/dist/unstable/http/HttpClientError.js': 'export const x = 2;',
    });
    const resolved = loader.resolver.resolve('effect/unstable/http/HttpClientError', {
      fromFile: '/app/main.mjs',
      esm: true,
    });
    expect(resolved.id).toBe('/app/node_modules/effect/dist/unstable/http/HttpClientError.js');
  });

  it('resolves a top-level module name via "./*" (effect/Effect, effect/Layer)', () => {
    const loader = setup({
      '/app/main.mjs': "import * as E from 'effect/Effect'; export const v = E.x;",
      '/app/node_modules/effect/package.json': JSON.stringify({
        type: 'module',
        exports: { '.': './dist/index.js', './*': './dist/*.js' },
      }),
      '/app/node_modules/effect/dist/Effect.js': 'export const x = 3;',
    });
    const resolved = loader.resolver.resolve('effect/Effect', {
      fromFile: '/app/main.mjs',
      esm: true,
    });
    expect(resolved.id).toBe('/app/node_modules/effect/dist/Effect.js');
  });

  it('resolves a scoped workspace package subpath to its .ts source ("./*": "./src/*.ts")', () => {
    // `@opencode-ai/core` ships NO build — `exports: { "./*": "./src/*.ts" }`
    // maps every subpath straight to TypeScript source. The resolver must land on
    // the `.ts` file (the transformSource hook strips it downstream). This is the
    // workspace-resolution shape the whole opencode graph rides on.
    const loader = setup({
      '/app/main.mjs': "import { Server } from '@opencode-ai/core/server/server';",
      '/app/node_modules/@opencode-ai/core/package.json': JSON.stringify({
        type: 'module',
        exports: { './*': './src/*.ts' },
      }),
      '/app/node_modules/@opencode-ai/core/src/server/server.ts':
        'export const Server: number = 1;',
    });
    const resolved = loader.resolver.resolve('@opencode-ai/core/server/server', {
      fromFile: '/app/main.mjs',
      esm: true,
    });
    expect(resolved.id).toBe('/app/node_modules/@opencode-ai/core/src/server/server.ts');
  });

  it('a more-specific null target blocks a path the catch-all "./*" would otherwise match (effect internal)', () => {
    // effect@4 declares `"./internal/*": null` AND `"./*": "./dist/*.js"`. Node
    // resolution picks the MOST-SPECIFIC matching pattern, so `effect/internal/x`
    // hits the null target and throws ERR_PACKAGE_PATH_NOT_EXPORTED — it must NOT
    // fall through to `./*` and leak `./dist/internal/x.js`. Verified against
    // Node 24: `require.resolve('effect/internal/effect')` -> PATH_NOT_EXPORTED.
    const loader = setup({
      '/app/main.mjs': "import 'effect/internal/secret';",
      '/app/node_modules/effect/package.json': JSON.stringify({
        type: 'module',
        // Key order mirrors the REAL effect@4 map: the catch-all `./*` is listed
        // BEFORE the `./internal/*` null block, so a first-match wildcard scan
        // (insertion order) leaks the internal file. Node ignores order and picks
        // the most-specific pattern — that is the contract under test.
        exports: { './*': './dist/*.js', './internal/*': null },
      }),
      // Present on disk so a wrong fall-through would actually resolve it.
      '/app/node_modules/effect/dist/internal/secret.js': 'export const leaked = true;',
    });
    expect(() =>
      loader.resolver.resolve('effect/internal/secret', { fromFile: '/app/main.mjs', esm: true }),
    ).toThrow(/PACKAGE_PATH_NOT_EXPORTED|not (defined|exported)/);
  });

  it('the most-specific wildcard wins when two patterns both match', () => {
    // `"./*/index": null` is more specific than `"./*"` for `foo/index`. Node
    // matches the longer-prefix/longer-suffix pattern first. Here the specific
    // pattern points at a REAL file (not null) so we can assert it actually wins,
    // independent of the null-block behaviour above.
    const loader = setup({
      '/app/main.mjs': "import * as m from 'pkg/feature/special'; export const v = m.x;",
      '/app/node_modules/pkg/package.json': JSON.stringify({
        type: 'module',
        // Generic `./*` listed FIRST so a first-match scan would wrongly pick it;
        // Node picks the more-specific `./*/special` regardless of order.
        exports: { './*': './dist/generic/*.js', './*/special': './dist/specific/*.js' },
      }),
      '/app/node_modules/pkg/dist/specific/feature.js': 'export const x = 9;',
      '/app/node_modules/pkg/dist/generic/feature/special.js': 'export const x = 0;',
    });
    const resolved = loader.resolver.resolve('pkg/feature/special', {
      fromFile: '/app/main.mjs',
      esm: true,
    });
    expect(resolved.id).toBe('/app/node_modules/pkg/dist/specific/feature.js');
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

  it('dynamic import() rejects symbol specifiers like Node', async () => {
    const loader = setup({
      '/main.mjs': "export const value = await import(Symbol('x'));",
    });
    await expect(loader.import('./main.mjs', '/entry.mjs')).rejects.toThrow(
      /Cannot convert a Symbol value to a string/,
    );
  });

  it('routes import() inside a runtime-built Function in ESM modules', async () => {
    const loader = setup({
      '/a.mjs': "export const v = 'runtime-function';",
      '/main.mjs':
        "const dyn = new Function('specifier', 'return import(specifier)'); export const value = (await dyn('./a.mjs')).v;",
    });
    const ns = await loader.import('./main.mjs', '/entry.mjs');
    expect(ns.value).toBe('runtime-function');
  });

  it('routes ESM import() despite helper-shaped local names', async () => {
    const loader = setup({
      '/a.mjs': "export const v = 'esm-helper-hygiene';",
      '/main.mjs': `
        const __import = () => Promise.resolve({ v: 'wrong' });
        export const value = (await import('./a.mjs')).v;
      `,
    });
    const ns = await loader.import('./main.mjs', '/entry.mjs');
    expect(ns.value).toBe('esm-helper-hygiene');
  });

  it('keeps import.meta isolated from helper-shaped local names', async () => {
    const loader = setup({
      '/main.mjs': `
        const import_meta = { url: 'wrong' };
        export const local = import_meta.url;
        export const meta = import.meta.url;
      `,
    });
    const ns = await loader.import('./main.mjs', '/entry.mjs');
    expect(ns.local).toBe('wrong');
    expect(ns.meta).toBe('file:///main.mjs');
  });

  it('exports correctly despite helper-shaped user bindings', async () => {
    const loader = setup({
      '/main.mjs': `
        export const __slots = { wrong: true };
        export const __rebuildExports = () => 'wrong';
        export const value = 1;
      `,
    });
    const ns = await loader.import('./main.mjs', '/entry.mjs');
    expect(ns.__slots).toEqual({ wrong: true });
    expect(typeof ns.__rebuildExports).toBe('function');
    expect(ns.value).toBe(1);
  });

  it('uses collision-free ESM namespace temp names', async () => {
    const loader = setup({
      '/a.mjs': "export const v = 'namespace-temp-hygiene';",
      '/main.mjs': `
        const __m0 = { v: 'wrong' };
        import { v } from './a.mjs';
        export const local = __m0.v;
        export const value = v;
      `,
    });
    const ns = await loader.import('./main.mjs', '/entry.mjs');
    expect(ns.local).toBe('wrong');
    expect(ns.value).toBe('namespace-temp-hygiene');
  });

  it('routes import() in runtime-built Function parameter initializers', async () => {
    const loader = setup({
      '/a.mjs': "export const v = 'runtime-function-param';",
      '/main.mjs': `
        const dyn = new Function('loaded = import("./a.mjs")', 'return loaded');
        export const value = (await dyn()).v;
      `,
    });
    const ns = await loader.import('./main.mjs', '/entry.mjs');
    expect(ns.value).toBe('runtime-function-param');
  });

  it('routes runtime-built Function import() despite helper-shaped local names', async () => {
    const loader = setup({
      '/a.mjs': "export const v = 'runtime-function-hygiene';",
      '/main.mjs': `
        const dyn = new Function(
          'specifier',
          'var __riftyDynamicImport = () => Promise.resolve({ v: "wrong" }); return import(specifier)',
        );
        export const value = (await dyn('./a.mjs')).v;
      `,
    });
    const ns = await loader.import('./main.mjs', '/entry.mjs');
    expect(ns.value).toBe('runtime-function-hygiene');
  });

  it('routes runtime-built Function import() when eval appears only as text in ESM', async () => {
    const loader = setup({
      '/a.mjs': "export const v = 'runtime-function-string-literal';",
      '/main.mjs': `
        const dyn = new Function(
          'specifier',
          'const note = "eval"; return import(specifier)',
        );
        export const value = (await dyn('./a.mjs')).v;
      `,
    });
    const ns = await loader.import('./main.mjs', '/entry.mjs');
    expect(ns.value).toBe('runtime-function-string-literal');
  });

  it('throws a directed ceiling when runtime-built Function creates a nested import Function in ESM', async () => {
    const loader = setup({
      '/a.mjs': "export const v = 'wrong-target';",
      '/main.mjs': `
        const outer = new Function('return Function("specifier", "return import(specifier)")');
        const dyn = outer();
        export const value = (await dyn('./a.mjs')).v;
      `,
    });
    await expect(loader.import('./main.mjs', '/entry.mjs')).rejects.toMatchObject({
      name: 'NotImplementedError',
      feature: 'module-loader.function-constructor-dynamic-scope',
    });
  });

  it('throws a directed ceiling when runtime-built Function creates a split-string nested import Function in ESM', async () => {
    const loader = setup({
      '/a.mjs': "export const v = 'wrong-target';",
      '/main.mjs': `
        const outer = new Function('return Function("specifier", "return " + "im" + "port(specifier)")');
        const dyn = outer();
        export const value = (await dyn('./a.mjs')).v;
      `,
    });
    await expect(loader.import('./main.mjs', '/entry.mjs')).rejects.toMatchObject({
      name: 'NotImplementedError',
      feature: 'module-loader.function-constructor-dynamic-scope',
    });
  });

  it('throws a directed ceiling when runtime-built Function invokes nested Function through Reflect in ESM', async () => {
    const applyLoader = setup({
      '/a.mjs': "export const v = 'wrong-target';",
      '/main.mjs': `
        const outer = new Function('return Reflect.apply(Function, undefined, ["specifier", "return import(specifier)"])');
        const dyn = outer();
        export const value = (await dyn('./a.mjs')).v;
      `,
    });
    await expect(applyLoader.import('./main.mjs', '/entry.mjs')).rejects.toMatchObject({
      name: 'NotImplementedError',
      feature: 'module-loader.function-constructor-dynamic-scope',
    });

    const constructLoader = setup({
      '/a.mjs': "export const v = 'wrong-target';",
      '/main.mjs': `
        const outer = new Function('return Reflect.construct(Function, ["specifier", "return import(specifier)"])');
        const dyn = outer();
        export const value = (await dyn('./a.mjs')).v;
      `,
    });
    await expect(constructLoader.import('./main.mjs', '/entry.mjs')).rejects.toMatchObject({
      name: 'NotImplementedError',
      feature: 'module-loader.function-constructor-dynamic-scope',
    });
  });

  it('throws a directed ceiling when runtime-built Function invokes nested Function through aliased Reflect in ESM', async () => {
    const applyLoader = setup({
      '/a.mjs': "export const v = 'wrong-target';",
      '/main.mjs': `
        const outer = new Function('return (() => { const R = Reflect; return R.apply(Function, undefined, ["specifier", "return import(specifier)"]); })()');
        const dyn = outer();
        export const value = (await dyn('./a.mjs')).v;
      `,
    });
    await expect(applyLoader.import('./main.mjs', '/entry.mjs')).rejects.toMatchObject({
      name: 'NotImplementedError',
      feature: 'module-loader.function-constructor-dynamic-scope',
    });

    const constructLoader = setup({
      '/a.mjs': "export const v = 'wrong-target';",
      '/main.mjs': `
        const outer = new Function('return (() => { const R = Reflect; return R.construct(Function, ["specifier", "return import(specifier)"]); })()');
        const dyn = outer();
        export const value = (await dyn('./a.mjs')).v;
      `,
    });
    await expect(constructLoader.import('./main.mjs', '/entry.mjs')).rejects.toMatchObject({
      name: 'NotImplementedError',
      feature: 'module-loader.function-constructor-dynamic-scope',
    });
  });

  it('throws a directed ceiling when runtime-built Function invokes nested Function through extracted Reflect methods in ESM', async () => {
    const applyLoader = setup({
      '/a.mjs': "export const v = 'wrong-target';",
      '/main.mjs': `
        const outer = new Function('return (() => { const apply = Reflect.apply; return apply(Function, undefined, ["specifier", "return import(specifier)"]); })()');
        const dyn = outer();
        export const value = (await dyn('./a.mjs')).v;
      `,
    });
    await expect(applyLoader.import('./main.mjs', '/entry.mjs')).rejects.toMatchObject({
      name: 'NotImplementedError',
      feature: 'module-loader.function-constructor-dynamic-scope',
    });

    const constructLoader = setup({
      '/a.mjs': "export const v = 'wrong-target';",
      '/main.mjs': `
        const outer = new Function('return (() => { const { construct } = Reflect; return construct(Function, ["specifier", "return import(specifier)"]); })()');
        const dyn = outer();
        export const value = (await dyn('./a.mjs')).v;
      `,
    });
    await expect(constructLoader.import('./main.mjs', '/entry.mjs')).rejects.toMatchObject({
      name: 'NotImplementedError',
      feature: 'module-loader.function-constructor-dynamic-scope',
    });
  });

  it('throws a directed ceiling when runtime-built Function invokes nested Function through extracted Reflect methods in ESM', async () => {
    const applyLoader = setup({
      '/a.mjs': "export const v = 'wrong-target';",
      '/main.mjs': `
        const outer = new Function('return (() => { const { apply } = Reflect; return apply(Function, undefined, ["specifier", "return import(specifier)"]); })()');
        const dyn = outer();
        export const value = (await dyn('./a.mjs')).v;
      `,
    });
    await expect(applyLoader.import('./main.mjs', '/entry.mjs')).rejects.toMatchObject({
      name: 'NotImplementedError',
      feature: 'module-loader.function-constructor-dynamic-scope',
    });

    const constructLoader = setup({
      '/a.mjs': "export const v = 'wrong-target';",
      '/main.mjs': `
        const outer = new Function('return (() => { const { construct } = Reflect; return construct(Function, ["specifier", "return import(specifier)"]); })()');
        const dyn = outer();
        export const value = (await dyn('./a.mjs')).v;
      `,
    });
    await expect(constructLoader.import('./main.mjs', '/entry.mjs')).rejects.toMatchObject({
      name: 'NotImplementedError',
      feature: 'module-loader.function-constructor-dynamic-scope',
    });
  });

  it('throws a directed ceiling when runtime-built Function source invokes nested Function through aliased Reflect in ESM', async () => {
    const loader = setup({
      '/a.mjs': "export const v = 'wrong-target';",
      '/main.mjs': `
        const outer = new Function('return Function("return (() => { const R = Reflect; return R.apply(Function, undefined, [\\\\\\"specifier\\\\\\", \\\\\\"return import(specifier)\\\\\\"]); })()")');
        const maker = outer();
        const dyn = maker();
        export const value = (await dyn('./a.mjs')).v;
      `,
    });
    await expect(loader.import('./main.mjs', '/entry.mjs')).rejects.toMatchObject({
      name: 'NotImplementedError',
      feature: 'module-loader.function-constructor-dynamic-scope',
    });
  });

  it('throws a directed ceiling when runtime-built Function source invokes nested Function through extracted Reflect methods in ESM', async () => {
    const loader = setup({
      '/a.mjs': "export const v = 'wrong-target';",
      '/main.mjs': `
        const outer = new Function('return Function("return (() => { const { apply } = Reflect; return apply(Function, undefined, [\\\\\\"specifier\\\\\\", \\\\\\"return import(specifier)\\\\\\"]); })()")');
        const maker = outer();
        const dyn = maker();
        export const value = (await dyn('./a.mjs')).v;
      `,
    });
    await expect(loader.import('./main.mjs', '/entry.mjs')).rejects.toMatchObject({
      name: 'NotImplementedError',
      feature: 'module-loader.function-constructor-dynamic-scope',
    });
  });

  it('throws a directed ceiling when runtime-built Function invokes nested Function through call/apply/bind in ESM', async () => {
    for (const source of [
      'return Function.call(undefined, "specifier", "return import(specifier)")',
      'return Function.apply(undefined, ["specifier", "return import(specifier)"])',
      'return Function.bind(undefined, "specifier", "return import(specifier)")()',
    ]) {
      const loader = setup({
        '/a.mjs': "export const v = 'wrong-target';",
        '/main.mjs': `
          const outer = new Function(${JSON.stringify(source)});
          const dyn = outer();
          export const value = (await dyn('./a.mjs')).v;
        `,
      });
      await expect(loader.import('./main.mjs', '/entry.mjs')).rejects.toMatchObject({
        name: 'NotImplementedError',
        feature: 'module-loader.function-constructor-dynamic-scope',
      });
    }
  });

  it('throws a directed ceiling when runtime-built Function reaches nested Function through a computed global key in ESM', async () => {
    const loader = setup({
      '/a.mjs': "export const v = 'wrong-target';",
      '/main.mjs': `
        const outer = new Function('return globalThis["Fun".concat("ction")]("specifier", "return import(specifier)")');
        const dyn = outer();
        export const value = (await dyn('./a.mjs')).v;
      `,
    });
    await expect(loader.import('./main.mjs', '/entry.mjs')).rejects.toMatchObject({
      name: 'NotImplementedError',
      feature: 'module-loader.function-constructor-dynamic-scope',
    });
  });

  it('throws a directed ceiling when runtime-built Function reaches nested Function through Reflect.get(globalThis) in ESM', async () => {
    const loader = setup({
      '/a.mjs': "export const v = 'wrong-target';",
      '/main.mjs': `
        const outer = new Function('return Reflect.get(globalThis, "Function")("specifier", "return import(specifier)")');
        const dyn = outer();
        export const value = (await dyn('./a.mjs')).v;
      `,
    });
    await expect(loader.import('./main.mjs', '/entry.mjs')).rejects.toMatchObject({
      name: 'NotImplementedError',
      feature: 'module-loader.function-constructor-dynamic-scope',
    });
  });

  it('throws a directed ceiling when runtime-built Function reaches nested Function through aliased Reflect.get in ESM', async () => {
    const loader = setup({
      '/a.mjs': "export const v = 'wrong-target';",
      '/main.mjs': `
        const outer = new Function(\`
          const get = Reflect.get;
          const F = get(globalThis, "Function");
          return F("specifier", "return import(specifier)");
        \`);
        const dyn = outer();
        export const value = (await dyn('./a.mjs')).v;
      `,
    });
    await expect(loader.import('./main.mjs', '/entry.mjs')).rejects.toMatchObject({
      name: 'NotImplementedError',
      feature: 'module-loader.function-constructor-dynamic-scope',
    });
  });

  it('throws a directed ceiling when runtime-built Function reaches eval through a computed global key in ESM', async () => {
    const loader = setup({
      '/a.mjs': "export const v = 'wrong-target';",
      '/main.mjs': `
        const dyn = new Function(\`return globalThis["ev".concat("al")]("import('./a.mjs')")\`);
        export const value = await dyn();
      `,
    });
    await expect(loader.import('./main.mjs', '/entry.mjs')).rejects.toMatchObject({
      name: 'NotImplementedError',
      feature: 'module-loader.function-constructor-dynamic-scope',
    });
  });

  it('throws a directed ceiling when runtime-built Function reaches eval through Reflect.get(globalThis) in ESM', async () => {
    const loader = setup({
      '/a.mjs': "export const v = 'wrong-target';",
      '/main.mjs': `
        const dyn = new Function(\`return Reflect.get(globalThis, "eval")("import('./a.mjs')")\`);
        export const value = await dyn();
      `,
    });
    await expect(loader.import('./main.mjs', '/entry.mjs')).rejects.toMatchObject({
      name: 'NotImplementedError',
      feature: 'module-loader.function-constructor-dynamic-scope',
    });
  });

  it('throws a directed ceiling when runtime-built Function reaches eval through aliased Reflect.get in ESM', async () => {
    const loader = setup({
      '/a.mjs': "export const v = 'wrong-target';",
      '/main.mjs': `
        const dyn = new Function(\`
          const get = Reflect.get;
          const run = get(globalThis, "eval");
          return run("import('./a.mjs')");
        \`);
        export const value = await dyn();
      `,
    });
    await expect(loader.import('./main.mjs', '/entry.mjs')).rejects.toMatchObject({
      name: 'NotImplementedError',
      feature: 'module-loader.function-constructor-dynamic-scope',
    });
  });

  it('throws a directed ceiling when runtime-built Function derives a nested host constructor in ESM', async () => {
    const loader = setup({
      '/a.mjs': "export const v = 'wrong-target';",
      '/main.mjs': `
        const outer = new Function('return (() => {}).constructor("specifier", "return import(specifier)")');
        const dyn = outer();
        export const value = (await dyn('./a.mjs')).v;
      `,
    });
    await expect(loader.import('./main.mjs', '/entry.mjs')).rejects.toMatchObject({
      name: 'NotImplementedError',
      feature: 'module-loader.function-constructor-derived-host',
    });
  });

  it('throws a directed ceiling when ESM object defaults alias a derived host constructor', async () => {
    const loader = setup({
      '/a.mjs': "export const v = 'wrong-target';",
      '/main.mjs': `
        const { F = Function.prototype.constructor } = {};
        export const value = (await F("return import('./a.mjs')")()).v;
      `,
    });
    await expect(loader.import('./main.mjs', '/entry.mjs')).rejects.toMatchObject({
      name: 'NotImplementedError',
      feature: 'module-loader.function-constructor-derived-host',
    });
  });

  it('does not reject ESM modules merely defining a Vite-shaped dynamic AsyncFunction evaluator', async () => {
    const loader = setup({
      '/main.mjs': `
        const AsyncFunction = async function() {}.constructor;
        export function compile(result) {
          return new AsyncFunction("ssrImport", '"use strict";' + result.code);
        }
        export const loaded = true;
      `,
    });
    const ns = await loader.import('./main.mjs', '/entry.mjs');
    expect(ns.loaded).toBe(true);
  });

  it('does not reject ESM modules merely combining a Vite-shaped evaluator with dynamic eval', async () => {
    const loader = setup({
      '/main.mjs': `
        const AsyncFunction = async function() {}.constructor;
        export function compile(result) {
          return new AsyncFunction("ssrImport", '"use strict";' + result.code);
        }
        export function parse(value) {
          try {
            return (0, eval)(value);
          } catch {
            return undefined;
          }
        }
        export const loaded = true;
      `,
    });
    const ns = await loader.import('./main.mjs', '/entry.mjs');
    expect(ns.loaded).toBe(true);
  });

  it('does not reject ESM modules merely combining lexical Function with unrelated dynamic eval', async () => {
    const loader = setup({
      '/main.mjs': `
        export function evalValue(rawValue) {
          const fn = new Function("return (" + rawValue + ")");
          return fn();
        }
        export function parse(value) {
          try {
            return (0, eval)(value);
          } catch {
            return undefined;
          }
        }
        export const loaded = true;
      `,
    });
    const ns = await loader.import('./main.mjs', '/entry.mjs');
    expect(ns.loaded).toBe(true);
  });

  it('throws a directed ceiling when runtime-built Function recovers a host constructor from an Object descriptor in ESM', async () => {
    const loader = setup({
      '/a.mjs': "export const v = 'wrong-target';",
      '/main.mjs': `
        const outer = new Function('return Object.getOwnPropertyDescriptor(Function.prototype, "constructor").value("specifier", "return import(specifier)")');
        const dyn = outer();
        export const value = (await dyn('./a.mjs')).v;
      `,
    });
    await expect(loader.import('./main.mjs', '/entry.mjs')).rejects.toMatchObject({
      name: 'NotImplementedError',
      feature: 'module-loader.function-constructor-derived-host',
    });
  });

  it('throws a directed ceiling when runtime-built Function aliases a host constructor Object descriptor in ESM', async () => {
    const loader = setup({
      '/a.mjs': "export const v = 'wrong-target';",
      '/main.mjs': `
        const outer = new Function(\`
          const O = Object;
          const { value: F } = O.getOwnPropertyDescriptor(Function.prototype, "constructor");
          return F("specifier", "return import(specifier)");
        \`);
        const dyn = outer();
        export const value = (await dyn('./a.mjs')).v;
      `,
    });
    await expect(loader.import('./main.mjs', '/entry.mjs')).rejects.toMatchObject({
      name: 'NotImplementedError',
      feature: 'module-loader.function-constructor-derived-host',
    });
  });

  it('throws a directed ceiling when runtime-built Function recovers a host constructor from a Reflect descriptor in ESM', async () => {
    const loader = setup({
      '/a.mjs': "export const v = 'wrong-target';",
      '/main.mjs': `
        const outer = new Function(\`
          const getOwnPropertyDescriptor = Reflect.getOwnPropertyDescriptor;
          const F = getOwnPropertyDescriptor(Function.prototype, "constructor").value;
          return F("specifier", "return import(specifier)");
        \`);
        const dyn = outer();
        export const value = (await dyn('./a.mjs')).v;
      `,
    });
    await expect(loader.import('./main.mjs', '/entry.mjs')).rejects.toMatchObject({
      name: 'NotImplementedError',
      feature: 'module-loader.function-constructor-derived-host',
    });
  });

  it('throws a directed ceiling when runtime-built Function recovers a host constructor from an Object descriptor map in ESM', async () => {
    const loader = setup({
      '/a.mjs': "export const v = 'wrong-target';",
      '/main.mjs': `
        const outer = new Function('return Object.getOwnPropertyDescriptors(Function.prototype).constructor.value("specifier", "return import(specifier)")');
        const dyn = outer();
        export const value = (await dyn('./a.mjs')).v;
      `,
    });
    await expect(loader.import('./main.mjs', '/entry.mjs')).rejects.toMatchObject({
      name: 'NotImplementedError',
      feature: 'module-loader.function-constructor-derived-host',
    });
  });

  it('throws a directed ceiling when runtime-built Function aliases a host constructor Object descriptor map in ESM', async () => {
    const loader = setup({
      '/a.mjs': "export const v = 'wrong-target';",
      '/main.mjs': `
        const outer = new Function(\`
          const descriptors = Object.getOwnPropertyDescriptors(Function.prototype);
          const F = descriptors.constructor.value;
          return F("specifier", "return import(specifier)");
        \`);
        const dyn = outer();
        export const value = (await dyn('./a.mjs')).v;
      `,
    });
    await expect(loader.import('./main.mjs', '/entry.mjs')).rejects.toMatchObject({
      name: 'NotImplementedError',
      feature: 'module-loader.function-constructor-derived-host',
    });
  });

  it('throws a directed ceiling when runtime-built Function enumerates a host constructor descriptor map in ESM', async () => {
    const loader = setup({
      '/a.mjs': "export const v = 'wrong-target';",
      '/main.mjs': `
        const outer = new Function(\`
          const F = Object.values(Object.getOwnPropertyDescriptors(Function.prototype))
            .find((descriptor) => descriptor.value && descriptor.value.name === "Function")
            .value;
          return F("specifier", "return import(specifier)");
        \`);
        const dyn = outer();
        export const value = (await dyn('./a.mjs')).v;
      `,
    });
    await expect(loader.import('./main.mjs', '/entry.mjs')).rejects.toMatchObject({
      name: 'NotImplementedError',
      feature: 'module-loader.function-constructor-derived-host',
    });
  });

  it('throws a directed ceiling when runtime-built Function derives a split-string nested host constructor in ESM', async () => {
    const loader = setup({
      '/a.mjs': "export const v = 'wrong-target';",
      '/main.mjs': `
        const outer = new Function('return (() => {}).constructor("specifier", "return " + "im" + "port(specifier)")');
        const dyn = outer();
        export const value = (await dyn('./a.mjs')).v;
      `,
    });
    await expect(loader.import('./main.mjs', '/entry.mjs')).rejects.toMatchObject({
      name: 'NotImplementedError',
      feature: 'module-loader.function-constructor-derived-host',
    });
  });

  it('throws a directed ceiling when runtime-built Function derives a computed nested host constructor in ESM', async () => {
    const loader = setup({
      '/a.mjs': "export const v = 'wrong-target';",
      '/main.mjs': `
        const outer = new Function('return (() => {})["con".concat("structor")]("specifier", "return import(specifier)")');
        const dyn = outer();
        export const value = (await dyn('./a.mjs')).v;
      `,
    });
    await expect(loader.import('./main.mjs', '/entry.mjs')).rejects.toMatchObject({
      name: 'NotImplementedError',
      feature: 'module-loader.function-constructor-derived-host',
    });
  });

  it('throws a directed ceiling when runtime-built Function object defaults alias nested Function in ESM', async () => {
    const loader = setup({
      '/a.mjs': "export const v = 'wrong-target';",
      '/main.mjs': `
        const outer = new Function(\`
          const { F = Function } = {};
          return F("specifier", "return import(specifier)");
        \`);
        const dyn = outer();
        export const value = (await dyn('./a.mjs')).v;
      `,
    });
    await expect(loader.import('./main.mjs', '/entry.mjs')).rejects.toMatchObject({
      name: 'NotImplementedError',
      feature: 'module-loader.function-constructor-dynamic-scope',
    });
  });

  it('preserves native SyntaxError for runtime-built Function bodies without import() in ESM', async () => {
    const loader = setup({
      '/main.mjs': `
        let caught;
        try {
          new Function('return }');
        } catch (err) {
          caught = err;
        }
        export const name = caught?.name;
        export const isSyntaxError = caught instanceof SyntaxError;
      `,
    });
    const ns = await loader.import('./main.mjs', '/entry.mjs');
    expect(ns.name).toBe('SyntaxError');
    expect(ns.isSyntaxError).toBe(true);
  });

  it('preserves native SyntaxError for invalid runtime-built Function bodies with constructor text but no import() in ESM', async () => {
    const loader = setup({
      '/main.mjs': `
        let caught;
        try {
          new Function('const constructor =');
        } catch (err) {
          caught = err;
        }
        export const name = caught?.name;
        export const isSyntaxError = caught instanceof SyntaxError;
      `,
    });
    const ns = await loader.import('./main.mjs', '/entry.mjs');
    expect(ns.name).toBe('SyntaxError');
    expect(ns.isSyntaxError).toBe(true);
  });

  it('throws a directed ceiling when runtime-built Function import() uses with dynamic scope in ESM', async () => {
    const loader = setup({
      '/a.mjs': "export const v = 'wrong-target';",
      '/main.mjs': `
        const dyn = new Function('specifier', \`
          const n = "__rifty" + "DynamicImport";
          with ({ [n]: () => Promise.resolve({ v: "wrong" }) }) {
            return import(specifier);
          }
        \`);
        export const value = (await dyn('./a.mjs')).v;
      `,
    });
    await expect(loader.import('./main.mjs', '/entry.mjs')).rejects.toMatchObject({
      name: 'NotImplementedError',
      feature: 'module-loader.function-constructor-dynamic-scope',
    });
  });

  it('throws a directed ceiling when runtime-built Function import() hides behind eval in ESM', async () => {
    const loader = setup({
      '/a.mjs': "export const v = 'wrong-target';",
      '/main.mjs': `
        const dyn = new Function('specifier', 'return eval("import(specifier)")');
        export const value = (await dyn('./a.mjs')).v;
      `,
    });
    await expect(loader.import('./main.mjs', '/entry.mjs')).rejects.toMatchObject({
      name: 'NotImplementedError',
      feature: 'module-loader.function-constructor-dynamic-scope',
    });
  });

  it('throws a directed ceiling when ESM eval text contains import()', async () => {
    const loader = setup({
      '/a.mjs': "export const v = 'wrong-target';",
      '/main.mjs': 'export const value = (await eval("import(\'./a.mjs\')")).v;',
    });
    await expect(loader.import('./main.mjs', '/entry.mjs')).rejects.toMatchObject({
      name: 'NotImplementedError',
      feature: 'module-loader.esm-dynamic-function-scope',
    });
  });

  it('throws a directed ceiling when runtime-built Function eval synthesizes import in ESM', async () => {
    const loader = setup({
      '/a.mjs': "export const v = 'wrong-target';",
      '/main.mjs': `
        const dyn = new Function('specifier', 'return eval("im" + "port(specifier)")');
        export const value = (await dyn('./a.mjs')).v;
      `,
    });
    await expect(loader.import('./main.mjs', '/entry.mjs')).rejects.toMatchObject({
      name: 'NotImplementedError',
      feature: 'module-loader.function-constructor-dynamic-scope',
    });
  });

  it('throws a directed ceiling when runtime-built Function aliases eval before import in ESM', async () => {
    const loader = setup({
      '/a.mjs': "export const v = 'wrong-target';",
      '/main.mjs': `
        const dyn = new Function('specifier', 'const e = eval; return e("import(specifier)")');
        export const value = (await dyn('./a.mjs')).v;
      `,
    });
    await expect(loader.import('./main.mjs', '/entry.mjs')).rejects.toMatchObject({
      name: 'NotImplementedError',
      feature: 'module-loader.function-constructor-dynamic-scope',
    });
  });

  it('throws a directed ceiling when runtime-built Function aliases indirect eval before import in ESM', async () => {
    const loader = setup({
      '/a.mjs': "export const v = 'wrong-target';",
      '/main.mjs': `
        const dyn = new Function('specifier', 'const e = (0, eval); return e("import(specifier)")');
        export const value = (await dyn('./a.mjs')).v;
      `,
    });
    await expect(loader.import('./main.mjs', '/entry.mjs')).rejects.toMatchObject({
      name: 'NotImplementedError',
      feature: 'module-loader.function-constructor-dynamic-scope',
    });
  });

  it('throws a directed ceiling when runtime-built Function destructures eval before import in ESM', async () => {
    const loader = setup({
      '/a.mjs': "export const v = 'wrong-target';",
      '/main.mjs': `
        const dyn = new Function('specifier', 'const { eval: e } = globalThis; return e("import(specifier)")');
        export const value = (await dyn('./a.mjs')).v;
      `,
    });
    await expect(loader.import('./main.mjs', '/entry.mjs')).rejects.toMatchObject({
      name: 'NotImplementedError',
      feature: 'module-loader.function-constructor-dynamic-scope',
    });
  });

  it('throws a directed ceiling when runtime-built Function destructures computed eval before import in ESM', async () => {
    const loader = setup({
      '/a.mjs': "export const v = 'wrong-target';",
      '/main.mjs': `
        const dyn = new Function('specifier', 'const { ["ev" + "al"]: e } = globalThis; return e("import(specifier)")');
        export const value = (await dyn('./a.mjs')).v;
      `,
    });
    await expect(loader.import('./main.mjs', '/entry.mjs')).rejects.toMatchObject({
      name: 'NotImplementedError',
      feature: 'module-loader.function-constructor-dynamic-scope',
    });
  });

  it('throws a directed ceiling when runtime-built Function array-destructures eval before import in ESM', async () => {
    const loader = setup({
      '/a.mjs': "export const v = 'wrong-target';",
      '/main.mjs': `
        const dyn = new Function('specifier', 'const [e] = [eval]; return e("im" + "port(specifier)")');
        export const value = (await dyn('./a.mjs')).v;
      `,
    });
    await expect(loader.import('./main.mjs', '/entry.mjs')).rejects.toMatchObject({
      name: 'NotImplementedError',
      feature: 'module-loader.function-constructor-dynamic-scope',
    });
  });

  it('throws a directed ceiling when runtime-built Function aliases eval through object literals in ESM', async () => {
    const loader = setup({
      '/a.mjs': "export const v = 'wrong-target';",
      '/main.mjs': `
        const dyn = new Function('specifier', 'const { x: e } = { x: eval }; return e("im" + "port(specifier)")');
        export const value = (await dyn('./a.mjs')).v;
      `,
    });
    await expect(loader.import('./main.mjs', '/entry.mjs')).rejects.toMatchObject({
      name: 'NotImplementedError',
      feature: 'module-loader.function-constructor-dynamic-scope',
    });
  });

  it('throws a directed ceiling for ESM imports routed through derived host Function constructors', async () => {
    const loader = setup({
      '/a.mjs': "export const v = 'wrong-target';",
      '/main.mjs': `
        const F = (() => {}).constructor;
        const dyn = F('specifier', 'return import(specifier)');
        export const value = (await dyn('./a.mjs')).v;
      `,
    });
    await expect(loader.import('./main.mjs', '/entry.mjs')).rejects.toMatchObject({
      name: 'NotImplementedError',
      feature: 'module-loader.function-constructor-derived-host',
    });
  });

  it('throws a directed ceiling for optional-chained ESM derived host Function constructors', async () => {
    const loader = setup({
      '/a.mjs': "export const v = 'wrong-target';",
      '/main.mjs': `
        const F = (() => {})?.constructor;
        const dyn = F('specifier', 'return import(specifier)');
        export const value = (await dyn('./a.mjs')).v;
      `,
    });
    await expect(loader.import('./main.mjs', '/entry.mjs')).rejects.toMatchObject({
      name: 'NotImplementedError',
      feature: 'module-loader.function-constructor-derived-host',
    });
  });

  it('throws a directed ceiling for destructured ESM derived host Function constructors', async () => {
    const loader = setup({
      '/a.mjs': "export const v = 'wrong-target';",
      '/main.mjs': `
        const { constructor: F } = (() => {});
        const dyn = F('specifier', 'return import(specifier)');
        export const value = (await dyn('./a.mjs')).v;
      `,
    });
    await expect(loader.import('./main.mjs', '/entry.mjs')).rejects.toMatchObject({
      name: 'NotImplementedError',
      feature: 'module-loader.function-constructor-derived-host',
    });
  });

  it('throws a directed ceiling for sequence-wrapped ESM derived host Function constructors', async () => {
    const loader = setup({
      '/a.mjs': "export const v = 'wrong-target';",
      '/main.mjs': `
        const dyn = (0, (() => {}).constructor)('specifier', 'return import(specifier)');
        export const value = (await dyn('./a.mjs')).v;
      `,
    });
    await expect(loader.import('./main.mjs', '/entry.mjs')).rejects.toMatchObject({
      name: 'NotImplementedError',
      feature: 'module-loader.function-constructor-derived-host',
    });
  });

  it('throws a directed ceiling for Reflect.get ESM derived host Function constructors', async () => {
    const loader = setup({
      '/a.mjs': "export const v = 'wrong-target';",
      '/main.mjs': `
        const F = Reflect.get(Function.prototype, "constructor");
        const dyn = F('specifier', 'return import(specifier)');
        export const value = (await dyn('./a.mjs')).v;
      `,
    });
    await expect(loader.import('./main.mjs', '/entry.mjs')).rejects.toMatchObject({
      name: 'NotImplementedError',
      feature: 'module-loader.function-constructor-derived-host',
    });
  });

  it('throws a directed ceiling for array-destructured ESM derived host Function constructors', async () => {
    const loader = setup({
      '/a.mjs': "export const v = 'wrong-target';",
      '/main.mjs': `
        const [F] = [(() => {}).constructor];
        const dyn = F('specifier', 'return import(specifier)');
        export const value = (await dyn('./a.mjs')).v;
      `,
    });
    await expect(loader.import('./main.mjs', '/entry.mjs')).rejects.toMatchObject({
      name: 'NotImplementedError',
      feature: 'module-loader.function-constructor-derived-host',
    });
  });

  it('throws a directed ceiling for Reflect-invoked ESM derived host Function constructors', async () => {
    const applyLoader = setup({
      '/a.mjs': "export const v = 'wrong-target';",
      '/main.mjs': `
        const dyn = Reflect.apply((() => {}).constructor, undefined, [
          'specifier',
          'return import(specifier)',
        ]);
        export const value = (await dyn('./a.mjs')).v;
      `,
    });
    await expect(applyLoader.import('./main.mjs', '/entry.mjs')).rejects.toMatchObject({
      name: 'NotImplementedError',
      feature: 'module-loader.function-constructor-derived-host',
    });

    const constructLoader = setup({
      '/a.mjs': "export const v = 'wrong-target';",
      '/main.mjs': `
        const dyn = Reflect.construct((() => {}).constructor, [
          'specifier',
          'return import(specifier)',
        ]);
        export const value = (await dyn('./a.mjs')).v;
      `,
    });
    await expect(constructLoader.import('./main.mjs', '/entry.mjs')).rejects.toMatchObject({
      name: 'NotImplementedError',
      feature: 'module-loader.function-constructor-derived-host',
    });
  });

  it('routes import() with comments before parens inside ESM and runtime-built Function', async () => {
    const loader = setup({
      '/a.mjs': "export const v = 'comment-import';",
      '/main.mjs': `
        const dyn = new Function('specifier', 'return import/*function-comment*/(specifier)');
        export const direct = (await import/*direct-comment*/('./a.mjs')).v;
        export const viaFunction = (await dyn('./a.mjs')).v;
      `,
    });
    const ns = await loader.import('./main.mjs', '/entry.mjs');
    expect(ns.direct).toBe('comment-import');
    expect(ns.viaFunction).toBe('comment-import');
  });

  it('keeps the routed lexical Function constructor observably Function-shaped', async () => {
    const loader = setup({
      '/a.mjs': "export const v = 'runtime-function-shape';",
      '/main.mjs': `
        const plain = new Function('return 1');
        const dyn = new Function('specifier', 'return import(specifier)');
        export const shape = {
          name: Function.name,
          length: Function.length,
          constructorPrototype: Object.getPrototypeOf(Function) === Function.prototype,
          plainInstance: plain instanceof Function,
          plainPrototype: Object.getPrototypeOf(plain) === Function.prototype,
          dynInstance: dyn instanceof Function,
          dynPrototype: Object.getPrototypeOf(dyn) === Function.prototype,
          value: (await dyn('./a.mjs')).v,
        };
      `,
    });
    const ns = await loader.import('./main.mjs', '/entry.mjs');
    expect(ns.shape).toEqual({
      name: 'Function',
      length: 1,
      constructorPrototype: true,
      plainInstance: true,
      plainPrototype: true,
      dynInstance: true,
      dynPrototype: true,
      value: 'runtime-function-shape',
    });
  });

  it('does not introduce non-Node async/generator constructor globals in ESM modules', async () => {
    const loader = setup({
      '/main.mjs': `
        export const asyncType = typeof AsyncFunction;
        export const generatorType = typeof GeneratorFunction;
        export const asyncGeneratorType = typeof AsyncGeneratorFunction;
      `,
    });
    const ns = await loader.import('./main.mjs', '/entry.mjs');
    expect(ns).toMatchObject({
      asyncType: 'undefined',
      generatorType: 'undefined',
      asyncGeneratorType: 'undefined',
    });
  });

  it('throws a directed ceiling for ESM modules mutating or dynamically shadowing Function', async () => {
    const cases: Record<string, { feature: string; source: string }> = {
      '/assign.mjs': {
        feature: 'module-loader.esm-global-function-assignment',
        source: `
          Function = function LocalFunction() {};
          export const name = Function.name;
        `,
      },
      '/global-this.mjs': {
        feature: 'module-loader.esm-global-function-assignment',
        source: `
          globalThis.Function = function GlobalThisFunction() {};
          export const name = Function.name;
        `,
      },
      '/global-computed.mjs': {
        feature: 'module-loader.esm-global-function-assignment',
        source: `
          globalThis["Function"] = function GlobalComputedFunction() {};
          export const name = Function.name;
        `,
      },
      '/global-computed-expression.mjs': {
        feature: 'module-loader.esm-global-function-assignment',
        source: `
          globalThis["Fun" + "ction"] = function GlobalComputedExpressionFunction() {};
          export const name = Function.name;
        `,
      },
      '/global-computed-expression-no-function-token.mjs': {
        feature: 'module-loader.esm-global-function-assignment',
        source: `
          globalThis["Fun" + "ction"] = globalThis["Fun" + "ction"];
          export const done = true;
        `,
      },
      '/global-computed-read-no-function-token.mjs': {
        feature: 'module-loader.esm-global-function-assignment',
        source: `
          const F = globalThis["Fun" + "ction"];
          export const name = F.name;
        `,
      },
      '/global-computed-dynamic-read-no-function-token.mjs': {
        feature: 'module-loader.esm-global-function-assignment',
        source: `
          const suffix = "ction";
          const F = globalThis["Fun" + suffix];
          export const value = F("return 1")();
        `,
      },
      '/global-computed-dynamic-write-no-function-token.mjs': {
        feature: 'module-loader.esm-global-function-assignment',
        source: `
          const suffix = "ction";
          globalThis["Fun" + suffix] = globalThis["Fun" + suffix];
          export const done = true;
        `,
      },
      '/delete-global.mjs': {
        feature: 'module-loader.esm-global-function-assignment',
        source: `
          delete globalThis.Function;
          export const name = Function.name;
        `,
      },
      '/define-property.mjs': {
        feature: 'module-loader.esm-global-function-assignment',
        source: `
          Object.defineProperty(globalThis, "Function", { value: function RedefinedFunction() {} });
          export const name = Function.name;
        `,
      },
      '/define-properties.mjs': {
        feature: 'module-loader.esm-global-function-assignment',
        source: `
          Object.defineProperties(globalThis, { Function: { value: function RedefinedFunction() {} } });
          export const name = Function.name;
        `,
      },
      '/reflect-set.mjs': {
        feature: 'module-loader.esm-global-function-assignment',
        source: `
          Reflect.set(globalThis, "Function", function ReflectSetFunction() {});
          export const name = Function.name;
        `,
      },
      '/reflect-delete.mjs': {
        feature: 'module-loader.esm-global-function-assignment',
        source: `
          Reflect.deleteProperty(globalThis, "Function");
          export const name = Function.name;
        `,
      },
      '/reflect-get-constructor.mjs': {
        feature: 'module-loader.esm-global-function-assignment',
        source: `
          const F = Reflect.get(globalThis, "Function");
          const dyn = F("return 1");
          export const value = dyn();
        `,
      },
      '/object-assign.mjs': {
        feature: 'module-loader.esm-global-function-assignment',
        source: `
          Object.assign(globalThis, { Function: function AssignedFunction() {} });
          export const name = Function.name;
        `,
      },
      '/object-assign-dynamic.mjs': {
        feature: 'module-loader.esm-global-function-assignment',
        source: `
          const patch = { Function: function AssignedDynamicFunction() {} };
          Object.assign(globalThis, patch);
          export const name = Function.name;
        `,
      },
      '/define-getter.mjs': {
        feature: 'module-loader.esm-global-function-assignment',
        source: `
          globalThis.__defineGetter__("Function", () => function GetterFunction() {});
          export const name = Function.name;
        `,
      },
      '/global-alias.mjs': {
        feature: 'module-loader.esm-global-function-assignment',
        source: `
          const g = globalThis;
          g.Function = function AliasFunction() {};
          export const name = Function.name;
        `,
      },
      '/global-destructured-alias.mjs': {
        feature: 'module-loader.esm-global-function-assignment',
        source: `
          let g;
          ({ g } = { g: globalThis });
          g.Function = g.Function;
          export const done = true;
        `,
      },
      '/global-destructured-default-alias.mjs': {
        feature: 'module-loader.esm-global-function-assignment',
        source: `
          const { g = globalThis } = {};
          g.Function = g.Function;
          export const done = true;
        `,
      },
      '/global-destructured-unknown-default-alias.mjs': {
        feature: 'module-loader.esm-global-function-assignment',
        source: `
          const source = {};
          const { g = globalThis } = source;
          g.Function = g.Function;
          export const done = true;
        `,
      },
      '/global-array-unknown-default-alias.mjs': {
        feature: 'module-loader.esm-global-function-assignment',
        source: `
          const source = [];
          const [g = globalThis] = source;
          g.Function = g.Function;
          export const done = true;
        `,
      },
      '/global-default-param-alias.mjs': {
        feature: 'module-loader.esm-global-function-assignment',
        source: `
          function mutate(g = globalThis) {
            g.Function = g.Function;
          }
          mutate();
          export const done = true;
        `,
      },
      '/eval.mjs': {
        feature: 'module-loader.esm-dynamic-function-scope',
        source: `
          (0, eval)("var Function = function EvalFunction() {}");
          export const name = Function.name;
        `,
      },
      '/eval-string-function-only.mjs': {
        feature: 'module-loader.esm-dynamic-function-scope',
        source: `
          eval("globalThis.Function = globalThis.Function");
          export const done = true;
        `,
      },
      '/global-eval.mjs': {
        feature: 'module-loader.esm-dynamic-function-scope',
        source: `
          globalThis["eval"]("var Function = function GlobalEvalFunction() {}");
          export const name = Function.name;
        `,
      },
      '/global-eval-sequence.mjs': {
        feature: 'module-loader.esm-dynamic-function-scope',
        source: `
          (0, globalThis.eval)("var Function = function GlobalEvalFunction() {}");
          export const name = Function.name;
        `,
      },
      '/global-eval-alias.mjs': {
        feature: 'module-loader.esm-dynamic-function-scope',
        source: `
          const e = globalThis["ev" + "al"];
          e("globalThis.Function = globalThis.Function");
          export const done = true;
        `,
      },
      '/array-eval-alias.mjs': {
        feature: 'module-loader.esm-dynamic-function-scope',
        source: `
          const [e] = [eval];
          e("globalThis.Function = globalThis.Function");
          export const done = true;
        `,
      },
      '/object-literal-eval-alias.mjs': {
        feature: 'module-loader.esm-dynamic-function-scope',
        source: `
          const { x: e } = { x: eval };
          e("globalThis.Function = globalThis.Function");
          export const done = true;
        `,
      },
    };

    for (const [path, { feature, source }] of Object.entries(cases)) {
      const loader = setup({ [path]: source });
      await expect(loader.import(path, '/entry.mjs')).rejects.toMatchObject({
        name: 'NotImplementedError',
        feature,
      });
    }
  });

  it('does not reject computed ESM global reads that are not Function', async () => {
    const loader = setup({
      '/main.mjs': `
        const processValue = globalThis["process"];
        const processKey = "process";
        const dynamicProcessValue = globalThis[processKey];
        export const hasProcess = typeof processValue;
        export const hasDynamicProcess = typeof dynamicProcessValue;
        export const functionName = Function.name;
      `,
    });
    const ns = await loader.import('./main.mjs', '/entry.mjs');
    expect(ns.functionName).toBe('Function');
  });

  it('does not reject local ESM Function shadowing', async () => {
    const loader = setup({
      '/main.mjs': `
        let Function;
        Function = function LocalFunction() {};
        export const name = Function.name;
      `,
    });
    const ns = await loader.import('./main.mjs', '/entry.mjs');
    expect(ns.name).toBe('LocalFunction');
  });

  it('does not treat shadowed ESM Object or Reflect as global mutation helpers', async () => {
    const loader = setup({
      '/object.mjs': `
        const Object = { assign() {} };
        Object.assign(globalThis, { Function: function LocalObjectFunction() {} });
        export const name = Function.name;
      `,
      '/reflect.mjs': `
        const Reflect = { set() { return true; } };
        Reflect.set(globalThis, "Function", function LocalReflectFunction() {});
        export const name = Function.name;
      `,
    });
    await expect(loader.import('./object.mjs', '/entry.mjs')).resolves.toMatchObject({
      name: 'Function',
    });
    await expect(loader.import('./reflect.mjs', '/entry.mjs')).resolves.toMatchObject({
      name: 'Function',
    });
  });

  it('does not treat ESM this.Function as the global Function property', async () => {
    const loader = setup({
      '/main.mjs': `
        function readThis() {
          return this.Function.name;
        }
        export const name = readThis.call({ Function: function LocalThisFunction() {} });
      `,
    });
    const ns = await loader.import('./main.mjs', '/entry.mjs');
    expect(ns.name).toBe('LocalThisFunction');
  });

  it('loads absolute file:// URLs through the VFS resolver', async () => {
    const loader = setup({
      '/app/config one.mjs': 'export const answer = 42;',
    });
    const ns = await loader.import('file:///app/config%20one.mjs?mtime=123#hash', '/entry.mjs');
    expect(ns.answer).toBe(42);
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

  it('routes import() inside CJS modules through the VFS loader', async () => {
    const loader = setup({
      '/main.cjs': "exports.promise = import('./esm.mjs').then((m) => m.value);",
      '/esm.mjs': "export const value = 'routed';",
    });
    const cjs = loader.require('./main.cjs', '/entry.js') as { promise: Promise<unknown> };
    await expect(cjs.promise).resolves.toBe('routed');
  });

  it('CJS import() rejects symbol specifiers like Node', async () => {
    const loader = setup({
      '/main.cjs': "exports.promise = import(Symbol('x'));",
    });
    const cjs = loader.require('./main.cjs', '/entry.js') as { promise: Promise<unknown> };
    await expect(cjs.promise).rejects.toThrow(/Cannot convert a Symbol value to a string/);
  });

  it('routes CJS import() despite helper-shaped local names', async () => {
    const loader = setup({
      '/main.cjs': `
        var __riftyDynamicImport = () => Promise.resolve({ value: 'wrong' });
        exports.promise = import('./esm.mjs').then((m) => m.value);
      `,
      '/esm.mjs': "export const value = 'cjs-helper-hygiene';",
    });
    const cjs = loader.require('./main.cjs', '/entry.js') as { promise: Promise<unknown> };
    await expect(cjs.promise).resolves.toBe('cjs-helper-hygiene');
  });

  it('routes import() with comments before parens inside CJS modules', async () => {
    const loader = setup({
      '/main.cjs': "exports.promise = import/*cjs-comment*/('./esm.mjs').then((m) => m.value);",
      '/esm.mjs': "export const value = 'comment-routed';",
    });
    const cjs = loader.require('./main.cjs', '/entry.js') as { promise: Promise<unknown> };
    await expect(cjs.promise).resolves.toBe('comment-routed');
  });

  it('routes import() inside a runtime-built Function in CJS modules', async () => {
    const loader = setup({
      '/main.cjs':
        "const dyn = new Function('specifier', 'return import(specifier)'); exports.promise = dyn('./esm.mjs').then((m) => m.value);",
      '/esm.mjs': "export const value = 'function-routed';",
    });
    const cjs = loader.require('./main.cjs', '/entry.js') as { promise: Promise<unknown> };
    await expect(cjs.promise).resolves.toBe('function-routed');
  });

  it('routes CJS Function constructor import() despite helper-shaped local names', async () => {
    const loader = setup({
      '/main.cjs': `
        var __riftyFunction = function () {
          return () => Promise.resolve({ value: 'wrong' });
        };
        const dyn = new Function('specifier', 'return import(specifier)');
        exports.promise = dyn('./esm.mjs').then((m) => m.value);
      `,
      '/esm.mjs': "export const value = 'cjs-function-helper-hygiene';",
    });
    const cjs = loader.require('./main.cjs', '/entry.js') as { promise: Promise<unknown> };
    await expect(cjs.promise).resolves.toBe('cjs-function-helper-hygiene');
  });

  it('routes CJS Function constructor parameter import() through the VFS loader', async () => {
    const loader = setup({
      '/main.cjs': `
        const dyn = new Function('loaded = import("./esm.mjs")', 'return loaded');
        exports.promise = dyn().then((m) => m.value);
      `,
      '/esm.mjs': "export const value = 'cjs-function-param-routed';",
    });
    const cjs = loader.require('./main.cjs', '/entry.js') as { promise: Promise<unknown> };
    await expect(cjs.promise).resolves.toBe('cjs-function-param-routed');
  });

  it('routes runtime-built Function import() when eval appears only as text in CJS', async () => {
    const loader = setup({
      '/main.cjs': `
        const dyn = new Function('specifier', 'const note = "eval"; return import(specifier)');
        exports.promise = dyn('./esm.mjs').then((m) => m.value);
      `,
      '/esm.mjs': "export const value = 'cjs-function-string-literal';",
    });
    const cjs = loader.require('./main.cjs', '/entry.js') as { promise: Promise<unknown> };
    await expect(cjs.promise).resolves.toBe('cjs-function-string-literal');
  });

  it('throws a directed ceiling when runtime-built Function creates a nested import Function in CJS', () => {
    const loader = setup({
      '/main.cjs': `
        const outer = new Function('return Function("specifier", "return import(specifier)")');
        const dyn = outer();
        exports.promise = dyn('./esm.mjs').then((m) => m.value);
      `,
      '/esm.mjs': "export const value = 'wrong-target';",
    });
    expect(() => loader.require('./main.cjs', '/entry.js')).toThrow(
      expect.objectContaining({
        name: 'NotImplementedError',
        feature: 'module-loader.function-constructor-dynamic-scope',
      }) as unknown as Error,
    );
  });

  it('throws a directed ceiling when runtime-built Function creates a split-string nested import Function in CJS', () => {
    const loader = setup({
      '/main.cjs': `
        const outer = new Function('return Function("specifier", "return " + "im" + "port(specifier)")');
        const dyn = outer();
        exports.promise = dyn('./esm.mjs').then((m) => m.value);
      `,
      '/esm.mjs': "export const value = 'wrong-target';",
    });
    expect(() => loader.require('./main.cjs', '/entry.js')).toThrow(
      expect.objectContaining({
        name: 'NotImplementedError',
        feature: 'module-loader.function-constructor-dynamic-scope',
      }) as unknown as Error,
    );
  });

  it('throws a directed ceiling when runtime-built Function invokes nested Function through Reflect in CJS', () => {
    const applyLoader = setup({
      '/main.cjs': `
        const outer = new Function('return Reflect.apply(Function, undefined, ["specifier", "return import(specifier)"])');
        const dyn = outer();
        exports.promise = dyn('./esm.mjs').then((m) => m.value);
      `,
      '/esm.mjs': "export const value = 'wrong-target';",
    });
    expect(() => applyLoader.require('./main.cjs', '/entry.js')).toThrow(
      expect.objectContaining({
        name: 'NotImplementedError',
        feature: 'module-loader.function-constructor-dynamic-scope',
      }) as unknown as Error,
    );

    const constructLoader = setup({
      '/main.cjs': `
        const outer = new Function('return Reflect.construct(Function, ["specifier", "return import(specifier)"])');
        const dyn = outer();
        exports.promise = dyn('./esm.mjs').then((m) => m.value);
      `,
      '/esm.mjs': "export const value = 'wrong-target';",
    });
    expect(() => constructLoader.require('./main.cjs', '/entry.js')).toThrow(
      expect.objectContaining({
        name: 'NotImplementedError',
        feature: 'module-loader.function-constructor-dynamic-scope',
      }) as unknown as Error,
    );
  });

  it('throws a directed ceiling when runtime-built Function invokes nested Function through aliased Reflect in CJS', () => {
    const applyLoader = setup({
      '/main.cjs': `
        const outer = new Function('return (() => { const R = Reflect; return R.apply(Function, undefined, ["specifier", "return import(specifier)"]); })()');
        const dyn = outer();
        exports.promise = dyn('./esm.mjs').then((m) => m.value);
      `,
      '/esm.mjs': "export const value = 'wrong-target';",
    });
    expect(() => applyLoader.require('./main.cjs', '/entry.js')).toThrow(
      expect.objectContaining({
        name: 'NotImplementedError',
        feature: 'module-loader.function-constructor-dynamic-scope',
      }) as unknown as Error,
    );

    const constructLoader = setup({
      '/main.cjs': `
        const outer = new Function('return (() => { const R = Reflect; return R.construct(Function, ["specifier", "return import(specifier)"]); })()');
        const dyn = outer();
        exports.promise = dyn('./esm.mjs').then((m) => m.value);
      `,
      '/esm.mjs': "export const value = 'wrong-target';",
    });
    expect(() => constructLoader.require('./main.cjs', '/entry.js')).toThrow(
      expect.objectContaining({
        name: 'NotImplementedError',
        feature: 'module-loader.function-constructor-dynamic-scope',
      }) as unknown as Error,
    );
  });

  it('throws a directed ceiling when runtime-built Function invokes nested Function through extracted Reflect methods in CJS', () => {
    const applyLoader = setup({
      '/main.cjs': `
        const outer = new Function('return (() => { const apply = Reflect.apply; return apply(Function, undefined, ["specifier", "return import(specifier)"]); })()');
        const dyn = outer();
        exports.promise = dyn('./esm.mjs').then((m) => m.value);
      `,
      '/esm.mjs': "export const value = 'wrong-target';",
    });
    expect(() => applyLoader.require('./main.cjs', '/entry.js')).toThrow(
      expect.objectContaining({
        name: 'NotImplementedError',
        feature: 'module-loader.function-constructor-dynamic-scope',
      }) as unknown as Error,
    );

    const constructLoader = setup({
      '/main.cjs': `
        const outer = new Function('return (() => { const { construct } = Reflect; return construct(Function, ["specifier", "return import(specifier)"]); })()');
        const dyn = outer();
        exports.promise = dyn('./esm.mjs').then((m) => m.value);
      `,
      '/esm.mjs': "export const value = 'wrong-target';",
    });
    expect(() => constructLoader.require('./main.cjs', '/entry.js')).toThrow(
      expect.objectContaining({
        name: 'NotImplementedError',
        feature: 'module-loader.function-constructor-dynamic-scope',
      }) as unknown as Error,
    );
  });

  it('throws a directed ceiling when runtime-built Function invokes nested Function through extracted Reflect methods in CJS', () => {
    const applyLoader = setup({
      '/main.cjs': `
        const outer = new Function('return (() => { const { apply } = Reflect; return apply(Function, undefined, ["specifier", "return import(specifier)"]); })()');
        const dyn = outer();
        exports.promise = dyn('./esm.mjs').then((m) => m.value);
      `,
      '/esm.mjs': "export const value = 'wrong-target';",
    });
    expect(() => applyLoader.require('./main.cjs', '/entry.js')).toThrow(
      expect.objectContaining({
        name: 'NotImplementedError',
        feature: 'module-loader.function-constructor-dynamic-scope',
      }) as unknown as Error,
    );

    const constructLoader = setup({
      '/main.cjs': `
        const outer = new Function('return (() => { const { construct } = Reflect; return construct(Function, ["specifier", "return import(specifier)"]); })()');
        const dyn = outer();
        exports.promise = dyn('./esm.mjs').then((m) => m.value);
      `,
      '/esm.mjs': "export const value = 'wrong-target';",
    });
    expect(() => constructLoader.require('./main.cjs', '/entry.js')).toThrow(
      expect.objectContaining({
        name: 'NotImplementedError',
        feature: 'module-loader.function-constructor-dynamic-scope',
      }) as unknown as Error,
    );
  });

  it('throws a directed ceiling when runtime-built Function source invokes nested Function through aliased Reflect in CJS', () => {
    const loader = setup({
      '/main.cjs': `
        const outer = new Function('return Function("return (() => { const R = Reflect; return R.apply(Function, undefined, [\\\\\\"specifier\\\\\\", \\\\\\"return import(specifier)\\\\\\"]); })()")');
        const maker = outer();
        const dyn = maker();
        exports.promise = dyn('./esm.mjs').then((m) => m.value);
      `,
      '/esm.mjs': "export const value = 'wrong-target';",
    });
    expect(() => loader.require('./main.cjs', '/entry.js')).toThrow(
      expect.objectContaining({
        name: 'NotImplementedError',
        feature: 'module-loader.function-constructor-dynamic-scope',
      }) as unknown as Error,
    );
  });

  it('throws a directed ceiling when runtime-built Function source invokes nested Function through extracted Reflect methods in CJS', () => {
    const loader = setup({
      '/main.cjs': `
        const outer = new Function('return Function("return (() => { const { apply } = Reflect; return apply(Function, undefined, [\\\\\\"specifier\\\\\\", \\\\\\"return import(specifier)\\\\\\"]); })()")');
        const maker = outer();
        const dyn = maker();
        exports.promise = dyn('./esm.mjs').then((m) => m.value);
      `,
      '/esm.mjs': "export const value = 'wrong-target';",
    });
    expect(() => loader.require('./main.cjs', '/entry.js')).toThrow(
      expect.objectContaining({
        name: 'NotImplementedError',
        feature: 'module-loader.function-constructor-dynamic-scope',
      }) as unknown as Error,
    );
  });

  it('throws a directed ceiling when runtime-built Function invokes nested Function through call/apply/bind in CJS', () => {
    for (const source of [
      'return Function.call(undefined, "specifier", "return import(specifier)")',
      'return Function.apply(undefined, ["specifier", "return import(specifier)"])',
      'return Function.bind(undefined, "specifier", "return import(specifier)")()',
    ]) {
      const loader = setup({
        '/main.cjs': `
          const outer = new Function(${JSON.stringify(source)});
          const dyn = outer();
          exports.promise = dyn('./esm.mjs').then((m) => m.value);
        `,
        '/esm.mjs': "export const value = 'wrong-target';",
      });
      expect(() => loader.require('./main.cjs', '/entry.js')).toThrow(
        expect.objectContaining({
          name: 'NotImplementedError',
          feature: 'module-loader.function-constructor-dynamic-scope',
        }) as unknown as Error,
      );
    }
  });

  it('throws a directed ceiling when runtime-built Function reaches nested Function through a computed global key in CJS', () => {
    const loader = setup({
      '/main.cjs': `
        const outer = new Function('return globalThis["Fun".concat("ction")]("specifier", "return import(specifier)")');
        const dyn = outer();
        exports.promise = dyn('./esm.mjs').then((m) => m.value);
      `,
      '/esm.mjs': "export const value = 'wrong-target';",
    });
    expect(() => loader.require('./main.cjs', '/entry.js')).toThrow(
      expect.objectContaining({
        name: 'NotImplementedError',
        feature: 'module-loader.function-constructor-dynamic-scope',
      }) as unknown as Error,
    );
  });

  it('throws a directed ceiling when runtime-built Function reaches nested Function through Reflect.get(globalThis) in CJS', () => {
    const loader = setup({
      '/main.cjs': `
        const outer = new Function('return Reflect.get(globalThis, "Function")("specifier", "return import(specifier)")');
        const dyn = outer();
        exports.promise = dyn('./esm.mjs').then((m) => m.value);
      `,
      '/esm.mjs': "export const value = 'wrong-target';",
    });
    expect(() => loader.require('./main.cjs', '/entry.js')).toThrow(
      expect.objectContaining({
        name: 'NotImplementedError',
        feature: 'module-loader.function-constructor-dynamic-scope',
      }) as unknown as Error,
    );
  });

  it('throws a directed ceiling when runtime-built Function reaches nested Function through aliased Reflect.get in CJS', () => {
    const loader = setup({
      '/main.cjs': `
        const outer = new Function(\`
          const get = Reflect.get;
          const F = get(globalThis, "Function");
          return F("specifier", "return import(specifier)");
        \`);
        const dyn = outer();
        exports.promise = dyn('./esm.mjs').then((m) => m.value);
      `,
      '/esm.mjs': "export const value = 'wrong-target';",
    });
    expect(() => loader.require('./main.cjs', '/entry.js')).toThrow(
      expect.objectContaining({
        name: 'NotImplementedError',
        feature: 'module-loader.function-constructor-dynamic-scope',
      }) as unknown as Error,
    );
  });

  it('throws a directed ceiling when runtime-built Function reaches eval through a computed global key in CJS', () => {
    const loader = setup({
      '/main.cjs': `
        const dyn = new Function(\`return globalThis["ev".concat("al")]("import('./esm.mjs')")\`);
        exports.promise = dyn().then((m) => m.value);
      `,
      '/esm.mjs': "export const value = 'wrong-target';",
    });
    expect(() => loader.require('./main.cjs', '/entry.js')).toThrow(
      expect.objectContaining({
        name: 'NotImplementedError',
        feature: 'module-loader.function-constructor-dynamic-scope',
      }) as unknown as Error,
    );
  });

  it('throws a directed ceiling when runtime-built Function reaches eval through Reflect.get(globalThis) in CJS', () => {
    const loader = setup({
      '/main.cjs': `
        const dyn = new Function(\`return Reflect.get(globalThis, "eval")("import('./esm.mjs')")\`);
        exports.promise = dyn().then((m) => m.value);
      `,
      '/esm.mjs': "export const value = 'wrong-target';",
    });
    expect(() => loader.require('./main.cjs', '/entry.js')).toThrow(
      expect.objectContaining({
        name: 'NotImplementedError',
        feature: 'module-loader.function-constructor-dynamic-scope',
      }) as unknown as Error,
    );
  });

  it('throws a directed ceiling when runtime-built Function reaches eval through aliased Reflect.get in CJS', () => {
    const loader = setup({
      '/main.cjs': `
        const dyn = new Function(\`
          const get = Reflect.get;
          const run = get(globalThis, "eval");
          return run("import('./esm.mjs')");
        \`);
        exports.promise = dyn().then((m) => m.value);
      `,
      '/esm.mjs': "export const value = 'wrong-target';",
    });
    expect(() => loader.require('./main.cjs', '/entry.js')).toThrow(
      expect.objectContaining({
        name: 'NotImplementedError',
        feature: 'module-loader.function-constructor-dynamic-scope',
      }) as unknown as Error,
    );
  });

  it('throws a directed ceiling when runtime-built Function derives a nested host constructor in CJS', () => {
    const loader = setup({
      '/main.cjs': `
        const outer = new Function('return (() => {}).constructor("specifier", "return import(specifier)")');
        const dyn = outer();
        exports.promise = dyn('./esm.mjs').then((m) => m.value);
      `,
      '/esm.mjs': "export const value = 'wrong-target';",
    });
    expect(() => loader.require('./main.cjs', '/entry.js')).toThrow(
      expect.objectContaining({
        name: 'NotImplementedError',
        feature: 'module-loader.function-constructor-derived-host',
      }) as unknown as Error,
    );
  });

  it('throws a directed ceiling when CJS object defaults alias a derived host constructor', () => {
    const loader = setup({
      '/main.cjs': `
        const { F = Function.prototype.constructor } = {};
        exports.promise = F("return import('./esm.mjs')")().then((m) => m.value);
      `,
      '/esm.mjs': "export const value = 'wrong-target';",
    });
    expect(() => loader.require('./main.cjs', '/entry.js')).toThrow(
      expect.objectContaining({
        name: 'NotImplementedError',
        feature: 'module-loader.function-constructor-derived-host',
      }) as unknown as Error,
    );
  });

  it('does not reject CJS modules merely defining a dynamic derived Function evaluator', () => {
    const loader = setup({
      '/main.cjs': `
        const AsyncFunction = async function() {}.constructor;
        exports.compile = function compile(result) {
          return new AsyncFunction("ssrImport", '"use strict";' + result.code);
        };
        exports.loaded = true;
      `,
    });
    expect(loader.require('./main.cjs', '/entry.js')).toMatchObject({ loaded: true });
  });

  it('does not reject CJS modules merely combining a dynamic derived Function evaluator with dynamic eval', () => {
    const loader = setup({
      '/main.cjs': `
        const AsyncFunction = async function() {}.constructor;
        exports.compile = function compile(result) {
          return new AsyncFunction("ssrImport", '"use strict";' + result.code);
        };
        exports.parse = function parse(value) {
          try {
            return (0, eval)(value);
          } catch {
            return undefined;
          }
        };
        exports.loaded = true;
      `,
    });
    expect(loader.require('./main.cjs', '/entry.js')).toMatchObject({ loaded: true });
  });

  it('does not reject CJS modules merely combining lexical Function with unrelated dynamic eval', () => {
    const loader = setup({
      '/main.cjs': `
        exports.evalValue = function evalValue(rawValue) {
          const fn = new Function("return (" + rawValue + ")");
          return fn();
        };
        exports.parse = function parse(value) {
          try {
            return (0, eval)(value);
          } catch {
            return undefined;
          }
        };
        exports.loaded = true;
      `,
    });
    expect(loader.require('./main.cjs', '/entry.js')).toMatchObject({ loaded: true });
  });

  it('throws a directed ceiling when runtime-built Function derives a split-string nested host constructor in CJS', () => {
    const loader = setup({
      '/main.cjs': `
        const outer = new Function('return (() => {}).constructor("specifier", "return " + "im" + "port(specifier)")');
        const dyn = outer();
        exports.promise = dyn('./esm.mjs').then((m) => m.value);
      `,
      '/esm.mjs': "export const value = 'wrong-target';",
    });
    expect(() => loader.require('./main.cjs', '/entry.js')).toThrow(
      expect.objectContaining({
        name: 'NotImplementedError',
        feature: 'module-loader.function-constructor-derived-host',
      }) as unknown as Error,
    );
  });

  it('throws a directed ceiling when runtime-built Function derives a computed nested host constructor in CJS', () => {
    const loader = setup({
      '/main.cjs': `
        const outer = new Function('return (() => {})["con".concat("structor")]("specifier", "return import(specifier)")');
        const dyn = outer();
        exports.promise = dyn('./esm.mjs').then((m) => m.value);
      `,
      '/esm.mjs': "export const value = 'wrong-target';",
    });
    expect(() => loader.require('./main.cjs', '/entry.js')).toThrow(
      expect.objectContaining({
        name: 'NotImplementedError',
        feature: 'module-loader.function-constructor-derived-host',
      }) as unknown as Error,
    );
  });

  it('throws a directed ceiling when runtime-built Function object defaults alias nested Function in CJS', () => {
    const loader = setup({
      '/main.cjs': `
        const outer = new Function(\`
          const { F = Function } = {};
          return F("specifier", "return import(specifier)");
        \`);
        const dyn = outer();
        exports.promise = dyn('./esm.mjs').then((m) => m.value);
      `,
      '/esm.mjs': "export const value = 'wrong-target';",
    });
    expect(() => loader.require('./main.cjs', '/entry.js')).toThrow(
      expect.objectContaining({
        name: 'NotImplementedError',
        feature: 'module-loader.function-constructor-dynamic-scope',
      }) as unknown as Error,
    );
  });

  it('preserves native SyntaxError for runtime-built Function bodies without import() in CJS', () => {
    const loader = setup({
      '/main.cjs': `
        let caught;
        try {
          new Function('return }');
        } catch (err) {
          caught = err;
        }
        exports.name = caught?.name;
        exports.isSyntaxError = caught instanceof SyntaxError;
      `,
    });
    const cjs = loader.require('./main.cjs', '/entry.js') as {
      name: string;
      isSyntaxError: boolean;
    };
    expect(cjs.name).toBe('SyntaxError');
    expect(cjs.isSyntaxError).toBe(true);
  });

  it('preserves native SyntaxError for invalid runtime-built Function bodies with constructor text but no import() in CJS', () => {
    const loader = setup({
      '/main.cjs': `
        let caught;
        try {
          new Function('const constructor =');
        } catch (err) {
          caught = err;
        }
        exports.name = caught?.name;
        exports.isSyntaxError = caught instanceof SyntaxError;
      `,
    });
    const cjs = loader.require('./main.cjs', '/entry.js') as {
      name: string;
      isSyntaxError: boolean;
    };
    expect(cjs.name).toBe('SyntaxError');
    expect(cjs.isSyntaxError).toBe(true);
  });

  it('throws a directed ceiling when runtime-built Function import() uses with dynamic scope in CJS', () => {
    const loader = setup({
      '/main.cjs': `
        const dyn = new Function('specifier', \`
          const n = "__rifty" + "DynamicImport";
          with ({ [n]: () => Promise.resolve({ value: "wrong" }) }) {
            return import(specifier);
          }
        \`);
        exports.promise = dyn('./esm.mjs').then((m) => m.value);
      `,
      '/esm.mjs': "export const value = 'wrong-target';",
    });
    expect(() => loader.require('./main.cjs', '/entry.js')).toThrow(
      expect.objectContaining({
        name: 'NotImplementedError',
        feature: 'module-loader.function-constructor-dynamic-scope',
      }) as unknown as Error,
    );
  });

  it('throws a directed ceiling when runtime-built Function import() hides behind eval in CJS', () => {
    const loader = setup({
      '/main.cjs': `
        const dyn = new Function('specifier', 'return eval("import(specifier)")');
        exports.promise = dyn('./esm.mjs').then((m) => m.value);
      `,
      '/esm.mjs': "export const value = 'wrong-target';",
    });
    expect(() => loader.require('./main.cjs', '/entry.js')).toThrow(
      expect.objectContaining({
        name: 'NotImplementedError',
        feature: 'module-loader.function-constructor-dynamic-scope',
      }) as unknown as Error,
    );
  });

  it('throws a directed ceiling when CJS eval text contains import()', () => {
    const loader = setup({
      '/main.cjs': 'exports.promise = eval("import(\'./esm.mjs\')").then((m) => m.value);',
      '/esm.mjs': "export const value = 'wrong-target';",
    });
    expect(() => loader.require('./main.cjs', '/entry.js')).toThrow(
      expect.objectContaining({
        name: 'NotImplementedError',
        feature: 'module-loader.cjs-dynamic-function-scope',
      }) as unknown as Error,
    );
  });

  it('throws a directed ceiling when runtime-built Function eval synthesizes import in CJS', () => {
    const loader = setup({
      '/main.cjs': `
        const dyn = new Function('specifier', 'return eval("im" + "port(specifier)")');
        exports.promise = dyn('./esm.mjs').then((m) => m.value);
      `,
      '/esm.mjs': "export const value = 'wrong-target';",
    });
    expect(() => loader.require('./main.cjs', '/entry.js')).toThrow(
      expect.objectContaining({
        name: 'NotImplementedError',
        feature: 'module-loader.function-constructor-dynamic-scope',
      }) as unknown as Error,
    );
  });

  it('throws a directed ceiling when runtime-built Function aliases eval before import in CJS', () => {
    const loader = setup({
      '/main.cjs': `
        const dyn = new Function('specifier', 'const e = eval; return e("import(specifier)")');
        exports.promise = dyn('./esm.mjs').then((m) => m.value);
      `,
      '/esm.mjs': "export const value = 'wrong-target';",
    });
    expect(() => loader.require('./main.cjs', '/entry.js')).toThrow(
      expect.objectContaining({
        name: 'NotImplementedError',
        feature: 'module-loader.function-constructor-dynamic-scope',
      }) as unknown as Error,
    );
  });

  it('throws a directed ceiling when runtime-built Function aliases indirect eval before import in CJS', () => {
    const loader = setup({
      '/main.cjs': `
        const dyn = new Function('specifier', 'const e = (0, eval); return e("import(specifier)")');
        exports.promise = dyn('./esm.mjs').then((m) => m.value);
      `,
      '/esm.mjs': "export const value = 'wrong-target';",
    });
    expect(() => loader.require('./main.cjs', '/entry.js')).toThrow(
      expect.objectContaining({
        name: 'NotImplementedError',
        feature: 'module-loader.function-constructor-dynamic-scope',
      }) as unknown as Error,
    );
  });

  it('throws a directed ceiling when runtime-built Function destructures eval before import in CJS', () => {
    const loader = setup({
      '/main.cjs': `
        const dyn = new Function('specifier', 'const { eval: e } = globalThis; return e("import(specifier)")');
        exports.promise = dyn('./esm.mjs').then((m) => m.value);
      `,
      '/esm.mjs': "export const value = 'wrong-target';",
    });
    expect(() => loader.require('./main.cjs', '/entry.js')).toThrow(
      expect.objectContaining({
        name: 'NotImplementedError',
        feature: 'module-loader.function-constructor-dynamic-scope',
      }) as unknown as Error,
    );
  });

  it('throws a directed ceiling when runtime-built Function destructures computed eval before import in CJS', () => {
    const loader = setup({
      '/main.cjs': `
        const dyn = new Function('specifier', 'const { ["ev" + "al"]: e } = globalThis; return e("import(specifier)")');
        exports.promise = dyn('./esm.mjs').then((m) => m.value);
      `,
      '/esm.mjs': "export const value = 'wrong-target';",
    });
    expect(() => loader.require('./main.cjs', '/entry.js')).toThrow(
      expect.objectContaining({
        name: 'NotImplementedError',
        feature: 'module-loader.function-constructor-dynamic-scope',
      }) as unknown as Error,
    );
  });

  it('throws a directed ceiling when runtime-built Function array-destructures eval before import in CJS', () => {
    const loader = setup({
      '/main.cjs': `
        const dyn = new Function('specifier', 'const [e] = [eval]; return e("im" + "port(specifier)")');
        exports.promise = dyn('./esm.mjs').then((m) => m.value);
      `,
      '/esm.mjs': "export const value = 'wrong-target';",
    });
    expect(() => loader.require('./main.cjs', '/entry.js')).toThrow(
      expect.objectContaining({
        name: 'NotImplementedError',
        feature: 'module-loader.function-constructor-dynamic-scope',
      }) as unknown as Error,
    );
  });

  it('throws a directed ceiling when runtime-built Function aliases eval through object literals in CJS', () => {
    const loader = setup({
      '/main.cjs': `
        const dyn = new Function('specifier', 'const { x: e } = { x: eval }; return e("im" + "port(specifier)")');
        exports.promise = dyn('./esm.mjs').then((m) => m.value);
      `,
      '/esm.mjs': "export const value = 'wrong-target';",
    });
    expect(() => loader.require('./main.cjs', '/entry.js')).toThrow(
      expect.objectContaining({
        name: 'NotImplementedError',
        feature: 'module-loader.function-constructor-dynamic-scope',
      }) as unknown as Error,
    );
  });

  it('throws a directed ceiling for CJS imports routed through derived host Function constructors', () => {
    const loader = setup({
      '/main.cjs': `
        const F = (() => {}).constructor;
        const dyn = F('specifier', 'return import(specifier)');
        exports.promise = dyn('./esm.mjs').then((m) => m.value);
      `,
      '/esm.mjs': "export const value = 'wrong-target';",
    });
    expect(() => loader.require('./main.cjs', '/entry.js')).toThrow(
      expect.objectContaining({
        name: 'NotImplementedError',
        feature: 'module-loader.function-constructor-derived-host',
      }) as unknown as Error,
    );
  });

  it('throws a directed ceiling for CJS imports routed through Object descriptor host constructors', () => {
    const loader = setup({
      '/main.cjs': `
        const outer = new Function('return Object.getOwnPropertyDescriptor(Function.prototype, "constructor").value("specifier", "return import(specifier)")');
        const dyn = outer();
        exports.promise = dyn('./esm.mjs').then((m) => m.value);
      `,
      '/esm.mjs': "export const value = 'wrong-target';",
    });
    expect(() => loader.require('./main.cjs', '/entry.js')).toThrow(
      expect.objectContaining({
        name: 'NotImplementedError',
        feature: 'module-loader.function-constructor-derived-host',
      }) as unknown as Error,
    );
  });

  it('throws a directed ceiling for CJS imports routed through aliased descriptor host constructors', () => {
    const loader = setup({
      '/main.cjs': `
        const outer = new Function(\`
          const O = Object;
          const { value: F } = O.getOwnPropertyDescriptor(Function.prototype, "constructor");
          return F("specifier", "return import(specifier)");
        \`);
        const dyn = outer();
        exports.promise = dyn('./esm.mjs').then((m) => m.value);
      `,
      '/esm.mjs': "export const value = 'wrong-target';",
    });
    expect(() => loader.require('./main.cjs', '/entry.js')).toThrow(
      expect.objectContaining({
        name: 'NotImplementedError',
        feature: 'module-loader.function-constructor-derived-host',
      }) as unknown as Error,
    );
  });

  it('throws a directed ceiling for CJS imports routed through Object descriptor map host constructors', () => {
    const loader = setup({
      '/main.cjs': `
        const outer = new Function('return Object.getOwnPropertyDescriptors(Function.prototype).constructor.value("specifier", "return import(specifier)")');
        const dyn = outer();
        exports.promise = dyn('./esm.mjs').then((m) => m.value);
      `,
      '/esm.mjs': "export const value = 'wrong-target';",
    });
    expect(() => loader.require('./main.cjs', '/entry.js')).toThrow(
      expect.objectContaining({
        name: 'NotImplementedError',
        feature: 'module-loader.function-constructor-derived-host',
      }) as unknown as Error,
    );
  });

  it('throws a directed ceiling for CJS imports routed through aliased descriptor map host constructors', () => {
    const loader = setup({
      '/main.cjs': `
        const outer = new Function(\`
          const descriptors = Object.getOwnPropertyDescriptors(Function.prototype);
          const F = descriptors.constructor.value;
          return F("specifier", "return import(specifier)");
        \`);
        const dyn = outer();
        exports.promise = dyn('./esm.mjs').then((m) => m.value);
      `,
      '/esm.mjs': "export const value = 'wrong-target';",
    });
    expect(() => loader.require('./main.cjs', '/entry.js')).toThrow(
      expect.objectContaining({
        name: 'NotImplementedError',
        feature: 'module-loader.function-constructor-derived-host',
      }) as unknown as Error,
    );
  });

  it('throws a directed ceiling for CJS imports routed through enumerated descriptor map host constructors', () => {
    const loader = setup({
      '/main.cjs': `
        const outer = new Function(\`
          const F = Object.values(Object.getOwnPropertyDescriptors(Function.prototype))
            .find((descriptor) => descriptor.value && descriptor.value.name === "Function")
            .value;
          return F("specifier", "return import(specifier)");
        \`);
        const dyn = outer();
        exports.promise = dyn('./esm.mjs').then((m) => m.value);
      `,
      '/esm.mjs': "export const value = 'wrong-target';",
    });
    expect(() => loader.require('./main.cjs', '/entry.js')).toThrow(
      expect.objectContaining({
        name: 'NotImplementedError',
        feature: 'module-loader.function-constructor-derived-host',
      }) as unknown as Error,
    );
  });

  it('throws a directed ceiling for optional-chained CJS derived host Function constructors', () => {
    const loader = setup({
      '/main.cjs': `
        const F = (() => {})?.constructor;
        const dyn = F('specifier', 'return import(specifier)');
        exports.promise = dyn('./esm.mjs').then((m) => m.value);
      `,
      '/esm.mjs': "export const value = 'wrong-target';",
    });
    expect(() => loader.require('./main.cjs', '/entry.js')).toThrow(
      expect.objectContaining({
        name: 'NotImplementedError',
        feature: 'module-loader.function-constructor-derived-host',
      }) as unknown as Error,
    );
  });

  it('throws a directed ceiling for destructured CJS derived host Function constructors', () => {
    const loader = setup({
      '/main.cjs': `
        const { constructor: F } = (() => {});
        const dyn = F('specifier', 'return import(specifier)');
        exports.promise = dyn('./esm.mjs').then((m) => m.value);
      `,
      '/esm.mjs': "export const value = 'wrong-target';",
    });
    expect(() => loader.require('./main.cjs', '/entry.js')).toThrow(
      expect.objectContaining({
        name: 'NotImplementedError',
        feature: 'module-loader.function-constructor-derived-host',
      }) as unknown as Error,
    );
  });

  it('throws a directed ceiling for sequence-wrapped CJS derived host Function constructors', () => {
    const loader = setup({
      '/main.cjs': `
        const dyn = (0, (() => {}).constructor)('specifier', 'return import(specifier)');
        exports.promise = dyn('./esm.mjs').then((m) => m.value);
      `,
      '/esm.mjs': "export const value = 'wrong-target';",
    });
    expect(() => loader.require('./main.cjs', '/entry.js')).toThrow(
      expect.objectContaining({
        name: 'NotImplementedError',
        feature: 'module-loader.function-constructor-derived-host',
      }) as unknown as Error,
    );
  });

  it('throws a directed ceiling for Reflect.get CJS derived host Function constructors', () => {
    const loader = setup({
      '/main.cjs': `
        const F = Reflect.get(Function.prototype, "constructor");
        const dyn = F('specifier', 'return import(specifier)');
        exports.promise = dyn('./esm.mjs').then((m) => m.value);
      `,
      '/esm.mjs': "export const value = 'wrong-target';",
    });
    expect(() => loader.require('./main.cjs', '/entry.js')).toThrow(
      expect.objectContaining({
        name: 'NotImplementedError',
        feature: 'module-loader.function-constructor-derived-host',
      }) as unknown as Error,
    );
  });

  it('throws a directed ceiling for array-destructured CJS derived host Function constructors', () => {
    const loader = setup({
      '/main.cjs': `
        const [F] = [(() => {}).constructor];
        const dyn = F('specifier', 'return import(specifier)');
        exports.promise = dyn('./esm.mjs').then((m) => m.value);
      `,
      '/esm.mjs': "export const value = 'wrong-target';",
    });
    expect(() => loader.require('./main.cjs', '/entry.js')).toThrow(
      expect.objectContaining({
        name: 'NotImplementedError',
        feature: 'module-loader.function-constructor-derived-host',
      }) as unknown as Error,
    );
  });

  it('throws a directed ceiling for Reflect-invoked CJS derived host Function constructors', () => {
    const applyLoader = setup({
      '/main.cjs': `
        const dyn = Reflect.apply((() => {}).constructor, undefined, [
          'specifier',
          'return import(specifier)',
        ]);
        exports.promise = dyn('./esm.mjs').then((m) => m.value);
      `,
      '/esm.mjs': "export const value = 'wrong-target';",
    });
    expect(() => applyLoader.require('./main.cjs', '/entry.js')).toThrow(
      expect.objectContaining({
        name: 'NotImplementedError',
        feature: 'module-loader.function-constructor-derived-host',
      }) as unknown as Error,
    );

    const constructLoader = setup({
      '/main.cjs': `
        const dyn = Reflect.construct((() => {}).constructor, [
          'specifier',
          'return import(specifier)',
        ]);
        exports.promise = dyn('./esm.mjs').then((m) => m.value);
      `,
      '/esm.mjs': "export const value = 'wrong-target';",
    });
    expect(() => constructLoader.require('./main.cjs', '/entry.js')).toThrow(
      expect.objectContaining({
        name: 'NotImplementedError',
        feature: 'module-loader.function-constructor-derived-host',
      }) as unknown as Error,
    );
  });

  it('does not break CJS modules that shadow the global Function constructor', () => {
    const loader = setup({
      '/main.cjs': `
        const Function = () => 'local';
        exports.value = Function();
      `,
    });
    expect(loader.require('./main.cjs', '/entry.js')).toMatchObject({ value: 'local' });
  });

  it('rewrites only free CJS Function reads, not local params or property names', () => {
    const loader = setup({
      '/main.cjs': `
        function callLocal(Function) {
          return Function();
        }
        exports.local = callLocal(() => 'param');
        exports.property = ({ Function: 'property' }).Function;
        exports.shorthandName = ({ Function }).Function.name;
      `,
    });
    expect(loader.require('./main.cjs', '/entry.js')).toMatchObject({
      local: 'param',
      property: 'property',
      shorthandName: 'Function',
    });
  });

  it('does not rewrite CJS Function reads shadowed in switch cases or class static blocks', () => {
    const loader = setup({
      '/main.cjs': `
        switch (0) {
          case 0:
            const Function = () => 'switch-local';
            exports.switchValue = Function();
            break;
        }
        class Holder {
          static {
            const Function = () => 'static-local';
            exports.staticValue = Function();
          }
        }
      `,
    });
    expect(loader.require('./main.cjs', '/entry.js')).toMatchObject({
      switchValue: 'switch-local',
      staticValue: 'static-local',
    });
  });

  it('throws a directed ceiling for CJS modules assigning the global Function binding', () => {
    const loader = setup({
      '/main.cjs': `
        Function = function LocalFunction() {};
        exports.name = Function.name;
      `,
    });
    expect(() => loader.require('./main.cjs', '/entry.js')).toThrow(
      expect.objectContaining({
        name: 'NotImplementedError',
        feature: 'module-loader.cjs-global-function-assignment',
      }) as unknown as Error,
    );
  });

  it('throws a directed ceiling for dynamic CJS scopes that mention Function', () => {
    const loader = setup({
      '/with.cjs': `
        with ({ Function: () => 'with-local' }) {
          exports.value = Function();
        }
      `,
      '/eval.cjs': `
        eval("var Function = () => 'eval-local'");
        exports.value = Function();
      `,
      '/indirect-eval.cjs': `
        (0, eval)("var Function = function IndirectEvalFunction() {}");
        exports.value = Function.name;
      `,
      '/global-eval.cjs': `
        globalThis.eval("var Function = function GlobalEvalFunction() {}");
        exports.value = Function.name;
      `,
      '/computed-global-eval.cjs': `
        globalThis["eval"]("var Function = function ComputedGlobalEvalFunction() {}");
        exports.value = Function.name;
      `,
      '/eval-string-function-only.cjs': `
        eval("globalThis.Function = globalThis.Function");
        exports.done = true;
      `,
      '/global-eval-alias.cjs': `
        const e = globalThis["ev" + "al"];
        e("globalThis.Function = globalThis.Function");
        exports.done = true;
      `,
      '/array-eval-alias.cjs': `
        const [e] = [eval];
        e("globalThis.Function = globalThis.Function");
        exports.done = true;
      `,
      '/object-literal-eval-alias.cjs': `
        const { x: e } = { x: eval };
        e("globalThis.Function = globalThis.Function");
        exports.done = true;
      `,
    });
    for (const specifier of [
      './with.cjs',
      './eval.cjs',
      './indirect-eval.cjs',
      './global-eval.cjs',
      './computed-global-eval.cjs',
      './eval-string-function-only.cjs',
      './global-eval-alias.cjs',
      './array-eval-alias.cjs',
      './object-literal-eval-alias.cjs',
    ]) {
      expect(() => loader.require(specifier, '/entry.js')).toThrow(
        expect.objectContaining({
          name: 'NotImplementedError',
          feature: 'module-loader.cjs-dynamic-function-scope',
        }) as unknown as Error,
      );
    }
  });

  it('throws a directed ceiling for CJS modules mutating global Function properties', () => {
    const loader = setup({
      '/global-this.cjs': `
        globalThis.Function = function GlobalThisFunction() {};
        exports.name = Function.name;
      `,
      '/global-computed.cjs': `
        globalThis["Function"] = function GlobalComputedFunction() {};
        exports.name = Function.name;
      `,
      '/global-computed-expression.cjs': `
        globalThis["Fun" + "ction"] = function GlobalComputedExpressionFunction() {};
        exports.name = Function.name;
      `,
      '/global-computed-expression-no-function-token.cjs': `
        globalThis["Fun" + "ction"] = globalThis["Fun" + "ction"];
        exports.done = true;
      `,
      '/global-computed-read-no-function-token.cjs': `
        const F = globalThis["Fun" + "ction"];
        exports.name = F.name;
      `,
      '/global-computed-dynamic-read-no-function-token.cjs': `
        const suffix = "ction";
        const F = globalThis["Fun" + suffix];
        exports.value = F("return 1")();
      `,
      '/global-computed-dynamic-write-no-function-token.cjs': `
        const suffix = "ction";
        globalThis["Fun" + suffix] = globalThis["Fun" + suffix];
        exports.done = true;
      `,
      '/node-global.cjs': `
        global.Function = function NodeGlobalFunction() {};
        exports.name = Function.name;
      `,
      '/delete-global.cjs': `
        delete globalThis.Function;
        exports.name = Function.name;
      `,
      '/define-property.cjs': `
        Object.defineProperty(globalThis, "Function", { value: function RedefinedFunction() {} });
        exports.name = Function.name;
      `,
      '/define-properties.cjs': `
        Object.defineProperties(globalThis, { Function: { value: function RedefinedFunction() {} } });
        exports.name = Function.name;
      `,
      '/reflect-set.cjs': `
        Reflect.set(globalThis, "Function", function ReflectSetFunction() {});
        exports.name = Function.name;
      `,
      '/reflect-delete.cjs': `
        Reflect.deleteProperty(globalThis, "Function");
        exports.name = Function.name;
      `,
      '/reflect-get-constructor.cjs': `
        const F = Reflect.get(globalThis, "Function");
        const dyn = F("return 1");
        exports.value = dyn();
      `,
      '/object-assign.cjs': `
        Object.assign(globalThis, { Function: function AssignedFunction() {} });
        exports.name = Function.name;
      `,
      '/object-assign-dynamic.cjs': `
        const patch = { Function: function AssignedDynamicFunction() {} };
        Object.assign(globalThis, patch);
        exports.name = Function.name;
      `,
      '/define-getter.cjs': `
        globalThis.__defineGetter__("Function", () => function GetterFunction() {});
        exports.name = Function.name;
      `,
      '/global-alias.cjs': `
        const g = globalThis;
        g.Function = function AliasFunction() {};
        exports.name = Function.name;
      `,
      '/sloppy-global-alias.cjs': `
        g = globalThis;
        g.Function = g.Function;
        exports.done = true;
      `,
      '/global-destructured-alias.cjs': `
        let g;
        ({ g } = { g: globalThis });
        g.Function = g.Function;
        exports.done = true;
      `,
      '/global-destructured-default-alias.cjs': `
        const { g = globalThis } = {};
        g.Function = g.Function;
        exports.done = true;
      `,
      '/global-destructured-unknown-default-alias.cjs': `
        const source = {};
        const { g = globalThis } = source;
        g.Function = g.Function;
        exports.done = true;
      `,
      '/global-array-unknown-default-alias.cjs': `
        const source = [];
        const [g = globalThis] = source;
        g.Function = g.Function;
        exports.done = true;
      `,
      '/global-default-param-alias.cjs': `
        function mutate(g = globalThis) {
          g.Function = g.Function;
        }
        mutate();
        exports.done = true;
      `,
    });
    for (const specifier of [
      './global-this.cjs',
      './global-computed.cjs',
      './global-computed-expression.cjs',
      './global-computed-expression-no-function-token.cjs',
      './global-computed-read-no-function-token.cjs',
      './global-computed-dynamic-read-no-function-token.cjs',
      './global-computed-dynamic-write-no-function-token.cjs',
      './node-global.cjs',
      './delete-global.cjs',
      './define-property.cjs',
      './define-properties.cjs',
      './reflect-set.cjs',
      './reflect-delete.cjs',
      './reflect-get-constructor.cjs',
      './object-assign.cjs',
      './object-assign-dynamic.cjs',
      './define-getter.cjs',
      './global-alias.cjs',
      './sloppy-global-alias.cjs',
      './global-destructured-alias.cjs',
      './global-destructured-default-alias.cjs',
      './global-destructured-unknown-default-alias.cjs',
      './global-array-unknown-default-alias.cjs',
      './global-default-param-alias.cjs',
    ]) {
      expect(() => loader.require(specifier, '/entry.js')).toThrow(
        expect.objectContaining({
          name: 'NotImplementedError',
          feature: 'module-loader.cjs-global-function-assignment',
        }) as unknown as Error,
      );
    }
  });

  it('binds top-level CJS this to exports like Node', () => {
    const loader = setup({
      '/main.cjs': `
        this.Function = function ThisFunction() {};
        exports.name = Function.name;
        exports.thisName = exports.Function.name;
        exports.thisIsExports = this === exports;
      `,
    });
    expect(loader.require('./main.cjs', '/entry.js')).toMatchObject({
      name: 'Function',
      thisName: 'ThisFunction',
      thisIsExports: true,
    });
  });

  it('does not reject computed CJS global reads that are not Function', () => {
    const loader = setup({
      '/main.cjs': `
        const processValue = globalThis["process"];
        const processKey = "process";
        const dynamicProcessValue = globalThis[processKey];
        exports.hasProcess = typeof processValue;
        exports.hasDynamicProcess = typeof dynamicProcessValue;
        exports.functionName = Function.name;
      `,
    });
    expect(loader.require('./main.cjs', '/entry.js')).toMatchObject({
      functionName: 'Function',
    });
  });

  it('does not treat shadowed CJS Object or Reflect as global mutation helpers', () => {
    const loader = setup({
      '/object.cjs': `
        const Object = { assign() {} };
        Object.assign(globalThis, { Function: function LocalObjectFunction() {} });
        exports.name = Function.name;
      `,
      '/reflect.cjs': `
        const Reflect = { set() { return true; } };
        Reflect.set(globalThis, "Function", function LocalReflectFunction() {});
        exports.name = Function.name;
      `,
    });
    expect(loader.require('./object.cjs', '/entry.js')).toMatchObject({ name: 'Function' });
    expect(loader.require('./reflect.cjs', '/entry.js')).toMatchObject({ name: 'Function' });
  });

  it('does not introduce non-Node async/generator constructor globals in CJS modules', () => {
    const loader = setup({
      '/main.cjs': `
        exports.asyncType = typeof AsyncFunction;
        exports.generatorType = typeof GeneratorFunction;
        exports.asyncGeneratorType = typeof AsyncGeneratorFunction;
      `,
    });
    expect(loader.require('./main.cjs', '/entry.js')).toMatchObject({
      asyncType: 'undefined',
      generatorType: 'undefined',
      asyncGeneratorType: 'undefined',
    });
  });
});

// ADR-0066: tsconfig-style path aliases via the opt-in `paths` resolver option.
// Asserted through `loader.resolver.resolve(...).id` so the resolution algorithm
// is tested directly (no transform hook needed for the resolve step). This is
// rifty-specific behaviour (Node never resolves tsconfig paths) — a conformance
// case, not a parity case.
describe('tsconfig path aliases (ADR-0066)', () => {
  function resolveId(
    files: Record<string, string>,
    paths: Record<string, string | readonly string[]>,
    specifier: string,
    fromFile: string,
  ): string {
    const vfs = new MemoryFsSync();
    vfs.loadFixture(files);
    const loader = createModuleLoader(vfs, { paths });
    return loader.resolver.resolve(specifier, { fromFile, esm: true }).id;
  }

  function tsResolveId(
    files: Record<string, string>,
    specifier: string,
    fromFile: string,
    compilerOptions: ts.CompilerOptions,
  ): string | undefined {
    const fileSet = new Set(Object.keys(files));
    const host: ts.ModuleResolutionHost = {
      fileExists: (path) => fileSet.has(path),
      readFile: (path) => files[path],
      directoryExists: (path) =>
        path === '/' || [...fileSet].some((file) => file.startsWith(`${path}/`)),
      realpath: (path) => path,
      getCurrentDirectory: () => '/',
      getDirectories: () => [],
      useCaseSensitiveFileNames: () => true,
    };
    return ts.resolveModuleName(
      specifier,
      fromFile,
      { ...compilerOptions, moduleResolution: ts.ModuleResolutionKind.Node10 },
      host,
    ).resolvedModule?.resolvedFileName;
  }

  it('wildcard alias maps `@/x` onto the absolute target', () => {
    const id = resolveId(
      { '/proj/src/foo.js': 'export const x = 1;' },
      { '@/*': '/proj/src/*' },
      '@/foo',
      '/proj/app/main.ts',
    );
    expect(id).toBe('/proj/src/foo.js');
  });

  it('resolves a `.ts` extension through an alias (ADR-0053 extension set)', () => {
    const id = resolveId(
      { '/proj/src/account/account.ts': 'export const Account = {};' },
      { '@/*': '/proj/src/*' },
      '@/account/account',
      '/proj/src/server/server.ts',
    );
    expect(id).toBe('/proj/src/account/account.ts');
  });

  it('matches TypeScript extension priority for path aliases when TS and JS siblings exist', () => {
    const files = {
      '/proj/src/foo.js': 'export const runtime = "js";',
      '/proj/src/foo.ts': 'export const runtime: "ts" = "ts";',
    };
    const paths = { '@/*': '/proj/src/*' };
    const gold = tsResolveId(files, '@/foo', '/proj/app.ts', {
      baseUrl: '/proj',
      paths: { '@/*': ['src/*'] },
    });
    expect(gold).toBe('/proj/src/foo.ts');
    expect(resolveId(files, paths, '@/foo', '/proj/app.ts')).toBe(gold);
  });

  it('matches TypeScript index-file priority for path aliases when TS and JS indexes exist', () => {
    const files = {
      '/proj/src/widget/index.js': 'export const runtime = "js";',
      '/proj/src/widget/index.ts': 'export const runtime: "ts" = "ts";',
    };
    const paths = { '@/*': '/proj/src/*' };
    const gold = tsResolveId(files, '@/widget', '/proj/app.ts', {
      baseUrl: '/proj',
      paths: { '@/*': ['src/*'] },
    });
    expect(gold).toBe('/proj/src/widget/index.ts');
    expect(resolveId(files, paths, '@/widget', '/proj/app.ts')).toBe(gold);
  });

  it('most-specific wildcard wins (longest static prefix)', () => {
    const files = {
      '/proj/src/other.js': 'export const a = 1;',
      '/proj/features/x.js': 'export const b = 2;',
    };
    const paths = { '@/*': '/proj/src/*', '@/feat/*': '/proj/features/*' };
    expect(resolveId(files, paths, '@/feat/x', '/proj/app.ts')).toBe('/proj/features/x.js');
    expect(resolveId(files, paths, '@/other', '/proj/app.ts')).toBe('/proj/src/other.js');
  });

  it('an exact (star-less) pattern outranks a wildcard', () => {
    const id = resolveId(
      {
        '/proj/src/special.js': 'export const wrong = 1;',
        '/proj/special-impl.js': 'export const right = 1;',
      },
      { '@/*': '/proj/src/*', '@/special': '/proj/special-impl.js' },
      '@/special',
      '/proj/app.ts',
    );
    expect(id).toBe('/proj/special-impl.js');
  });

  it('tries ordered candidate targets, first existing wins', () => {
    const id = resolveId(
      { '/proj/src/x.js': 'export const x = 1;' },
      { '@/*': ['/proj/missing/*', '/proj/src/*'] },
      '@/x',
      '/proj/app.ts',
    );
    expect(id).toBe('/proj/src/x.js');
  });

  it('off by default — a bare `@/foo` with no paths map is MODULE_NOT_FOUND', () => {
    const vfs = new MemoryFsSync();
    vfs.loadFixture({ '/proj/src/foo.js': 'export const x = 1;' });
    const loader = createModuleLoader(vfs);
    expect(() => loader.resolver.resolve('@/foo', { fromFile: '/proj/app.ts', esm: true })).toThrow(
      /Cannot find module '@\/foo'/,
    );
  });

  it('no false positive — a real `@scope/pkg` still resolves via node_modules', () => {
    const id = resolveId(
      {
        '/proj/node_modules/@scope/pkg/package.json': '{"name":"@scope/pkg","main":"index.js"}',
        '/proj/node_modules/@scope/pkg/index.js': 'module.exports = 1;',
      },
      { '@/*': '/proj/src/*' },
      '@scope/pkg',
      '/proj/app.ts',
    );
    expect(id).toBe('/proj/node_modules/@scope/pkg/index.js');
  });

  it('alias match with no existing target falls through to MODULE_NOT_FOUND', () => {
    const vfs = new MemoryFsSync();
    vfs.loadFixture({ '/proj/src/present.js': 'export const x = 1;' });
    const loader = createModuleLoader(vfs, { paths: { '@/*': '/proj/src/*' } });
    expect(() =>
      loader.resolver.resolve('@/absent', { fromFile: '/proj/app.ts', esm: true }),
    ).toThrow(/Cannot find module '@\/absent'/);
  });

  it('auto-discovers JSONC tsconfig paths when enabled', () => {
    const vfs = new MemoryFsSync();
    vfs.loadFixture({
      '/proj/tsconfig.json':
        '{\n' +
        '  // JSONC must be parsed by TypeScript, not JSON.parse.\n' +
        '  "compilerOptions": {\n' +
        '    "baseUrl": "src",\n' +
        '    "paths": { "@/*": ["*"] },\n' +
        '  },\n' +
        '}\n',
      '/proj/src/foo.ts': 'export const foo = 1;',
    });
    const loader = createModuleLoader(vfs, { autoDiscoverTsconfigPaths: true });
    expect(loader.resolver.resolve('@/foo', { fromFile: '/proj/src/app.ts', esm: true }).id).toBe(
      '/proj/src/foo.ts',
    );
  });

  it('does not parse malformed tsconfig for relative specifiers', () => {
    const vfs = new MemoryFsSync();
    vfs.loadFixture({
      '/proj/tsconfig.json': '{ "compilerOptions": { "paths": { "@/*": ["src/*"] } ',
      '/proj/src/app.js': 'import { dep } from "./dep.js";',
      '/proj/src/dep.js': 'export const dep = 1;',
    });
    const loader = createModuleLoader(vfs, { autoDiscoverTsconfigPaths: true });

    expect(
      loader.resolver.resolve('./dep.js', { fromFile: '/proj/src/app.js', esm: true }).id,
    ).toBe('/proj/src/dep.js');
    let thrown: unknown;
    try {
      loader.resolver.resolve('@/dep', { fromFile: '/proj/src/app.js', esm: true });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toMatchObject({
      name: 'ModuleLoadError',
      code: 'TSCONFIG_PARSE_ERROR',
    });
  });

  it('throws TSCONFIG_PARSE_ERROR for a non-array tsconfig paths entry', () => {
    const vfs = new MemoryFsSync();
    vfs.loadFixture({
      '/proj/tsconfig.json': '{ "compilerOptions": { "paths": { "@/*": "src/*" } } }',
      '/proj/src/app.js': 'import value from "@/dep";',
      '/proj/src/dep.js': 'export default 1;',
    });
    const loader = createModuleLoader(vfs, { autoDiscoverTsconfigPaths: true });

    let thrown: unknown;
    try {
      loader.resolver.resolve('@/dep', { fromFile: '/proj/src/app.js', esm: true });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toMatchObject({
      name: 'ModuleLoadError',
      code: 'TSCONFIG_PARSE_ERROR',
    });
  });

  it('throws TSCONFIG_PARSE_ERROR for non-string tsconfig paths targets', () => {
    const vfs = new MemoryFsSync();
    vfs.loadFixture({
      '/proj/tsconfig.json': '{ "compilerOptions": { "paths": { "@/*": [123] } } }',
      '/proj/src/app.js': 'import value from "@/dep";',
      '/proj/src/dep.js': 'export default 1;',
    });
    const loader = createModuleLoader(vfs, { autoDiscoverTsconfigPaths: true });

    let thrown: unknown;
    try {
      loader.resolver.resolve('@/dep', { fromFile: '/proj/src/app.js', esm: true });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toMatchObject({
      name: 'ModuleLoadError',
      code: 'TSCONFIG_PARSE_ERROR',
    });
  });

  it('auto-discovers tsconfig baseUrl for bare specifiers without paths', () => {
    const vfs = new MemoryFsSync();
    vfs.loadFixture({
      '/proj/tsconfig.json': '{ "compilerOptions": { "baseUrl": "src" } }',
      '/proj/src/lib.ts': 'export const lib = 1;',
    });
    const loader = createModuleLoader(vfs, { autoDiscoverTsconfigPaths: true });
    expect(loader.resolver.resolve('lib', { fromFile: '/proj/src/app.ts', esm: true }).id).toBe(
      '/proj/src/lib.ts',
    );
  });

  it('matches TypeScript extension priority for tsconfig baseUrl when TS and JS siblings exist', () => {
    const files = {
      '/proj/tsconfig.json': '{ "compilerOptions": { "baseUrl": "src" } }',
      '/proj/src/lib.js': 'export const runtime = "js";',
      '/proj/src/lib.ts': 'export const runtime: "ts" = "ts";',
    };
    const gold = tsResolveId(files, 'lib', '/proj/src/app.ts', { baseUrl: '/proj/src' });
    expect(gold).toBe('/proj/src/lib.ts');
    const vfs = new MemoryFsSync();
    vfs.loadFixture(files);
    const loader = createModuleLoader(vfs, { autoDiscoverTsconfigPaths: true });
    expect(loader.resolver.resolve('lib', { fromFile: '/proj/src/app.ts', esm: true }).id).toBe(
      gold,
    );
  });

  it('falls back to tsconfig baseUrl when paths exist but no pattern matches', () => {
    const vfs = new MemoryFsSync();
    vfs.loadFixture({
      '/proj/tsconfig.json':
        '{ "compilerOptions": { "baseUrl": "src", "paths": { "@/*": ["aliases/*"] } } }',
      '/proj/src/lib.ts': 'export const lib = 1;',
      '/proj/src/aliases/foo.ts': 'export const foo = 1;',
    });
    const loader = createModuleLoader(vfs, { autoDiscoverTsconfigPaths: true });
    expect(loader.resolver.resolve('@/foo', { fromFile: '/proj/src/app.ts', esm: true }).id).toBe(
      '/proj/src/aliases/foo.ts',
    );
    expect(loader.resolver.resolve('lib', { fromFile: '/proj/src/app.ts', esm: true }).id).toBe(
      '/proj/src/lib.ts',
    );
  });

  it('does not fall back to tsconfig baseUrl after a matched paths pattern misses', () => {
    const vfs = new MemoryFsSync();
    vfs.loadFixture({
      '/proj/tsconfig.json':
        '{ "compilerOptions": { "baseUrl": "src", "paths": { "@/*": ["aliases/*"] } } }',
      '/proj/src/@/miss.ts': 'export const wrong = 1;',
      '/proj/node_modules/@/miss/package.json': '{"name":"@/miss","exports":"./index.js"}',
      '/proj/node_modules/@/miss/index.js': 'export const pkg = 1;',
    });
    const loader = createModuleLoader(vfs, { autoDiscoverTsconfigPaths: true });
    expect(loader.resolver.resolve('@/miss', { fromFile: '/proj/src/app.ts', esm: true }).id).toBe(
      '/proj/node_modules/@/miss/index.js',
    );
  });

  it('auto-discovery follows extends and resolves inherited targets from the owning config', () => {
    const vfs = new MemoryFsSync();
    vfs.loadFixture({
      '/proj/tsconfig.json': '{ "extends": "../configs/base.json" }',
      '/configs/base.json': '{ "compilerOptions": { "paths": { "~/*": ["../proj/src/*"] } } }',
      '/proj/src/core.ts': 'export const core = 1;',
    });
    const loader = createModuleLoader(vfs, { autoDiscoverTsconfigPaths: true });
    expect(loader.resolver.resolve('~/core', { fromFile: '/proj/src/app.ts', esm: true }).id).toBe(
      '/proj/src/core.ts',
    );
  });

  it('keeps tsconfig discovery off by default', () => {
    const vfs = new MemoryFsSync();
    vfs.loadFixture({
      '/proj/tsconfig.json': '{ "compilerOptions": { "paths": { "@/*": ["src/*"] } } }',
      '/proj/src/foo.ts': 'export const foo = 1;',
    });
    const loader = createModuleLoader(vfs);
    expect(() => loader.resolver.resolve('@/foo', { fromFile: '/proj/app.ts', esm: true })).toThrow(
      /Cannot find module '@\/foo'/,
    );
  });

  it('explicit paths override auto-discovered paths', () => {
    const vfs = new MemoryFsSync();
    vfs.loadFixture({
      '/proj/tsconfig.json': '{ "compilerOptions": { "paths": { "@/*": ["src/*"] } } }',
      '/proj/src/foo.ts': 'export const wrong = 1;',
      '/proj/manual/foo.ts': 'export const right = 1;',
    });
    const loader = createModuleLoader(vfs, {
      autoDiscoverTsconfigPaths: true,
      paths: { '@/*': '/proj/manual/*' },
    });
    expect(loader.resolver.resolve('@/foo', { fromFile: '/proj/app.ts', esm: true }).id).toBe(
      '/proj/manual/foo.ts',
    );
  });

  it('loader invalidation refreshes discovered tsconfig aliases', () => {
    const vfs = new MemoryFsSync();
    vfs.loadFixture({
      '/proj/tsconfig.json': '{ "compilerOptions": { "paths": { "@/*": ["src/*"] } } }',
      '/proj/src/foo.ts': 'export const before = 1;',
      '/proj/alt/foo.ts': 'export const after = 1;',
    });
    const loader = createModuleLoader(vfs, { autoDiscoverTsconfigPaths: true });
    expect(loader.resolver.resolve('@/foo', { fromFile: '/proj/app.ts', esm: true }).id).toBe(
      '/proj/src/foo.ts',
    );
    vfs.writeFileSync(
      '/proj/tsconfig.json',
      new TextEncoder().encode('{ "compilerOptions": { "paths": { "@/*": ["alt/*"] } } }'),
    );
    loader.invalidate();
    expect(loader.resolver.resolve('@/foo', { fromFile: '/proj/app.ts', esm: true }).id).toBe(
      '/proj/alt/foo.ts',
    );
  });
});

// Node resolution order: LOAD_AS_FILE before LOAD_AS_DIRECTORY. A file-with-
// extension sibling wins over a same-named directory. Verified against Node 24
// (`require('./foo')` with both `foo.js` and `foo/index.js` resolves `foo.js`).
// opencode's `./migration` (sibling `migration.ts` barrel + `migration/` SQL-files
// dir with no index) is the motivating real case.
describe('file-before-directory precedence (Node parity)', () => {
  function resolveId(files: Record<string, string>, specifier: string, fromFile: string): string {
    const vfs = new MemoryFsSync();
    vfs.loadFixture(files);
    return createModuleLoader(vfs).resolver.resolve(specifier, { fromFile, esm: false }).id;
  }

  it('`./foo` with both `foo.js` and `foo/index.js` resolves the file', () => {
    const id = resolveId(
      {
        '/app/foo.js': "module.exports = 'file';",
        '/app/foo/index.js': "module.exports = 'dir';",
      },
      './foo',
      '/app/main.js',
    );
    expect(id).toBe('/app/foo.js');
  });

  it('`./migration` resolves the `.ts` barrel over a same-named no-index dir', () => {
    const id = resolveId(
      {
        '/pkg/migration.ts': 'export const DatabaseMigration = {};',
        '/pkg/migration/0001_init.ts': 'export const up = () => {};',
      },
      './migration',
      '/pkg/database.ts',
    );
    expect(id).toBe('/pkg/migration.ts');
  });

  it('directory still resolves when there is no sibling file (no regression)', () => {
    const id = resolveId(
      { '/app/dir/index.js': "module.exports = 'idx';" },
      './dir',
      '/app/main.js',
    );
    expect(id).toBe('/app/dir/index.js');
  });

  it('a sibling file wins over a directory `package.json` main', () => {
    const id = resolveId(
      {
        '/app/lib.js': "module.exports = 'file';",
        '/app/lib/package.json': '{"main": "./entry.js"}',
        '/app/lib/entry.js': "module.exports = 'dir-main';",
      },
      './lib',
      '/app/main.js',
    );
    expect(id).toBe('/app/lib.js');
  });
});
