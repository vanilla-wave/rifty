import { MemoryFsSync } from '@riftydev/vfs/internal';
import { describe, expect, it } from 'vitest';
import { createModuleLoader } from './loader.ts';

describe('ESM job graph regressions', () => {
  it('preserves new-expression precedence for every static import form', () => {
    const vfs = new MemoryFsSync();
    vfs.loadFixture({
      '/work/constructors.mjs': `
        export class Named { value = 'named'; }
        export default class Default { value = 'default'; }
      `,
      '/work/entry.mjs': `
        import Default, { Named } from './constructors.mjs';
        import * as constructors from './constructors.mjs';
        export const values = [
          new Named().value,
          new Default().value,
          new constructors.Named().value,
        ];
      `,
    });
    const loader = createModuleLoader(vfs, { cwd: '/work' });

    expect(loader.require('./entry.mjs', '/work/entry.cjs')).toMatchObject({
      values: ['named', 'default', 'named'],
    });
  });

  it('publishes cyclic export-star names before evaluation', () => {
    const vfs = new MemoryFsSync();
    vfs.loadFixture({
      '/work/a.mjs': "export const a = 'A'; export * from './b.mjs';",
      '/work/b.mjs': "export * from './a.mjs'; export const b = 'B';",
    });
    const loader = createModuleLoader(vfs, { cwd: '/work' });

    const a = loader.require('./a.mjs', '/work/entry.cjs') as Record<string, unknown>;
    const b = loader.require('./b.mjs', '/work/entry.cjs') as Record<string, unknown>;

    expect({
      a: Object.keys(a),
      b: Object.keys(b),
      ba: b.a,
      bb: b.b,
    }).toEqual({ a: ['a', 'b'], b: ['a', 'b'], ba: 'A', bb: 'B' });
  });

  it('starts later sibling branches while an earlier branch awaits', async () => {
    const effects: string[] = [];
    Reflect.set(globalThis, '__riftySiblingEffects', effects);
    const vfs = new MemoryFsSync();
    vfs.loadFixture({
      '/work/a.mjs': `
        import './b.mjs';
        import './c.mjs';
        globalThis.__riftySiblingEffects.push('a');
      `,
      '/work/b.mjs': `
        globalThis.__riftySiblingEffects.push('b-start');
        await Promise.resolve();
        globalThis.__riftySiblingEffects.push('b-end');
      `,
      '/work/c.mjs': "globalThis.__riftySiblingEffects.push('c');",
    });
    const loader = createModuleLoader(vfs, { cwd: '/work' });

    try {
      await loader.import('./a.mjs', '/work/entry.cjs');
      expect(effects).toEqual(['b-start', 'c', 'b-end', 'a']);
    } finally {
      Reflect.deleteProperty(globalThis, '__riftySiblingEffects');
    }
  });

  it('gives transitive TLA precedence over a direct CJS back-edge', async () => {
    const vfs = new MemoryFsSync();
    vfs.loadFixture({
      '/work/a.mjs': "import './b.cjs'; await 0; export const a = 1;",
      '/work/b.cjs': "module.exports = require('./a.mjs');",
    });
    const loader = createModuleLoader(vfs, { cwd: '/work' });

    let error: unknown;
    try {
      await loader.import('./a.mjs', '/work/entry.cjs');
    } catch (caught) {
      error = caught;
    }

    expect(error).toMatchObject({ name: 'Error', code: 'ERR_REQUIRE_ASYNC_MODULE' });
  });

  it('omits ambiguous star bindings but retains the same binding through two paths', () => {
    const vfs = new MemoryFsSync();
    vfs.loadFixture({
      '/work/a.mjs': 'export const x = 1;',
      '/work/b.mjs': 'export const x = 2;',
      '/work/ambiguous.mjs': "export * from './a.mjs'; export * from './b.mjs';",
      '/work/base.mjs': 'export const shared = 3;',
      '/work/left.mjs': "import { shared } from './base.mjs'; export { shared };",
      '/work/right.mjs': "import { shared } from './base.mjs'; export { shared };",
      '/work/same.mjs': "export * from './left.mjs'; export * from './right.mjs';",
    });
    const loader = createModuleLoader(vfs, { cwd: '/work' });

    const ambiguous = loader.require('./ambiguous.mjs', '/work/entry.cjs') as Record<
      string,
      unknown
    >;
    const same = loader.require('./same.mjs', '/work/entry.cjs') as Record<string, unknown>;

    expect(Object.keys(ambiguous)).toEqual([]);
    expect(ambiguous.x).toBeUndefined();
    expect(same).toMatchObject({ shared: 3 });
  });

  it('rejects a missing named import before body side effects', () => {
    Reflect.set(globalThis, '__riftyMissingImportEffects', 0);
    const vfs = new MemoryFsSync();
    vfs.loadFixture({
      '/work/entry.mjs': `
        import { missing } from './dep.mjs';
        globalThis.__riftyMissingImportEffects += 1;
        export const value = missing;
      `,
      '/work/dep.mjs': 'export const present = 1;',
    });
    const loader = createModuleLoader(vfs, { cwd: '/work' });

    try {
      expect(() => loader.require('./entry.mjs', '/work/entry.cjs')).toThrow(SyntaxError);
      expect(Reflect.get(globalThis, '__riftyMissingImportEffects')).toBe(0);
    } finally {
      Reflect.deleteProperty(globalThis, '__riftyMissingImportEffects');
    }
  });

  it('defers named validation through an opaque CJS export-star edge', () => {
    const vfs = new MemoryFsSync();
    vfs.loadFixture({
      '/work/value.cjs': 'exports.x = 1;',
      '/work/bridge.mjs': "export * from './value.cjs';",
      '/work/entry.mjs': "import { x } from './bridge.mjs'; export { x };",
    });
    const loader = createModuleLoader(vfs, { cwd: '/work' });

    const namespace = loader.require('./entry.mjs', '/work/entry.cjs') as Record<string, unknown>;

    expect(namespace.x).toBe(1);
  });

  it.each([
    {
      name: 'direct import',
      entry: "import { missing } from './value.cjs'; globalThis.__riftyCjsLinkEffects += 1;",
    },
    {
      name: 'export-star bridge',
      entry: "import { missing } from './bridge.mjs'; globalThis.__riftyCjsLinkEffects += 1;",
    },
  ])('rejects a missing CJS named export through a $name before evaluation', (fixture) => {
    Reflect.set(globalThis, '__riftyCjsLinkEffects', 0);
    const vfs = new MemoryFsSync();
    vfs.loadFixture({
      '/work/value.cjs': `
        globalThis.__riftyCjsLinkEffects += 10;
        exports.present = 1;
      `,
      '/work/bridge.mjs': "export * from './value.cjs';",
      '/work/entry.mjs': fixture.entry,
    });
    const loader = createModuleLoader(vfs, { cwd: '/work' });

    try {
      expect(() => loader.require('./entry.mjs', '/work/entry.cjs')).toThrow(SyntaxError);
      expect(Reflect.get(globalThis, '__riftyCjsLinkEffects')).toBe(0);
    } finally {
      Reflect.deleteProperty(globalThis, '__riftyCjsLinkEffects');
    }
  });

  it('resolves a valid named reexport from CJS', () => {
    const vfs = new MemoryFsSync();
    vfs.loadFixture({
      '/work/value.cjs': 'exports.x = 1;',
      '/work/bridge.mjs': "export { x } from './value.cjs';",
      '/work/entry.mjs': "import { x } from './bridge.mjs'; export { x };",
    });
    const loader = createModuleLoader(vfs, { cwd: '/work' });

    const namespace = loader.require('./entry.mjs', '/work/entry.cjs') as Record<string, unknown>;

    expect(namespace.x).toBe(1);
  });

  it('omits a runtime-ambiguous export from two opaque CJS stars', () => {
    const vfs = new MemoryFsSync();
    vfs.loadFixture({
      '/work/a.cjs': 'exports.x = 1;',
      '/work/b.cjs': 'exports.x = 2;',
      '/work/entry.mjs': "export * from './a.cjs'; export * from './b.cjs';",
    });
    const loader = createModuleLoader(vfs, { cwd: '/work' });

    const namespace = loader.require('./entry.mjs', '/work/entry.cjs') as Record<string, unknown>;

    expect(Object.keys(namespace)).toEqual([]);
    expect(namespace.x).toBeUndefined();
  });

  it('instantiates function and var exports before cyclic dependency evaluation', () => {
    const vfs = new MemoryFsSync();
    vfs.loadFixture({
      '/work/function-a.mjs': `
        import { b } from './function-b.mjs';
        export function f() { return 'A'; }
        export const result = b;
      `,
      '/work/function-b.mjs': `
        import { f } from './function-a.mjs';
        export const b = f();
      `,
      '/work/var-a.mjs': `
        import { b } from './var-b.mjs';
        export var x = 1;
        export const result = b;
      `,
      '/work/var-b.mjs': `
        import { x } from './var-a.mjs';
        export const b = x;
      `,
    });
    const loader = createModuleLoader(vfs, { cwd: '/work' });

    const functionResult = loader.require('./function-a.mjs', '/work/entry.cjs') as Record<
      string,
      unknown
    >;
    const varResult = loader.require('./var-a.mjs', '/work/entry.cjs') as Record<string, unknown>;

    expect(functionResult.result).toBe('A');
    expect(varResult.result).toBeUndefined();
  });

  it('instantiates module-scoped loop vars before async cyclic evaluation', async () => {
    const vfs = new MemoryFsSync();
    vfs.loadFixture({
      '/work/a.mjs': `
        import { before } from './b.mjs';
        for (var x of [1]) {}
        await 0;
        export { x };
        export const observed = before;
      `,
      '/work/b.mjs': `
        import { x } from './a.mjs';
        export const before = x;
      `,
    });
    const loader = createModuleLoader(vfs, { cwd: '/work' });

    const namespace = await loader.import('./a.mjs', '/work/entry.cjs');

    expect(namespace.observed).toBeUndefined();
    expect(namespace.x).toBe(1);
  });

  it('instantiates imported bindings used by hoisted functions', () => {
    const vfs = new MemoryFsSync();
    vfs.loadFixture({
      '/work/a.mjs': `
        import { x } from './x.mjs';
        import { b } from './b.mjs';
        export function f() { return x; }
        export const result = b;
      `,
      '/work/b.mjs': `
        import { f } from './a.mjs';
        export const b = f();
      `,
      '/work/x.mjs': "export const x = 'X';",
    });
    const loader = createModuleLoader(vfs, { cwd: '/work' });

    const namespace = loader.require('./a.mjs', '/work/entry.cjs') as Record<string, unknown>;

    expect(namespace.result).toBe('X');
  });

  it('instantiates anonymous default functions before cyclic dependency evaluation', () => {
    const vfs = new MemoryFsSync();
    vfs.loadFixture({
      '/work/a.mjs': `
        import { b } from './b.mjs';
        export default function() { return 'A'; }
        export const result = b;
      `,
      '/work/b.mjs': `
        import f from './a.mjs';
        export const b = f();
      `,
    });
    const loader = createModuleLoader(vfs, { cwd: '/work' });

    const namespace = loader.require('./a.mjs', '/work/entry.cjs') as Record<string, unknown>;

    expect(namespace.result).toBe('A');
  });

  it('preserves lexical TDZ through cyclic imports', () => {
    const vfs = new MemoryFsSync();
    vfs.loadFixture({
      '/work/a.mjs': `
        import { b } from './b.mjs';
        export const x = 1;
        export const result = b;
      `,
      '/work/b.mjs': `
        import { x } from './a.mjs';
        export const b = x;
      `,
    });
    const loader = createModuleLoader(vfs, { cwd: '/work' });

    expect(() => loader.require('./a.mjs', '/work/entry.cjs')).toThrow(ReferenceError);
  });

  it('keeps a shared dependency alive when a concurrent root fails to link', async () => {
    const vfs = new MemoryFsSync();
    vfs.loadFixture({
      '/work/shared.mjs': 'export const ok = 7;',
      '/work/bad.mjs': "import { missing } from './shared.mjs'; export const x = missing;",
      '/work/good.mjs': "import { ok } from './shared.mjs'; export { ok };",
    });
    const loader = createModuleLoader(vfs, { cwd: '/work' });

    const [bad, good] = await Promise.allSettled([
      loader.import('./bad.mjs', '/work/entry.cjs'),
      loader.import('./good.mjs', '/work/entry.cjs'),
    ]);

    expect(bad).toMatchObject({ status: 'rejected', reason: { name: 'SyntaxError' } });
    expect(good).toMatchObject({ status: 'fulfilled', value: { ok: 7 } });
  });

  it.each([
    {
      name: 'ESM',
      dependencyFile: '/work/first.mjs',
      dependencySource: `
        globalThis.__riftyMicrotaskEffects.push('first');
        queueMicrotask(() => globalThis.__riftyMicrotaskEffects.push('micro'));
      `,
    },
    {
      name: 'CJS',
      dependencyFile: '/work/first.cjs',
      dependencySource: `
        globalThis.__riftyMicrotaskEffects.push('first');
        queueMicrotask(() => globalThis.__riftyMicrotaskEffects.push('micro'));
      `,
    },
  ])('keeps synchronous $name dependencies in one evaluation turn', async (fixture) => {
    const effects: string[] = [];
    Reflect.set(globalThis, '__riftyMicrotaskEffects', effects);
    const vfs = new MemoryFsSync();
    vfs.loadFixture({
      '/work/root.mjs': `
        import './${fixture.dependencyFile.split('/').at(-1)}';
        import './later.mjs';
        globalThis.__riftyMicrotaskEffects.push('root');
      `,
      [fixture.dependencyFile]: fixture.dependencySource,
      '/work/later.mjs': "globalThis.__riftyMicrotaskEffects.push('later');",
    });
    const loader = createModuleLoader(vfs, { cwd: '/work' });

    try {
      await loader.import('./root.mjs', '/work/entry.cjs');
      expect(effects).toEqual(['first', 'later', 'root', 'micro']);
    } finally {
      Reflect.deleteProperty(globalThis, '__riftyMicrotaskEffects');
    }
  });

  it('evaluates top-level for-await over a synchronous iterable', async () => {
    const vfs = new MemoryFsSync();
    vfs.loadFixture({
      '/work/entry.mjs': `
        export const out = [];
        for await (const value of [1, 2]) out.push(value);
      `,
    });
    const loader = createModuleLoader(vfs, { cwd: '/work' });

    const namespace = await loader.import('./entry.mjs', '/work/entry.cjs');

    expect(namespace.out).toEqual([1, 2]);
  });

  it('exposes a CJS default binding before the CJS body evaluates', async () => {
    const vfs = new MemoryFsSync();
    vfs.loadFixture({
      '/work/root.mjs': `
        import { call } from './child.mjs';
        import value from './value.cjs';
        export function read() { return value; }
        export const out = call;
      `,
      '/work/child.mjs': `
        import { read } from './root.mjs';
        export const call = read();
      `,
      '/work/value.cjs': 'module.exports = 7;',
    });
    const loader = createModuleLoader(vfs, { cwd: '/work' });

    const namespace = await loader.import('./root.mjs', '/work/entry.cjs');

    expect(namespace.out).toBeUndefined();
  });

  it('instantiates a local CJS reexport before cyclic dependency evaluation', () => {
    const vfs = new MemoryFsSync();
    vfs.loadFixture({
      '/work/root.mjs': `
        import { call } from './child.mjs';
        import value from './value.cjs';
        export { value };
        export const out = call;
      `,
      '/work/child.mjs': `
        import { value } from './root.mjs';
        export const call = value;
      `,
      '/work/value.cjs': 'module.exports = 7;',
    });
    const loader = createModuleLoader(vfs, { cwd: '/work' });

    const namespace = loader.require('./root.mjs', '/work/entry.cjs') as Record<string, unknown>;

    expect(namespace.out).toBeUndefined();
    expect(namespace.value).toBe(7);
  });

  it.each([
    {
      name: 'named reexport',
      rootExport: "export { default as value } from './value.cjs';",
      childRead: 'value',
      finalValue: (value: unknown) => value,
    },
    {
      name: 'namespace reexport',
      rootExport: "export * as value from './value.cjs';",
      childRead: 'value.default',
      finalValue: (value: unknown) => (value as Record<string, unknown>).default,
    },
  ])('instantiates a CJS $name before cyclic dependency evaluation', (fixture) => {
    const vfs = new MemoryFsSync();
    vfs.loadFixture({
      '/work/root.mjs': `
        import { call } from './child.mjs';
        ${fixture.rootExport}
        export const out = call;
      `,
      '/work/child.mjs': `
        import { value } from './root.mjs';
        export const call = ${fixture.childRead};
      `,
      '/work/value.cjs': 'module.exports = 7;',
    });
    const loader = createModuleLoader(vfs, { cwd: '/work' });

    const namespace = loader.require('./root.mjs', '/work/entry.cjs') as Record<string, unknown>;

    expect(namespace.out).toBeUndefined();
    expect(fixture.finalValue(namespace.value)).toBe(7);
  });

  it('publishes statically known CJS export-star names before cyclic evaluation', async () => {
    const vfs = new MemoryFsSync();
    vfs.loadFixture({
      '/work/root.mjs': `
        import { call, keys } from './child.mjs';
        export * from './value.cjs';
        export const out = call;
        export const linkedKeys = keys;
      `,
      '/work/child.mjs': `
        import * as root from './root.mjs';
        export const call = root.x;
        export const keys = Reflect.ownKeys(root).filter((key) => typeof key === 'string');
      `,
      '/work/value.cjs': 'exports.x = 7;',
    });
    const loader = createModuleLoader(vfs, { cwd: '/work' });

    const namespace = await loader.import('./root.mjs', '/work/entry.cjs');
    const child = await loader.import('./child.mjs', '/work/entry.cjs');
    const linkedKeys = ['linkedKeys', 'module.exports', 'out', 'x'];

    expect(namespace.out).toBeUndefined();
    expect(namespace.x).toBe(7);
    expect(child.keys).toEqual(linkedKeys);
    expect(namespace.linkedKeys).toEqual(linkedKeys);
  });

  it.each([
    {
      name: 'CJS',
      failFile: '/work/fail.cjs',
      failSource: "globalThis.__riftyAbruptEffects.push('fail'); throw new Error('boom');",
      importSource: "import './fail.cjs'; import './later.mjs';",
    },
    {
      name: 'ESM',
      failFile: '/work/fail.mjs',
      failSource: "globalThis.__riftyAbruptEffects.push('fail'); throw new Error('boom');",
      importSource: "import './fail.mjs'; import './later.mjs';",
    },
  ])('does not start later siblings after a synchronous $name failure', async (fixture) => {
    const effects: string[] = [];
    Reflect.set(globalThis, '__riftyAbruptEffects', effects);
    const vfs = new MemoryFsSync();
    vfs.loadFixture({
      '/work/root.mjs': fixture.importSource,
      [fixture.failFile]: fixture.failSource,
      '/work/later.mjs': "globalThis.__riftyAbruptEffects.push('later');",
    });
    const loader = createModuleLoader(vfs, { cwd: '/work' });

    try {
      await expect(loader.import('./root.mjs', '/work/entry.cjs')).rejects.toThrow('boom');
      expect(effects).toEqual(['fail']);
    } finally {
      Reflect.deleteProperty(globalThis, '__riftyAbruptEffects');
    }
  });
});
