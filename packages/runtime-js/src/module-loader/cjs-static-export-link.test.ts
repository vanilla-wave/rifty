import { NotImplementedError } from '@riftydev/io';
import { MemoryFsSync } from '@riftydev/vfs/internal';
import { describe, expect, it } from 'vitest';
import { loadBuiltin } from '../builtins/index.ts';
import { createModuleLoader } from './loader.ts';

const EFFECTS_KEY = '__riftyCjsStaticLinkEffects';

function withEffects(run: (effects: string[]) => void): void {
  const effects: string[] = [];
  Reflect.set(globalThis, EFFECTS_KEY, effects);
  try {
    run(effects);
  } finally {
    Reflect.deleteProperty(globalThis, EFFECTS_KEY);
  }
}

describe('CJS static export link validation', () => {
  it.each([
    {
      name: 'direct edge',
      extraFiles: {} as Record<string, string>,
      source: './value.cjs',
    },
    {
      name: 'ESM export-star edge',
      extraFiles: {
        '/work/bridge.mjs': `
          export * from './value.cjs';
          globalThis.${EFFECTS_KEY}.push('bridge');
        `,
      },
      source: './bridge.mjs',
    },
  ])('rejects a missing name through a $name before any body effect', (fixture) => {
    withEffects((effects) => {
      const vfs = new MemoryFsSync();
      vfs.loadFixture({
        '/work/value.cjs': `
          globalThis.${EFFECTS_KEY}.push('cjs');
          exports.present = 7;
        `,
        '/work/entry.mjs': `
          import { missing } from ${JSON.stringify(fixture.source)};
          globalThis.${EFFECTS_KEY}.push('entry');
          export const result = missing;
        `,
        ...fixture.extraFiles,
      });
      const loader = createModuleLoader(vfs, { cwd: '/work' });

      expect(() => loader.require('./entry.mjs', '/work/entry.cjs')).toThrow(SyntaxError);
      expect(effects).toEqual([]);
    });
  });

  it.each([
    {
      name: 'direct edge',
      extraFiles: {} as Record<string, string>,
      source: './value.cjs',
      effects: ['cjs', 'entry'],
    },
    {
      name: 'ESM export-star edge',
      extraFiles: {
        '/work/bridge.mjs': `
          export * from './value.cjs';
          globalThis.${EFFECTS_KEY}.push('bridge');
        `,
      },
      source: './bridge.mjs',
      effects: ['cjs', 'bridge', 'entry'],
    },
  ])('links a detected exports.present through a $name', (fixture) => {
    withEffects((effects) => {
      const vfs = new MemoryFsSync();
      vfs.loadFixture({
        '/work/value.cjs': `
          globalThis.${EFFECTS_KEY}.push('cjs');
          exports.present = 7;
        `,
        '/work/entry.mjs': `
          import { present } from ${JSON.stringify(fixture.source)};
          globalThis.${EFFECTS_KEY}.push('entry');
          export const result = present;
        `,
        ...fixture.extraFiles,
      });
      const loader = createModuleLoader(vfs, { cwd: '/work' });

      expect(loader.require('./entry.mjs', '/work/entry.cjs')).toMatchObject({ result: 7 });
      expect(effects).toEqual(fixture.effects);
    });
  });

  it('fails an opaque named CJS edge loudly before body effects', () => {
    withEffects((effects) => {
      const vfs = new MemoryFsSync();
      vfs.loadFixture({
        '/work/value.cjs': `
          globalThis.${EFFECTS_KEY}.push('cjs');
          module.exports = require('./target.mjs');
        `,
        '/work/target.mjs': `
          globalThis.${EFFECTS_KEY}.push('target');
          export const present = 7;
        `,
        '/work/entry.mjs': `
          import { present } from './value.cjs';
          globalThis.${EFFECTS_KEY}.push('entry');
          export const result = present;
        `,
      });
      const loader = createModuleLoader(vfs, { cwd: '/work' });

      let error: unknown;
      try {
        loader.require('./entry.mjs', '/work/entry.cjs');
      } catch (caught) {
        error = caught;
      }
      expect(error).toBeInstanceOf(NotImplementedError);
      expect((error as NotImplementedError).feature).toBe('module-loader.cjs-static-named-exports');
      expect(effects).toEqual([]);
    });
  });

  it('supports default and namespace reexports from an opaque CJS surface', () => {
    withEffects((effects) => {
      const vfs = new MemoryFsSync();
      vfs.loadFixture({
        '/work/value.cjs': `
          globalThis.${EFFECTS_KEY}.push('cjs');
          module.exports = require('./target.mjs');
        `,
        '/work/target.mjs': `
          globalThis.${EFFECTS_KEY}.push('target');
          export const present = 7;
        `,
        '/work/bridge.mjs': `
          export { default as value } from './value.cjs';
          export * as namespace from './value.cjs';
        `,
        '/work/entry.mjs': `
          import { namespace, value } from './bridge.mjs';
          export const same = namespace.default === value;
          export const result = value.present;
        `,
      });
      const loader = createModuleLoader(vfs, { cwd: '/work' });

      expect(loader.require('./entry.mjs', '/work/entry.cjs')).toMatchObject({
        same: true,
        result: 7,
      });
      expect(effects).toEqual(['cjs', 'target']);
    });
  });

  it('treats a computed CJS property as a complete missing static name', () => {
    withEffects((effects) => {
      const vfs = new MemoryFsSync();
      vfs.loadFixture({
        '/work/value.cjs': `
          globalThis.${EFFECTS_KEY}.push('cjs');
          const key = 'present';
          exports[key] = 7;
        `,
        '/work/entry.mjs': `
          import { present } from './value.cjs';
          globalThis.${EFFECTS_KEY}.push('entry');
          export const result = present;
        `,
      });
      const loader = createModuleLoader(vfs, { cwd: '/work' });

      expect(() => loader.require('./entry.mjs', '/work/entry.cjs')).toThrow(SyntaxError);
      expect(effects).toEqual([]);
    });
  });

  it('links a safe defineProperty name overwritten by a throwing getter', () => {
    withEffects((effects) => {
      const vfs = new MemoryFsSync();
      vfs.loadFixture({
        '/work/value.cjs': `
          Object.defineProperty(exports, 'x', { value: 1, configurable: true });
          Object.defineProperty(exports, 'x', {
            enumerable: true,
            configurable: true,
            get() {
              globalThis.${EFFECTS_KEY}.push('getter');
              throw new Error('getter-boom');
            },
          });
        `,
        '/work/entry.mjs': `
          import { x } from './value.cjs';
          globalThis.${EFFECTS_KEY}.push('entry');
          export const result = x;
        `,
      });
      const loader = createModuleLoader(vfs, { cwd: '/work' });

      const result = loader.require('./entry.mjs', '/work/entry.cjs') as Record<string, unknown>;

      expect(Object.hasOwn(result, 'result')).toBe(true);
      expect(result.result).toBeUndefined();
      expect(effects).toEqual(['getter', 'entry']);
    });
  });

  it('does not turn an ill-formed defineProperty key into a static name', () => {
    const vfs = new MemoryFsSync();
    vfs.loadFixture({
      '/work/value.cjs': `
        Object.defineProperty(exports, '\\uD800', { value: 1 });
      `,
      '/work/entry.mjs': `
        import * as namespace from './value.cjs';
        export const keys = Object.keys(namespace);
      `,
    });
    const loader = createModuleLoader(vfs, { cwd: '/work' });

    expect(loader.require('./entry.mjs', '/work/entry.cjs')).toMatchObject({
      keys: ['default', 'module.exports'],
    });
  });

  it('matches Node 24 by omitting an undetected object-literal runtime key', () => {
    const vfs = new MemoryFsSync();
    vfs.loadFixture({
      '/work/value.cjs': 'module.exports = { runtimeOnly: 7 };',
      '/work/namespace.mjs': `
        import * as namespace from './value.cjs';
        export const keys = Object.keys(namespace);
        export const hasRuntimeOnly = Object.hasOwn(namespace, 'runtimeOnly');
        export const outerValue = namespace.default.runtimeOnly;
      `,
      '/work/named.mjs': `
        import { runtimeOnly } from './value.cjs';
        export const result = runtimeOnly;
      `,
    });
    const loader = createModuleLoader(vfs, { cwd: '/work' });

    const result = loader.require('./namespace.mjs', '/work/entry.cjs');
    expect(result).toMatchObject({
      keys: ['default', 'module.exports'],
      hasRuntimeOnly: false,
      outerValue: 7,
    });
    expect(() => loader.require('./named.mjs', '/work/entry.cjs')).toThrow(SyntaxError);
  });

  it.each([
    {
      name: 'JSON',
      requireTarget: './data.json',
      extraFiles: { '/work/data.json': JSON.stringify({ x: 7 }) } as Record<string, string>,
      outerResult: 'namespace.default.x',
      expected: 7,
      missingName: 'x',
    },
    {
      name: 'builtin',
      requireTarget: 'node:path',
      extraFiles: {} as Record<string, string>,
      outerResult: "namespace.default.join('a', 'b')",
      expected: 'a/b',
      missingName: 'join',
    },
  ])('does not propagate $name keys through a CJS reexport', (fixture) => {
    withEffects((effects) => {
      const vfs = new MemoryFsSync();
      vfs.loadFixture({
        '/work/value.cjs': `
          globalThis.${EFFECTS_KEY}.push('cjs');
          module.exports = require(${JSON.stringify(fixture.requireTarget)});
        `,
        '/work/namespace.mjs': `
          import * as namespace from './value.cjs';
          export const keys = Object.keys(namespace);
          export const result = ${fixture.outerResult};
        `,
        '/work/named.mjs': `
          import { ${fixture.missingName} } from './value.cjs';
          globalThis.${EFFECTS_KEY}.push('entry');
          export const result = ${fixture.missingName};
        `,
        ...fixture.extraFiles,
      });
      const loader = createModuleLoader(vfs, { cwd: '/work' });

      expect(() => loader.require('./named.mjs', '/work/entry.cjs')).toThrow(SyntaxError);
      expect(effects).toEqual([]);
      expect(loader.require('./namespace.mjs', '/work/entry.cjs')).toMatchObject({
        keys: ['default', 'module.exports'],
        result: fixture.expected,
      });
      expect(effects).toEqual(['cjs']);
    });
  });

  it('admits only the delivered enumerable builtin runtime surface', () => {
    const util = loadBuiltin('node:util');
    if (util === null) throw new Error('node:util builtin is not registered');
    Object.defineProperty(util, 'nonEnumerableRuntimeOnly', {
      configurable: true,
      value: 1,
    });
    try {
      const vfs = new MemoryFsSync();
      vfs.loadFixture({
        '/work/valid.mjs': `
          import { formatWithOptions } from 'node:util';
          export const result = formatWithOptions({ depth: 0 }, '%O', { nested: { value: 1 } });
        `,
        '/work/missing.mjs': `
          import { nonEnumerableRuntimeOnly } from 'node:util';
          globalThis.${EFFECTS_KEY}.push('entry');
          export const result = nonEnumerableRuntimeOnly;
        `,
      });
      const loader = createModuleLoader(vfs, { cwd: '/work' });

      expect(loader.require('./valid.mjs', '/work/entry.cjs')).toMatchObject({
        result: '{ nested: [Object] }',
      });
      withEffects((effects) => {
        expect(() => loader.require('./missing.mjs', '/work/entry.cjs')).toThrow(SyntaxError);
        expect(effects).toEqual([]);
      });
    } finally {
      Reflect.deleteProperty(util, 'nonEnumerableRuntimeOnly');
    }
  });

  it('re-lexes a repaired CJS surface after coherent invalidation', () => {
    withEffects((effects) => {
      const vfs = new MemoryFsSync();
      vfs.loadFixture({
        '/work/value.cjs': 'exports.old = 1;',
        '/work/entry.mjs': `
          import { fresh } from './value.cjs';
          globalThis.${EFFECTS_KEY}.push('entry');
          export const result = fresh;
        `,
      });
      const loader = createModuleLoader(vfs, { cwd: '/work' });

      expect(() => loader.require('./entry.mjs', '/work/entry.cjs')).toThrow(SyntaxError);
      vfs.loadFixture({
        '/work/value.cjs': `
          globalThis.${EFFECTS_KEY}.push('cjs');
          exports.fresh = 9;
        `,
      });
      loader.invalidate('/work/value.cjs');

      expect(loader.require('./entry.mjs', '/work/entry.cjs')).toMatchObject({ result: 9 });
      expect(effects).toEqual(['cjs', 'entry']);
    });
  });

  it('rebuilds a reexport surface when its child is invalidated', () => {
    const vfs = new MemoryFsSync();
    vfs.loadFixture({
      '/work/child.cjs': 'exports.old = 1;',
      '/work/value.cjs': "module.exports = require('./child.cjs');",
      '/work/entry.mjs': `
        import { fresh } from './value.cjs';
        export const result = fresh;
      `,
    });
    const loader = createModuleLoader(vfs, { cwd: '/work' });

    expect(() => loader.require('./entry.mjs', '/work/entry.cjs')).toThrow(SyntaxError);
    vfs.loadFixture({ '/work/child.cjs': 'exports.fresh = 11;' });
    loader.invalidate('/work/child.cjs');

    expect(loader.require('./entry.mjs', '/work/entry.cjs')).toMatchObject({ result: 11 });
  });

  it('retries a lexer parse failure after source repair', () => {
    const vfs = new MemoryFsSync();
    vfs.loadFixture({
      '/work/value.cjs': 'export const present = 1;',
      '/work/entry.mjs': `
        import { present } from './value.cjs';
        export const result = present;
      `,
    });
    const loader = createModuleLoader(vfs, { cwd: '/work' });

    expect(() => loader.require('./entry.mjs', '/work/entry.cjs')).toThrow();
    vfs.loadFixture({ '/work/value.cjs': 'exports.present = 13;' });
    loader.invalidate('/work/value.cjs');

    expect(loader.require('./entry.mjs', '/work/entry.cjs')).toMatchObject({ result: 13 });
  });
});
