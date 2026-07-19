import { MemoryFsSync } from '@riftydev/vfs/internal';
import { afterEach, describe, expect, it } from 'vitest';
import { createModuleLoader } from './loader.ts';

const exactPath = '/work/node_modules/tool/exact.js';
const bindingName = '__riftyExactHostBinding';
const globals = globalThis as Record<string, unknown>;
const originalFunction = globalThis.Function;
const originalTextDecoderDecode = globalThis.TextDecoder.prototype.decode;
const originalUint8Array = globalThis.Uint8Array;
const originalArraySort = globalThis.Array.prototype.sort;
const originalStringEndsWith = globalThis.String.prototype.endsWith;
const originalJsonParse = globalThis.JSON.parse;
const originalReflectApply = globalThis.Reflect.apply;
const originalReflectConstruct = globalThis.Reflect.construct;
const originalObjectPrototypeType = Object.getOwnPropertyDescriptor(Object.prototype, 'type');

function bytes(source: string): Uint8Array {
  return new TextEncoder().encode(source);
}

afterEach(() => {
  globalThis.Function = originalFunction;
  Object.defineProperty(globalThis.TextDecoder.prototype, 'decode', {
    value: originalTextDecoderDecode,
    configurable: true,
    writable: true,
  });
  globalThis.Uint8Array = originalUint8Array;
  Object.defineProperty(globalThis.Array.prototype, 'sort', {
    value: originalArraySort,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(globalThis.String.prototype, 'endsWith', {
    value: originalStringEndsWith,
    configurable: true,
    writable: true,
  });
  globalThis.JSON.parse = originalJsonParse;
  globalThis.Reflect.apply = originalReflectApply;
  globalThis.Reflect.construct = originalReflectConstruct;
  if (originalObjectPrototypeType === undefined) Reflect.deleteProperty(Object.prototype, 'type');
  else Object.defineProperty(Object.prototype, 'type', originalObjectPrototypeType);
  globals.__exactBindingResult = undefined;
  globals.__exactBindingBody = undefined;
  globals.__exactBindingDependency = undefined;
  globals.__copiedBindingType = undefined;
});

describe('exact ESM module lexical binding', () => {
  it('admits one exact path+raw-byte artifact without publishing a global', async () => {
    const source = `globalThis.__exactBindingResult = ${bindingName}.identity; export {};`;
    const fs = new MemoryFsSync();
    fs.loadFixture({
      '/work/node_modules/tool/package.json': JSON.stringify({ type: 'module' }),
      [exactPath]: source,
    });
    const loader = createModuleLoader(fs, {
      cwd: '/work',
      exactEsmModuleBinding: {
        path: exactPath,
        sourceBytes: bytes(source),
        imports: { [bindingName]: Object.freeze({ identity: 'host-value' }) },
      },
    });

    await loader.import(exactPath);

    expect(globals.__exactBindingResult).toBe('host-value');
    expect(Object.prototype.hasOwnProperty.call(globalThis, bindingName)).toBe(false);
  });

  it('does not admit a byte-identical artifact at another path', async () => {
    const source = `globalThis.__copiedBindingType = typeof ${bindingName}; export {};`;
    const copiedPath = '/work/copied.mjs';
    const fs = new MemoryFsSync();
    fs.loadFixture({
      '/work/node_modules/tool/package.json': JSON.stringify({ type: 'module' }),
      [exactPath]: source,
      [copiedPath]: source,
    });
    const loader = createModuleLoader(fs, {
      cwd: '/work',
      exactEsmModuleBinding: {
        path: exactPath,
        sourceBytes: bytes(source),
        imports: { [bindingName]: Object.freeze({ identity: 'host-value' }) },
      },
    });

    await loader.import(copiedPath);

    expect(globals.__copiedBindingType).toBe('undefined');
  });

  it('rejects source drift before a static dependency or module body executes', async () => {
    const admitted = `import './dependency.mjs'; globalThis.__exactBindingBody = ${bindingName}; export {};`;
    const changed = `${admitted}\n// changed`;
    const fs = new MemoryFsSync();
    fs.loadFixture({
      '/work/node_modules/tool/package.json': JSON.stringify({ type: 'module' }),
      [exactPath]: admitted,
      '/work/node_modules/tool/dependency.mjs':
        'globalThis.__exactBindingDependency = true; export {};',
    });
    const loader = createModuleLoader(fs, {
      cwd: '/work',
      exactEsmModuleBinding: {
        path: exactPath,
        sourceBytes: bytes(admitted),
        imports: { [bindingName]: Object.freeze({ identity: 'host-value' }) },
      },
    });
    fs.writeFileSync(exactPath, bytes(changed));

    await expect(loader.import(exactPath)).rejects.toThrow(/source mismatch/i);
    expect(loader.registry.get(exactPath)).toBeUndefined();
    expect(globals.__exactBindingDependency).toBeUndefined();
    expect(globals.__exactBindingBody).toBeUndefined();
  });

  it('rejects package classification drift before a static dependency or body executes', async () => {
    const source = `import './dependency.mjs'; globalThis.__exactBindingBody = ${bindingName}; export {};`;
    const packagePath = '/work/node_modules/tool/package.json';
    const fs = new MemoryFsSync();
    fs.loadFixture({
      [packagePath]: JSON.stringify({ type: 'module' }),
      [exactPath]: source,
      '/work/node_modules/tool/dependency.mjs':
        'globalThis.__exactBindingDependency = true; export {};',
    });
    const loader = createModuleLoader(fs, {
      cwd: '/work',
      exactEsmModuleBinding: {
        path: exactPath,
        sourceBytes: bytes(source),
        imports: { [bindingName]: Object.freeze({ identity: 'host-value' }) },
      },
    });
    fs.writeFileSync(packagePath, bytes(JSON.stringify({ type: 'commonjs' })));

    await expect(loader.import(exactPath)).rejects.toThrow(/classification mismatch/i);
    expect(loader.registry.get(exactPath)).toBeUndefined();
    expect(globals.__exactBindingDependency).toBeUndefined();
    expect(globals.__exactBindingBody).toBeUndefined();
  });

  it('rejects classification drift before require can reroute the admitted path through CJS', () => {
    const source = 'globalThis.__exactBindingBody = true;';
    const packagePath = '/work/node_modules/tool/package.json';
    const fs = new MemoryFsSync();
    fs.loadFixture({
      [packagePath]: JSON.stringify({ type: 'module' }),
      [exactPath]: source,
    });
    const loader = createModuleLoader(fs, {
      cwd: '/work',
      exactEsmModuleBinding: {
        path: exactPath,
        sourceBytes: bytes(source),
        imports: { [bindingName]: Object.freeze({}) },
      },
    });
    fs.writeFileSync(packagePath, bytes(JSON.stringify({ type: 'commonjs' })));

    expect(() => loader.require(exactPath)).toThrow(/classification mismatch/i);
    expect(loader.registry.get(exactPath)).toBeUndefined();
    expect(globals.__exactBindingBody).toBeUndefined();
  });

  it('snapshots bytes, own data-property values, transform, and factory at loader creation', async () => {
    const source = `globalThis.__exactBindingResult = ${bindingName}.identity; export {};`;
    const sourceBytes = bytes(source);
    const imports = { [bindingName]: { identity: 'before' } };
    const fs = new MemoryFsSync();
    fs.loadFixture({
      '/work/node_modules/tool/package.json': JSON.stringify({ type: 'module' }),
      [exactPath]: source,
    });
    const loader = createModuleLoader(fs, {
      cwd: '/work',
      exactEsmModuleBinding: { path: exactPath, sourceBytes, imports },
    });
    sourceBytes.fill(0);
    imports[bindingName] = { identity: 'after' };

    await loader.import(exactPath);

    expect(globals.__exactBindingResult).toBe('before');
  });

  it('uses pre-guest decoder, transform, factory, collections, and invocation primordials', async () => {
    const source = `globalThis.__exactBindingResult = ${bindingName}.identity; export {};`;
    const fs = new MemoryFsSync();
    fs.loadFixture({
      '/work/node_modules/tool/package.json': JSON.stringify({ type: 'module' }),
      [exactPath]: source,
    });
    const loader = createModuleLoader(fs, {
      cwd: '/work',
      exactEsmModuleBinding: {
        path: exactPath,
        sourceBytes: bytes(source),
        imports: { [bindingName]: Object.freeze({ identity: 'captured' }) },
      },
    });

    globalThis.Function = (() => {
      throw new Error('guest Function was observed');
    }) as unknown as FunctionConstructor;
    Object.defineProperty(globalThis.TextDecoder.prototype, 'decode', {
      value() {
        throw new Error('guest TextDecoder was observed');
      },
      configurable: true,
      writable: true,
    });
    globalThis.Uint8Array = new Proxy(originalUint8Array, {
      construct() {
        throw new Error('guest Uint8Array was observed');
      },
    });
    Object.defineProperty(globalThis.Array.prototype, 'sort', {
      value() {
        throw new Error('guest Array#sort was observed');
      },
      configurable: true,
      writable: true,
    });
    globalThis.Reflect.apply = (() => {
      throw new Error('guest Reflect.apply was observed');
    }) as typeof Reflect.apply;
    globalThis.Reflect.construct = (() => {
      throw new Error('guest Reflect.construct was observed');
    }) as typeof Reflect.construct;

    await loader.import(exactPath);

    expect(globals.__exactBindingResult).toBe('captured');
  });

  it('keeps the ordinary and exact wrapper body line offsets identical', async () => {
    const source = ['globalThis.__exactBindingResult = true;', '', 'throw new Error("boom");'].join(
      '\n',
    );
    const ordinaryPath = '/work/ordinary.mjs';
    const fs = new MemoryFsSync();
    fs.loadFixture({
      '/work/node_modules/tool/package.json': JSON.stringify({ type: 'module' }),
      [exactPath]: source,
      [ordinaryPath]: source,
    });
    const loader = createModuleLoader(fs, {
      cwd: '/work',
      exactEsmModuleBinding: {
        path: exactPath,
        sourceBytes: bytes(source),
        imports: { [bindingName]: Object.freeze({}) },
      },
    });
    const frame = async (path: string): Promise<string> => {
      try {
        await loader.import(path);
        throw new Error('expected module failure');
      } catch (error) {
        return (error as Error).stack?.match(/:\d+:\d+/)?.[0] ?? 'missing';
      }
    };

    expect(await frame(exactPath)).toBe(await frame(ordinaryPath));
  });

  it('re-reads classification with captured JSON/string primordials and own package type', async () => {
    const source = `globalThis.__exactBindingBody = ${bindingName}; export {};`;
    const packagePath = '/work/node_modules/tool/package.json';
    const fs = new MemoryFsSync();
    fs.loadFixture({
      [packagePath]: JSON.stringify({ type: 'module' }),
      [exactPath]: source,
    });
    const loader = createModuleLoader(fs, {
      cwd: '/work',
      exactEsmModuleBinding: {
        path: exactPath,
        sourceBytes: bytes(source),
        imports: { [bindingName]: Object.freeze({}) },
      },
    });
    fs.writeFileSync(packagePath, bytes('{}'));
    let inheritedReads = 0;
    Object.defineProperty(Object.prototype, 'type', {
      get() {
        inheritedReads += 1;
        return 'module';
      },
      configurable: true,
    });
    globalThis.JSON.parse = (() => ({ type: 'module' })) as JSON['parse'];
    Object.defineProperty(globalThis.String.prototype, 'endsWith', {
      value() {
        return true;
      },
      configurable: true,
      writable: true,
    });

    await expect(loader.import(exactPath)).rejects.toThrow(/classification mismatch/i);
    expect(loader.registry.get(exactPath)).toBeUndefined();
    expect(inheritedReads).toBe(0);
    expect(globals.__exactBindingBody).toBeUndefined();
  });

  it.each([
    ['reserved identifier', 'await'],
    ['loader helper collision', '__import'],
    ['module binding collision', 'local'],
  ])('rejects a %s at loader creation', (_label, name) => {
    const source = 'const local = 1; export { local };';
    const fs = new MemoryFsSync();
    fs.loadFixture({
      '/work/node_modules/tool/package.json': JSON.stringify({ type: 'module' }),
      [exactPath]: source,
    });

    expect(() =>
      createModuleLoader(fs, {
        cwd: '/work',
        exactEsmModuleBinding: {
          path: exactPath,
          sourceBytes: bytes(source),
          imports: { [name]: Object.freeze({}) },
        },
      }),
    ).toThrow(/identifier|collid/i);
  });

  it.each([
    ['if', 'if (false) { var __riftyExactHostBinding; }'],
    ['for', 'for (; false; ) { var __riftyExactHostBinding; }'],
    ['for-in', 'for (var __riftyExactHostBinding in {}) {}'],
    ['for-of', 'for (var __riftyExactHostBinding of []) {}'],
    ['switch', 'switch (0) { case 1: var __riftyExactHostBinding; }'],
    ['try', 'try {} catch { var __riftyExactHostBinding; }'],
  ])('rejects a host binding shadowed by module-hoisted var inside %s', (_label, declaration) => {
    const source = `${declaration}\nglobalThis.__exactBindingResult = ${bindingName}; export {};`;
    const fs = new MemoryFsSync();
    fs.loadFixture({
      '/work/node_modules/tool/package.json': JSON.stringify({ type: 'module' }),
      [exactPath]: source,
    });

    expect(() =>
      createModuleLoader(fs, {
        cwd: '/work',
        exactEsmModuleBinding: {
          path: exactPath,
          sourceBytes: bytes(source),
          imports: { [bindingName]: 'SECRET' },
        },
      }),
    ).toThrow(/collid/i);
  });

  it('parses and syntax-checks the attested source during loader creation', () => {
    const source = 'export {';
    const fs = new MemoryFsSync();
    fs.loadFixture({
      '/work/node_modules/tool/package.json': JSON.stringify({ type: 'module' }),
      [exactPath]: source,
    });

    expect(() =>
      createModuleLoader(fs, {
        cwd: '/work',
        exactEsmModuleBinding: {
          path: exactPath,
          sourceBytes: bytes(source),
          imports: { [bindingName]: Object.freeze({}) },
        },
      }),
    ).toThrow(/parse ESM source/i);
    expect(globals.__exactBindingBody).toBeUndefined();
  });

  it('rejects accessor imports without invoking them', () => {
    const source = 'export {};';
    const fs = new MemoryFsSync();
    fs.loadFixture({
      '/work/node_modules/tool/package.json': JSON.stringify({ type: 'module' }),
      [exactPath]: source,
    });
    let reads = 0;
    const imports = Object.defineProperty({}, bindingName, {
      enumerable: true,
      get() {
        reads += 1;
        return Object.freeze({});
      },
    });

    expect(() =>
      createModuleLoader(fs, {
        cwd: '/work',
        exactEsmModuleBinding: { path: exactPath, sourceBytes: bytes(source), imports },
      }),
    ).toThrow(/data property/i);
    expect(reads).toBe(0);
  });

  it('rejects accessor descriptor fields without invoking them', () => {
    let reads = 0;
    const descriptor = Object.defineProperties(
      {},
      {
        path: {
          get() {
            reads += 1;
            return exactPath;
          },
        },
        sourceBytes: { value: bytes('export {};') },
        imports: { value: { [bindingName]: Object.freeze({}) } },
      },
    );
    const fs = new MemoryFsSync();
    fs.loadFixture({
      '/work/node_modules/tool/package.json': JSON.stringify({ type: 'module' }),
      [exactPath]: 'export {};',
    });

    expect(() =>
      createModuleLoader(fs, {
        cwd: '/work',
        exactEsmModuleBinding: descriptor as never,
      }),
    ).toThrow(/own data property/i);
    expect(reads).toBe(0);
  });
});
