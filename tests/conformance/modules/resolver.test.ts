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
