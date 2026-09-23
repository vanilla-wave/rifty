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
    } finally {
      if (descriptor) Object.defineProperty(globalThis, 'Function', descriptor);
    }
  });
});
