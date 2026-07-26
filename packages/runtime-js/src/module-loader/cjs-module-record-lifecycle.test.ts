import { MemoryFsSync } from '@riftydev/vfs/internal';
import { afterEach, describe, expect, it } from 'vitest';
import { createModuleLoader } from './loader.ts';

interface NodeModuleRecord {
  readonly id: string;
  readonly filename: string;
  readonly path: string;
  readonly paths: string[];
  exports: unknown;
  readonly parent?: NodeModuleRecord | null;
  readonly children: NodeModuleRecord[];
  readonly loaded: boolean;
}

interface SharedExports {
  readonly self: NodeModuleRecord;
  readonly loadedDuring: boolean;
  loadedAfter(): boolean;
}

const globals = globalThis as Record<string, unknown>;

afterEach(() => {
  Reflect.deleteProperty(globals, '__adr0325Attempts');
});

function setup(files: Record<string, string>): ReturnType<typeof createModuleLoader> {
  const vfs = new MemoryFsSync();
  vfs.loadFixture(files);
  return createModuleLoader(vfs);
}

describe('CJS ModuleRecord metadata and lifecycle', () => {
  it('uses the cached registry record as module and preserves its first parent', () => {
    const loader = setup({
      '/shared.js': `
        module.exports = {
          self: module,
          loadedDuring: module.loaded,
          loadedAfter: () => module.loaded,
        };
      `,
      '/first.js': `
        const shared = require('./shared.js');
        const cached = require('./shared.js');
        module.exports = {
          self: module,
          shared,
          cached,
          children: () => module.children.slice(),
        };
      `,
      '/second.js': `
        const shared = require('./shared.js');
        module.exports = {
          self: module,
          shared,
          children: () => module.children.slice(),
        };
      `,
    });

    const first = loader.require('/first.js', '/entry.js') as {
      readonly self: NodeModuleRecord;
      readonly shared: SharedExports;
      readonly cached: SharedExports;
      children(): NodeModuleRecord[];
    };
    const firstParent = first.shared.self.parent;
    const second = loader.require('/second.js', '/entry.js') as {
      readonly self: NodeModuleRecord;
      readonly shared: SharedExports;
      children(): NodeModuleRecord[];
    };
    const sharedRecord = loader.registry.get('/shared.js');

    expect(first.shared).toBe(first.cached);
    expect(second.shared).toBe(first.shared);
    expect(first.shared.loadedDuring).toBe(false);
    expect(first.shared.loadedAfter()).toBe(true);
    expect(first.shared.self).toBe(sharedRecord);
    expect(first.self).toBe(loader.registry.get('/first.js'));
    expect(second.self).toBe(loader.registry.get('/second.js'));
    expect(first.shared.self.exports).toBe(first.shared);
    expect(first.shared.self).toMatchObject({
      id: '/shared.js',
      filename: '/shared.js',
      path: '/',
      loaded: true,
    });
    expect(first.shared.self.paths).toEqual(['/node_modules']);
    expect(firstParent).toBe(first.self);
    expect(first.shared.self.parent).toBe(firstParent);
    expect(first.children()).toEqual([first.shared.self]);
    expect(second.children()).toEqual([first.shared.self]);
  });

  it('publishes and links one record before a cyclic child evaluates', () => {
    const loader = setup({
      '/a.js': `
        exports.self = module;
        exports.loadedDuring = module.loaded;
        exports.partial = 'a-before-b';
        exports.b = require('./b.js');
        exports.loadedAfter = () => module.loaded;
      `,
      '/b.js': `
        const a = require('./a.js');
        module.exports = {
          self: module,
          loadedDuring: module.loaded,
          parentDuring: module.parent,
          parentHadChildDuring: module.parent.children.includes(module),
          a,
          aLoadedDuring: a.self.loaded,
          aPartialDuring: a.partial,
          aExportsIdentityDuring: a.self.exports === a,
          loadedAfter: () => module.loaded,
        };
      `,
    });

    const a = loader.require('/a.js', '/entry.js') as {
      readonly self: NodeModuleRecord;
      readonly loadedDuring: boolean;
      readonly partial: string;
      readonly b: {
        readonly self: NodeModuleRecord;
        readonly loadedDuring: boolean;
        readonly parentDuring: NodeModuleRecord;
        readonly parentHadChildDuring: boolean;
        readonly a: unknown;
        readonly aLoadedDuring: boolean;
        readonly aPartialDuring: string;
        readonly aExportsIdentityDuring: boolean;
        loadedAfter(): boolean;
      };
      loadedAfter(): boolean;
    };

    expect(a.self).toBe(loader.registry.get('/a.js'));
    expect(a.b.self).toBe(loader.registry.get('/b.js'));
    expect(a.loadedDuring).toBe(false);
    expect(a.b.loadedDuring).toBe(false);
    expect(a.b.parentDuring).toBe(a.self);
    expect(a.b.parentHadChildDuring).toBe(true);
    expect(a.b.a).toBe(a);
    expect(a.b.aLoadedDuring).toBe(false);
    expect(a.b.aPartialDuring).toBe('a-before-b');
    expect(a.b.aExportsIdentityDuring).toBe(true);
    expect(a.self.children).toEqual([a.b.self]);
    expect(a.b.self.children).toEqual([a.self]);
    expect(a.loadedAfter()).toBe(true);
    expect(a.b.loadedAfter()).toBe(true);
  });

  it('unlinks a failed record before a fresh same-parent retry', () => {
    const loader = setup({
      '/parent.js': `
        let message;
        try {
          require('./flaky.js');
        } catch (error) {
          message = error.message;
        }
        const childrenAfterFailure = module.children.slice();
        const child = require('./flaky.js');
        module.exports = {
          self: module,
          message,
          childrenAfterFailure,
          child,
          childrenAfterRetry: () => module.children.slice(),
        };
      `,
      '/flaky.js': `
        const attempts = globalThis.__adr0325Attempts ||= [];
        attempts.push(module);
        if (attempts.length === 1) throw new Error('first load fails');
        module.exports = {
          self: module,
          loadedDuring: module.loaded,
          loadedAfter: () => module.loaded,
        };
      `,
    });

    const parent = loader.require('/parent.js', '/entry.js') as {
      readonly self: NodeModuleRecord;
      readonly message: string;
      readonly childrenAfterFailure: NodeModuleRecord[];
      readonly child: SharedExports;
      childrenAfterRetry(): NodeModuleRecord[];
    };
    const attempts = globals.__adr0325Attempts as NodeModuleRecord[];

    expect(parent.message).toBe('first load fails');
    expect(attempts).toHaveLength(2);
    expect(attempts[0]).not.toBe(attempts[1]);
    expect(parent.childrenAfterFailure).toEqual([]);
    expect(parent.childrenAfterRetry()).toEqual([parent.child.self]);
    expect(parent.childrenAfterRetry()).not.toContain(attempts[0]);
    expect(parent.child.self).toBe(attempts[1]);
    expect(parent.child.self).toBe(loader.registry.get('/flaky.js'));
    expect(parent.child.self.parent).toBe(parent.self);
    expect(parent.child.self.exports).toBe(parent.child);
    expect(parent.child.loadedDuring).toBe(false);
    expect(parent.child.loadedAfter()).toBe(true);
  });
});
