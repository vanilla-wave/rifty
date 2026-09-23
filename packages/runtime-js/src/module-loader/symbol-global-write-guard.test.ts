import { MemoryFsSync } from '@riftydev/vfs/internal';
import { describe, expect, it } from 'vitest';
import { createModuleLoader } from './loader.ts';

const unsafeWrites = [
  {
    name: 'string key',
    source: "const key = 'Function'; globalThis[key] = 0;",
  },
  {
    name: 'mutable key',
    source: "let key = Symbol.for('guard'); key = 'Function'; globalThis[key] = 0;",
  },
  {
    name: 'shadowed Symbol factory',
    source:
      "const Symbol = { for: () => 'Function' }; const key = Symbol.for('guard'); globalThis[key] = 0;",
  },
  {
    name: 'inner string shadow',
    source: "const key = Symbol.for('guard'); { const key = 'Function'; globalThis[key] = 0; }",
  },
  {
    name: 'replaced global Symbol.for',
    source:
      "const original = Symbol.for; try { Symbol.for = () => 'Function'; const key = Symbol.for('guard'); globalThis[key] = 0; } finally { Symbol.for = original; }",
  },
  {
    name: 'replaced global Symbol',
    source:
      "const original = Symbol; try { globalThis.Symbol = () => 'Function'; globalThis[Symbol('guard')] = 0; } finally { globalThis.Symbol = original; }",
  },
  {
    name: 'replaced global Symbol.for in descriptor write',
    source:
      "const original = Symbol.for; try { Symbol.for = () => 'Function'; Object.defineProperty(globalThis, Symbol.for('guard'), { value: 0, configurable: true }); } finally { Symbol.for = original; }",
  },
  {
    name: 'replaced global Symbol.for in Reflect.set',
    source:
      "const original = Symbol.for; try { Symbol.for = () => 'Function'; Reflect.set(globalThis, Symbol.for('guard'), 0); } finally { Symbol.for = original; }",
  },
  {
    name: 'replaced global Symbol.for in Object.assign',
    source:
      "const original = Symbol.for; try { Symbol.for = () => 'Function'; Object.assign(globalThis, { [Symbol.for('guard')]: 0 }); } finally { Symbol.for = original; }",
  },
] as const;

describe.each(['cjs', 'esm'] as const)('%s Symbol-key guard', (kind) => {
  it.each(unsafeWrites)('keeps the $name behind the Function mutation ceiling', ({ source }) => {
    const filename = `/work/entry.${kind === 'cjs' ? 'cjs' : 'mjs'}`;
    const vfs = new MemoryFsSync();
    vfs.loadFixture({ [filename]: source });
    const loader = createModuleLoader(vfs, { cwd: '/work' });
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'Function');
    try {
      expect(() => loader.require(filename)).toThrow(
        expect.objectContaining({
          name: 'NotImplementedError',
          feature: `module-loader.${kind}-global-function-assignment`,
        }) as Error,
      );
      expect(Object.getOwnPropertyDescriptor(globalThis, 'Function')).toEqual(descriptor);
    } finally {
      if (descriptor) Object.defineProperty(globalThis, 'Function', descriptor);
    }
  });
});

describe.each(['cjs', 'esm'] as const)('%s Symbol value guard', (kind) => {
  it('accepts a replacement Symbol factory when its key is a real Symbol', () => {
    const filename = `/work/entry.${kind === 'cjs' ? 'cjs' : 'mjs'}`;
    const vfs = new MemoryFsSync();
    vfs.loadFixture({
      [filename]:
        "const original = Symbol; try { globalThis.Symbol = (description) => original(description); const key = Symbol('guard'); try { globalThis[key] = 7; if (globalThis[key] !== 7) throw new Error('wrong symbol value'); } finally { Reflect.deleteProperty(globalThis, key); } } finally { globalThis.Symbol = original; }",
    });
    const loader = createModuleLoader(vfs, { cwd: '/work' });
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'Symbol');
    try {
      expect(() => loader.require(filename)).not.toThrow();
    } finally {
      if (descriptor) Object.defineProperty(globalThis, 'Symbol', descriptor);
    }
  });
});

it('accepts an exported ESM const holding a Symbol key through require and import', async () => {
  const filename = '/work/entry.mjs';
  const source =
    "export const key = Symbol.for('rifty.guard.exported'); globalThis[key] = 7; export const observed = globalThis[key]; Reflect.deleteProperty(globalThis, key);";
  for (const entry of ['require', 'import'] as const) {
    const vfs = new MemoryFsSync();
    vfs.loadFixture({ [filename]: source });
    const loader = createModuleLoader(vfs, { cwd: '/work' });
    const exports =
      entry === 'require'
        ? loader.require(filename)
        : await loader.import(filename, '/work/parent.mjs');
    expect(exports).toMatchObject({ observed: 7 });
  }
});

it('keeps an exported shadow Symbol factory behind the Function ceiling', () => {
  const filename = '/work/entry.mjs';
  const vfs = new MemoryFsSync();
  vfs.loadFixture({
    [filename]:
      "export const Symbol = { for: () => 'Function' }; const key = Symbol.for('guard'); globalThis[key] = 0;",
  });
  const loader = createModuleLoader(vfs, { cwd: '/work' });
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'Function');
  expect(() => loader.require(filename)).toThrow(
    expect.objectContaining({
      name: 'NotImplementedError',
      feature: 'module-loader.esm-global-function-assignment',
    }) as Error,
  );
  expect(Object.getOwnPropertyDescriptor(globalThis, 'Function')).toEqual(descriptor);
});

it('guards an ESM Symbol key after top-level await', async () => {
  const filename = '/work/entry.mjs';
  const vfs = new MemoryFsSync();
  vfs.loadFixture({
    [filename]:
      "await Promise.resolve(); const original = Symbol.for; try { Symbol.for = () => 'Function'; globalThis[Symbol.for('guard')] = 0; } finally { Symbol.for = original; }",
  });
  const loader = createModuleLoader(vfs, { cwd: '/work' });
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'Function');
  try {
    await expect(loader.import('./entry.mjs', '/work/parent.mjs')).rejects.toMatchObject({
      name: 'NotImplementedError',
      feature: 'module-loader.esm-global-function-assignment',
    });
    expect(Object.getOwnPropertyDescriptor(globalThis, 'Function')).toEqual(descriptor);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'Function', descriptor);
  }
});

describe('cjs Symbol source shape', () => {
  it.each([
    "'use strict'; const key = Symbol.for('rifty.guard.strict'); try { globalThis[key] = 7; if ((function () { return this; })() !== undefined) throw new Error('lost strict mode'); } finally { Reflect.deleteProperty(globalThis, key); }",
    "#!/usr/bin/env node\nconst key = Symbol.for('rifty.guard.shebang'); try { globalThis[key] = 7; } finally { Reflect.deleteProperty(globalThis, key); }",
  ])('preserves the source prologue around an admitted Symbol key', (source) => {
    const filename = '/work/entry.cjs';
    const vfs = new MemoryFsSync();
    vfs.loadFixture({ [filename]: source });
    const loader = createModuleLoader(vfs, { cwd: '/work' });
    expect(() => loader.require(filename)).not.toThrow();
  });
});

describe('cjs dynamic Symbol scope', () => {
  it.each([
    "with ({ Symbol: () => 'Function' }) { globalThis[Symbol('guard')] = 0; }",
    "const key = Symbol.for('guard'); with ({ key: 'Function' }) { globalThis[key] = 0; }",
  ])('keeps a with-provided key behind the Function mutation ceiling', (source) => {
    const filename = '/work/entry.cjs';
    const vfs = new MemoryFsSync();
    vfs.loadFixture({ [filename]: source });
    const loader = createModuleLoader(vfs, { cwd: '/work' });
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'Function');
    try {
      expect(() => loader.require(filename)).toThrow(
        expect.objectContaining({
          name: 'NotImplementedError',
          feature: 'module-loader.cjs-global-function-assignment',
        }) as Error,
      );
      expect(Object.getOwnPropertyDescriptor(globalThis, 'Function')).toEqual(descriptor);
    } finally {
      if (descriptor) Object.defineProperty(globalThis, 'Function', descriptor);
    }
  });

  it('keeps the runtime key check when direct eval targets a generated binding', () => {
    const filename = '/work/entry.cjs';
    const vfs = new MemoryFsSync();
    vfs.loadFixture({
      [filename]:
        "const original = Symbol.for; try { Symbol.for = () => 'Function'; try { eval('__rifty' + 'SymbolKey = (value) => value'); } catch {} globalThis[Symbol.for('guard')] = 0; } finally { Symbol.for = original; }",
    });
    const loader = createModuleLoader(vfs, { cwd: '/work' });
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'Function');
    try {
      expect(() => loader.require(filename)).toThrow(
        expect.objectContaining({
          name: 'NotImplementedError',
          feature: 'module-loader.cjs-global-function-assignment',
        }) as Error,
      );
      expect(Object.getOwnPropertyDescriptor(globalThis, 'Function')).toEqual(descriptor);
    } finally {
      if (descriptor) Object.defineProperty(globalThis, 'Function', descriptor);
    }
  });
});
