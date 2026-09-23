import { MemoryFsSync } from '@riftydev/vfs/internal';
import { describe, expect, it } from 'vitest';
import { createModuleLoader } from './loader.ts';

async function execute(kind: 'cjs' | 'esm', source: string): Promise<void> {
  const vfs = new MemoryFsSync();
  const filename = kind === 'esm' ? '/main.mjs' : '/main.cjs';
  vfs.loadFixture({ [filename]: source });
  const loader = createModuleLoader(vfs);
  if (kind === 'esm') await loader.import(filename);
  else loader.require(filename);
}

describe.each(['cjs', 'esm'] as const)('%s symbol global writes', (kind) => {
  it.each([
    [
      'const symbol assignment',
      `const key = Symbol('Function'); globalThis[key] = 17; delete globalThis[key];`,
    ],
    [
      'inline registry symbol',
      `Object.defineProperty(globalThis, Symbol.for('rifty.symbol.test'), { value: 23, configurable: true }); Reflect.deleteProperty(globalThis, Symbol.for('rifty.symbol.test'));`,
    ],
    [
      'const captured by closure',
      `const key = Symbol('Function'); function write() { globalThis[key] = 31; delete globalThis[key]; } write();`,
    ],
    [
      'global alias',
      `const target = globalThis; const key = Symbol('Function'); target[key] = 47; delete target[key];`,
    ],
    [
      'mutable actual symbol',
      `let key = Symbol('safe'); globalThis[key] = 17; delete globalThis[key];`,
    ],
    [
      'shadowed Symbol returning actual symbol',
      `function write(Symbol) { const key = Symbol('safe'); globalThis[key] = 17; delete globalThis[key]; } write(globalThis.Symbol);`,
    ],
  ])('accepts %s', async (_label, source) => {
    await execute(kind, source);
  });

  it.each([
    ['string key', `const key = 'Function'; globalThis[key] = 17;`],
    ['mutable key', `let key = Symbol('safe'); key = 'Function'; globalThis[key] = 17;`],
    [
      'shadowed Symbol parameter',
      `function write(Symbol) { globalThis[Symbol('safe')] = 17; } write(() => 'Function');`,
    ],
    [
      'shadowed Symbol block',
      `{ const Symbol = () => 'Function'; globalThis[Symbol('safe')] = 17; }`,
    ],
    [
      'shadowed key parameter',
      `const key = Symbol('safe'); function write(key) { globalThis[key] = 17; } write('Function');`,
    ],
    [
      'shadowed key block',
      `const key = Symbol('safe'); { const key = 'Function'; globalThis[key] = 17; }`,
    ],
    [
      'default initializer bypass',
      `const { key = Symbol('safe') } = { key: 'Function' }; globalThis[key] = 17;`,
    ],
    [
      'coercible object',
      `const key = { [Symbol.toPrimitive]: () => 'Function' }; globalThis[key] = 17;`,
    ],
    [
      'mixed descriptor map',
      `const key = Symbol('safe'); Object.defineProperties(globalThis, { [key]: { value: 1 }, Function: { value: 17 } });`,
    ],
  ])('keeps %s loud without mutating host Function', async (_label, source) => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'Function');
    if (!descriptor) throw new Error('host Function descriptor missing');
    try {
      await expect(execute(kind, source)).rejects.toMatchObject({
        name: 'NotImplementedError',
        feature: `module-loader.${kind}-global-function-assignment`,
      });
      expect(Object.getOwnPropertyDescriptor(globalThis, 'Function')).toEqual(descriptor);
    } finally {
      Object.defineProperty(globalThis, 'Function', descriptor);
    }
  });

  it('does not trust a previously monkeypatched Symbol.for', async () => {
    const symbolFor = Object.getOwnPropertyDescriptor(Symbol, 'for');
    const hostFunction = Object.getOwnPropertyDescriptor(globalThis, 'Function');
    if (!symbolFor || !hostFunction) throw new Error('host descriptor missing');
    Object.defineProperty(Symbol, 'for', { ...symbolFor, value: () => 'Function' });
    try {
      await expect(
        execute(kind, `const key = Symbol.for('safe'); globalThis[key] = 17;`),
      ).rejects.toMatchObject({
        name: 'NotImplementedError',
        feature: `module-loader.${kind}-global-function-assignment`,
      });
      expect(Object.getOwnPropertyDescriptor(globalThis, 'Function')).toEqual(hostFunction);
    } finally {
      Object.defineProperty(Symbol, 'for', symbolFor);
      Object.defineProperty(globalThis, 'Function', hostFunction);
    }
  });

  it.each([
    ['string', "'Function'"],
    [
      'object',
      "({ [Symbol.toPrimitive]() { globalThis.__riftySymbolWriteTrace.push('coerce'); return 'Function'; } })",
    ],
  ])(
    'evaluates a rejected dynamic %s key once without coercion or assignment value evaluation',
    async (_label, valueSource) => {
      const hostFunction = Object.getOwnPropertyDescriptor(globalThis, 'Function');
      const previousTrace = Object.getOwnPropertyDescriptor(globalThis, '__riftySymbolWriteTrace');
      if (!hostFunction) throw new Error('host Function descriptor missing');
      const trace: string[] = [];
      Object.defineProperty(globalThis, '__riftySymbolWriteTrace', {
        value: trace,
        configurable: true,
      });
      try {
        await expect(
          execute(
            kind,
            `
        globalThis.__riftySymbolWriteTrace.push('before');
        function key() {
          globalThis.__riftySymbolWriteTrace.push('key');
          return ${valueSource};
        }
        globalThis[key()] = (globalThis.__riftySymbolWriteTrace.push('value'), 17);
      `,
          ),
        ).rejects.toMatchObject({
          name: 'NotImplementedError',
          feature: `module-loader.${kind}-global-function-assignment`,
        });
        expect(trace).toEqual(['before', 'key']);
        expect(Object.getOwnPropertyDescriptor(globalThis, 'Function')).toEqual(hostFunction);
      } finally {
        if (previousTrace)
          Object.defineProperty(globalThis, '__riftySymbolWriteTrace', previousTrace);
        else Reflect.deleteProperty(globalThis, '__riftySymbolWriteTrace');
        Object.defineProperty(globalThis, 'Function', hostFunction);
      }
    },
  );
});
