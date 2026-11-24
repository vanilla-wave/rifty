import { createModuleLoader } from '@riftydev/runtime-js/loader';
import { MemoryFsSync } from '@riftydev/vfs/internal';
import { afterEach, describe, expect, it } from 'vitest';

// Unit runtime-js/computed-global-read-callee. A computed global read called or
// constructed loads (Node parity: tools/node-parity-runner/cases/modules/
// global-computed-read-callee-*). A key that is 'Function' at runtime yields the
// module's routed lexical Function (ADR-0171): its import() resolves from the VFS
// module, never through the host constructor. Other forms keep the load-time ceiling.

function setup(files: Record<string, string>): ReturnType<typeof createModuleLoader> {
  const vfs = new MemoryFsSync();
  vfs.loadFixture({ '/pkg/dep.mjs': "export const value = 'vfs-dep';\n", ...files });
  return createModuleLoader(vfs);
}

const HostFunction = Function;
const g = globalThis as Record<string, unknown>;

afterEach(() => {
  if (globalThis.Function !== HostFunction) {
    Object.defineProperty(globalThis, 'Function', {
      value: HostFunction,
      writable: true,
      configurable: true,
      enumerable: false,
    });
  }
  Reflect.deleteProperty(g, '__riftyGuardBefore__');
});

type Importer = () => Promise<{ value: string }>;
interface Sites {
  construct(key: unknown, body: string): Importer;
  call(key: unknown, body: string): Importer;
  callMethod(key: unknown, body: string): Importer;
  lexical(body: string): Importer;
}

const BODY = 'return import("./dep.mjs")';
const objectKey = { toString: () => 'Function' };

async function expectRouted(sites: Sites): Promise<void> {
  expect((await sites.lexical(BODY)()).value).toBe('vfs-dep');
  for (const key of ['Function', objectKey]) {
    expect((await sites.construct(key, BODY)()).value).toBe('vfs-dep');
    expect((await sites.call(key, BODY)()).value).toBe('vfs-dep');
    expect((await sites.callMethod(key, BODY)()).value).toBe('vfs-dep');
  }
  expect(sites.construct('Uint8Array', '3' as never)).toHaveLength(3);
  expect(globalThis.Function).toBe(HostFunction);
}

describe('computed global read used as a callee/constructor (unit computed-global-read-callee)', () => {
  it('ESM: a runtime Function key yields the routed Function; host Function intact', async () => {
    const loader = setup({
      '/pkg/sites.mjs': `
        export function construct(key, body) { return new globalThis[key](body); }
        export function call(key, body) { return global[key](body); }
        export function callMethod(key, body) { return globalThis[key].call(null, body); }
        export function lexical(body) { return new Function(body); }
      `,
    });
    await expectRouted((await loader.import('/pkg/sites.mjs', '/entry.mjs')) as unknown as Sites);
  });

  it('CJS: a runtime Function key yields the routed Function; host Function intact', async () => {
    const loader = setup({
      '/pkg/sites.js': `
        exports.construct = function (key, body) { return new global[key](body); };
        exports.call = function (key, body) { return globalThis[key](body); };
        exports.callMethod = function (key, body) { return global[key].call(null, body); };
        exports.lexical = function (body) { return new Function(body); };
      `,
    });
    await expectRouted(loader.require('./pkg/sites.js', '/entry.js') as Sites);
  });

  // Out of scope (unit §Out of scope): each still rejects before any statement runs.
  const ceilings = {
    'static read': 'new globalThis.Function("return 1")',
    'folded read': 'new globalThis["Fun" + "ction"]("return 1")',
    'Reflect.get called': 'Reflect.get(globalThis, key)("return 1")',
    'alias of the read': 'const C = globalThis[key]; new C("return 1")',
    'destructured read': 'const { [key]: C } = globalThis; new C("return 1")',
    'optional member': 'globalThis?.[key]("return 1")',
  };

  for (const [name, body] of Object.entries(ceilings)) {
    it(`ESM keeps the load-time ceiling: ${name}`, async () => {
      const loader = setup({
        '/pkg/c.mjs': `globalThis.__riftyGuardBefore__ = 'ran';\nexport function f(key) { ${body}; }`,
      });
      await expect(loader.import('/pkg/c.mjs', '/entry.mjs')).rejects.toMatchObject({
        name: 'NotImplementedError',
        feature: 'module-loader.esm-global-function-assignment',
      });
      expect(g.__riftyGuardBefore__).toBeUndefined();
    });

    it(`CJS keeps the load-time ceiling: ${name}`, () => {
      const loader = setup({
        '/pkg/c.js': `global.__riftyGuardBefore__ = 'ran';\nexports.f = function (key) { ${body}; };`,
      });
      expect(() => loader.require('./pkg/c.js', '/entry.js')).toThrow(
        expect.objectContaining({
          name: 'NotImplementedError',
          feature: 'module-loader.cjs-global-function-assignment',
        }),
      );
      expect(g.__riftyGuardBefore__).toBeUndefined();
    });
  }
});
