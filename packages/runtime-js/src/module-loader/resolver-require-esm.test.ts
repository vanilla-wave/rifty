import { MemoryFsSync } from '@riftydev/vfs/internal';
import { describe, expect, it } from 'vitest';
import { createResolver } from './resolver.ts';

function setup(files: Readonly<Record<string, string>>): ReturnType<typeof createResolver> {
  const vfs = new MemoryFsSync();
  vfs.loadFixture(files);
  return createResolver(vfs);
}

describe('Node 24 require resolution profile', () => {
  it('falls back only to .js/.json/.node and their directory indexes', () => {
    const resolver = setup({
      '/app/js.js': '',
      '/app/data.json': '{}',
      '/app/native.node': '',
      '/app/esm.mjs': 'export const value = 1;',
      '/app/cjs.cjs': 'module.exports = 1;',
      '/app/typed.ts': 'export const value: number = 1;',
      '/app/view.tsx': 'export const view = <div />;',
      '/app/js-dir/index.js': '',
      '/app/json-dir/index.json': '{}',
      '/app/node-dir/index.node': '',
      '/app/esm-dir/index.mjs': 'export const value = 1;',
      '/app/cjs-dir/index.cjs': 'module.exports = 1;',
      '/app/ts-dir/index.ts': 'export const value: number = 1;',
      '/app/tsx-dir/index.tsx': 'export const view = <div />;',
    });
    const opts = { fromFile: '/app/entry.cjs', esm: false } as const;

    expect(resolver.resolve('./js', opts).id).toBe('/app/js.js');
    expect(resolver.resolve('./data', opts).id).toBe('/app/data.json');
    expect(resolver.resolve('./native', opts).id).toBe('/app/native.node');
    expect(resolver.resolve('./js-dir', opts).id).toBe('/app/js-dir/index.js');
    expect(resolver.resolve('./json-dir', opts).id).toBe('/app/json-dir/index.json');
    expect(resolver.resolve('./node-dir', opts).id).toBe('/app/node-dir/index.node');

    for (const specifier of [
      './esm',
      './cjs',
      './typed',
      './view',
      './esm-dir',
      './cjs-dir',
      './ts-dir',
      './tsx-dir',
    ]) {
      expect(() => resolver.resolve(specifier, opts)).toThrow(/Cannot find module/);
    }

    // The narrow fallback does not ban an explicitly named ESM/CJS file.
    expect(resolver.resolve('./esm.mjs', opts)).toMatchObject({
      id: '/app/esm.mjs',
      kind: 'esm',
    });
    expect(resolver.resolve('./cjs.cjs', opts)).toMatchObject({
      id: '/app/cjs.cjs',
      kind: 'cjs',
    });
  });

  it('keeps ADR-0053 import fallback separate from require fallback', () => {
    const resolver = setup({
      '/app/esm.mjs': '',
      '/app/cjs.cjs': '',
      '/app/typed.ts': '',
      '/app/view.tsx': '',
      '/app/typed-dir/index.ts': '',
    });
    const opts = { fromFile: '/app/entry.mjs', esm: true } as const;

    expect(resolver.resolve('./esm', opts).id).toBe('/app/esm.mjs');
    expect(resolver.resolve('./cjs', opts).id).toBe('/app/cjs.cjs');
    expect(resolver.resolve('./typed', opts).id).toBe('/app/typed.ts');
    expect(resolver.resolve('./view', opts).id).toBe('/app/view.tsx');
    expect(resolver.resolve('./typed-dir', opts).id).toBe('/app/typed-dir/index.ts');
  });

  it('ignores package.json module for require and retains the existing import behavior', () => {
    const resolver = setup({
      '/app/node_modules/module-only/package.json': JSON.stringify({
        type: 'module',
        module: './entry.mjs',
      }),
      '/app/node_modules/module-only/entry.mjs': 'export const value = 1;',
      '/app/node_modules/main-extensionless/package.json': JSON.stringify({
        type: 'module',
        main: './entry',
      }),
      '/app/node_modules/main-extensionless/entry.mjs': 'export const value = 2;',
    });

    expect(() =>
      resolver.resolve('module-only', { fromFile: '/app/entry.cjs', esm: false }),
    ).toThrow(/Cannot find module/);
    expect(resolver.resolve('module-only', { fromFile: '/app/entry.mjs', esm: true }).id).toBe(
      '/app/node_modules/module-only/entry.mjs',
    );
    expect(() =>
      resolver.resolve('main-extensionless', { fromFile: '/app/entry.cjs', esm: false }),
    ).toThrow(/Cannot find module/);
  });
});

describe('Node 24 module-sync conditions', () => {
  const files = {
    '/app/node_modules/sync-first/package.json': JSON.stringify({
      exports: { 'module-sync': './sync.js', default: './default.js' },
    }),
    '/app/node_modules/sync-first/sync.js': '',
    '/app/node_modules/sync-first/default.js': '',
    '/app/node_modules/default-first/package.json': JSON.stringify({
      exports: { default: './default.js', 'module-sync': './sync.js' },
    }),
    '/app/node_modules/default-first/default.js': '',
    '/app/node_modules/default-first/sync.js': '',
    '/app/node_modules/mode-split/package.json': JSON.stringify({
      exports: {
        import: './import.js',
        require: './require.js',
        'module-sync': './sync.js',
        default: './default.js',
      },
    }),
    '/app/node_modules/mode-split/import.js': '',
    '/app/node_modules/mode-split/require.js': '',
    '/app/node_modules/mode-split/sync.js': '',
    '/app/node_modules/mode-split/default.js': '',
    '/scope/package.json': JSON.stringify({
      imports: {
        '#choice': { 'module-sync': './sync.js', default: './default.js' },
        '#ordered': { default: './default.js', 'module-sync': './sync.js' },
      },
    }),
    '/scope/sync.js': '',
    '/scope/default.js': '',
  } as const;

  it('activates module-sync for import and require while preserving key order', () => {
    const resolver = setup(files);
    const required = { fromFile: '/app/entry.cjs', esm: false } as const;
    const imported = { fromFile: '/app/entry.mjs', esm: true } as const;

    expect(resolver.resolve('sync-first', required).id).toMatch(/\/sync\.js$/);
    expect(resolver.resolve('sync-first', imported).id).toMatch(/\/sync\.js$/);
    expect(resolver.resolve('default-first', required).id).toMatch(/\/default\.js$/);
    expect(resolver.resolve('default-first', imported).id).toMatch(/\/default\.js$/);
    expect(resolver.resolve('mode-split', required).id).toMatch(/\/require\.js$/);
    expect(resolver.resolve('mode-split', imported).id).toMatch(/\/import\.js$/);
  });

  it('uses the same ordered condition walker for package imports', () => {
    const resolver = setup(files);

    for (const esm of [false, true]) {
      expect(resolver.resolve('#choice', { fromFile: '/scope/entry.js', esm }).id).toBe(
        '/scope/sync.js',
      );
      expect(resolver.resolve('#ordered', { fromFile: '/scope/entry.js', esm }).id).toBe(
        '/scope/default.js',
      );
    }
  });
});

describe('package target exact resolution', () => {
  it('does not apply legacy suffix fallback to package imports targets', () => {
    const resolver = setup({
      '/scope/package.json': JSON.stringify({
        imports: {
          '#extensionless': './target',
          '#explicit': './target.js',
        },
      }),
      '/scope/target.js': 'module.exports = 1;',
    });

    for (const esm of [false, true]) {
      expect(() =>
        resolver.resolve('#extensionless', { fromFile: '/scope/entry.js', esm }),
      ).toThrow(/Cannot find package import/);
      expect(resolver.resolve('#explicit', { fromFile: '/scope/entry.js', esm }).id).toBe(
        '/scope/target.js',
      );
    }
  });
});

describe('Node 24 ambiguous .js syntax detection', () => {
  it('lets an explicit package type win', () => {
    const resolver = setup({
      '/module/package.json': '{"type":"module"}',
      '/module/value.js': 'module.exports = 1;',
      '/commonjs/package.json': '{"type":"commonjs"}',
      '/commonjs/value.js': 'export const value = 1;',
    });

    expect(resolver.resolve('./value.js', { fromFile: '/module/entry.js', esm: false }).kind).toBe(
      'esm',
    );
    expect(
      resolver.resolve('./value.js', { fromFile: '/commonjs/entry.js', esm: false }).kind,
    ).toBe('cjs');
  });

  it('prefers CommonJS when its real wrapper parses, otherwise accepts ESM syntax', () => {
    const resolver = setup({
      '/app/plain.js': 'const value = 1;',
      '/app/commonjs.js': 'module.exports = 1;',
      '/app/module.js': 'export const value = 1;',
      '/app/wrapper-collision.js': 'const require = 1;',
      '/app/invalid.js': 'export const = ;',
      '/app/shebang.js': '#!/usr/bin/env node\nexport const value = 1;',
    });
    const opts = { fromFile: '/app/entry.cjs', esm: false } as const;

    expect(resolver.resolve('./plain.js', opts).kind).toBe('cjs');
    expect(resolver.resolve('./commonjs.js', opts).kind).toBe('cjs');
    expect(resolver.resolve('./module.js', opts).kind).toBe('esm');
    expect(resolver.resolve('./wrapper-collision.js', opts).kind).toBe('esm');
    expect(resolver.resolve('./invalid.js', opts).kind).toBe('cjs');
    expect(resolver.resolve('./shebang.js', opts).kind).toBe('esm');
  });
});
