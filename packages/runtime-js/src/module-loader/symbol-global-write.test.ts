import { MemoryFsSync } from '@riftydev/vfs/internal';
import { describe, expect, it } from 'vitest';
import { createModuleLoader } from './loader.ts';

describe.each(['cjs', 'esm'])('%s Symbol global writes', (kind) => {
  const run = async (body: string) => {
    const fs = new MemoryFsSync();
    const file = kind === 'cjs' ? '/work/main.cjs' : '/work/main.mjs';
    fs.loadFixture({ [file]: body });
    const loader = createModuleLoader(fs);
    if (kind === 'cjs') return loader.require(file);
    return loader.import(file);
  };

  it.each([
    'globalThis[key] = 42;',
    'Object.defineProperty(globalThis, key, {value:42, configurable:true});',
    'Reflect.set(globalThis, key, 42);',
    'Object.defineProperty(globalThis, Symbol.for("rifty.symbol-test"), {value:42, configurable:true});',
  ])('executes %s', async (write) => {
    await run(
      `const key = Symbol.for("rifty.symbol-test"); ${write} if (globalThis[key] !== 42) throw new Error("wrong value"); delete globalThis[key];`,
    );
  });

  it('loads dormant generic define loops and guards keys at the actual write', async () => {
    await run(
      `function setup(defines) { for (const key in defines) globalThis[key] = defines[key]; } setup({}); setup({__riftySafeDefine:42}); if (globalThis.__riftySafeDefine !== 42) throw new Error('missing define'); delete globalThis.__riftySafeDefine;`,
    );
  });

  it('performs native ToPropertyKey once after the RHS', async () => {
    await run(
      `const events = []; const key = { [Symbol.toPrimitive](hint) { events.push(hint); return '__riftySafeDefine'; } }; globalThis[key] = (events.push('rhs'), 42); if (events.join(',') !== 'rhs,string') throw new Error(events.join(',')); delete globalThis.__riftySafeDefine;`,
    );
  });

  it('loads dormant global stubbing APIs and converts the key after argument evaluation', async () => {
    await run(
      `const events = []; function stub(name, descriptor) { Object.defineProperty(globalThis, name, descriptor); } const key = { [Symbol.toPrimitive](hint) { events.push(hint); return '__riftySafeDefine'; } }; stub(key, (events.push('descriptor'), {value:42, configurable:true})); if (events.join(',') !== 'descriptor,string') throw new Error(events.join(',')); const name = '__riftySafeDefine'; Reflect.deleteProperty(globalThis, name);`,
    );
  });

  it.each(['__defineGetter__', '__defineSetter__'])(
    'rejects computed legacy %s keys with mutable global Symbol',
    async (method) => {
      const symbol = globalThis.Symbol;
      const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'Function')!;
      const fn = globalThis.Function;
      try {
        await expect(
          run(
            `globalThis.Symbol = () => "Function"; const key = Symbol(); globalThis.${method}(key, () => 42);`,
          ),
        ).rejects.toThrow(/global-function-assignment/);
        expect(globalThis.Function).toBe(fn);
      } finally {
        globalThis.Symbol = symbol;
        Object.defineProperty(globalThis, 'Function', descriptor);
      }
    },
  );

  it.each([
    'const key = "Function"; globalThis[key] = () => {};',
    'let key = Symbol(); key = "Function"; globalThis[key] = () => {};',
    'const Symbol = () => "Function"; const key = Symbol(); globalThis[key] = () => {};',
    'const key = Symbol(); function mutate(key) { globalThis[key] = () => {}; } mutate("Function");',
  ])('retains the ceiling for %s', async (body) => {
    await expect(run(body)).rejects.toThrow(/global-function-assignment/);
  });
});
