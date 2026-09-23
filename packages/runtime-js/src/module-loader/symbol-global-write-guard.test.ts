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
});
