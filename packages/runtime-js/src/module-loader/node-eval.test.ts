import { NotImplementedError } from '@riftydev/io';
import { MemoryFsSync, resetSyncMirror, setSyncMirror } from '@riftydev/vfs/internal';
import { afterEach, describe, expect, it } from 'vitest';
import * as loaderImplementation from './loader.ts';
import type { ModuleRegistry } from './registry.ts';

const CJS_BINDINGS = ['require', 'module', 'exports', '__filename', '__dirname'] as const;
const EVAL_PROBE = '__riftyNodeEvalProbe';
const EVAL_RUNS = '__riftyNodeEvalRuns';
const DEP_LOADS = '__riftyNodeEvalDepLoads';

interface ReflectedNodeEvalScriptRunner {
  readonly registry: ModuleRegistry;
  run(source: string): unknown;
}

type ReflectedCreateNodeEvalScriptRunner = (opts: {
  readonly vfs: MemoryFsSync;
  readonly cwd: string;
  readonly explicitCommonJs?: boolean;
}) => ReflectedNodeEvalScriptRunner;

interface EvalRecordProbe {
  readonly module: object;
  readonly cache: Record<string, unknown>;
  readonly during: boolean;
  readonly child: {
    readonly load: number;
    readonly parent: object;
  };
}

interface EvalIdentityProbe {
  readonly thisIsGlobal: boolean;
  readonly argumentsType: string;
  readonly filename: string;
  readonly dirname: string;
  readonly moduleId: string;
  readonly moduleFilename: string;
  readonly modulePath: string;
  readonly moduleParent: unknown;
  readonly moduleLoaded: boolean;
  readonly requireMain: unknown;
  readonly moduleRecord: object;
  readonly bindings: {
    readonly descriptors: Record<(typeof CJS_BINDINGS)[number], PropertyDescriptor>;
    readonly requireBinding: unknown;
    readonly moduleBinding: unknown;
    readonly exportsBinding: unknown;
    readonly filenameBinding: unknown;
    readonly dirnameBinding: unknown;
    readonly moduleExports: unknown;
  };
  readonly cache: Record<string, unknown>;
  readonly during: boolean;
  readonly dep: {
    readonly answer: number;
    readonly parentId: string;
    readonly parentFilename: string;
    readonly parent: object;
  };
}

interface PromiseRealmProbe {
  during?: {
    readonly descriptor: PropertyDescriptor | undefined;
    readonly constructor: PromiseConstructor;
    readonly prototype: object;
    readonly completionConstructor: unknown;
    readonly completionPrototype: object | null;
  };
}

function reflectedCreateNodeEvalScriptRunner(): ReflectedCreateNodeEvalScriptRunner {
  const candidate = Reflect.get(loaderImplementation, 'createNodeEvalScriptRunner');
  expect(candidate, 'loader implementation must own createNodeEvalScriptRunner').toBeTypeOf(
    'function',
  );
  return candidate as ReflectedCreateNodeEvalScriptRunner;
}

function snapshotCjsBindings(): Map<string, PropertyDescriptor | undefined> {
  return new Map(
    CJS_BINDINGS.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  );
}

function restoreCjsBindings(snapshot: ReadonlyMap<string, PropertyDescriptor | undefined>): void {
  for (const [key, descriptor] of snapshot) {
    if (descriptor === undefined) Reflect.deleteProperty(globalThis, key);
    else Object.defineProperty(globalThis, key, descriptor);
  }
}

function expectNoEvalRegistryRecord(registry: ModuleRegistry): void {
  expect(registry.has('[eval]')).toBe(false);
  expect(registry.has('/work/[eval]')).toBe(false);
}

afterEach(() => {
  for (const key of [EVAL_PROBE, EVAL_RUNS, DEP_LOADS]) {
    Reflect.deleteProperty(globalThis, key);
  }
  resetSyncMirror();
});

describe('package-internal Node eval script runner', () => {
  it('runs one detached cwd-anchored unwrapped [eval] script and returns a completion token', () => {
    const vfs = new MemoryFsSync();
    setSyncMirror(vfs);
    vfs.loadFixture({
      '/work/dep.cjs': `
module.exports = {
  answer: 42,
  parentId: module.parent?.id,
  parentFilename: module.parent?.filename,
  parent: module.parent,
};
`,
    });
    const bindings = snapshotCjsBindings();

    try {
      const runner = reflectedCreateNodeEvalScriptRunner()({ vfs, cwd: '/work' });
      expectNoEvalRegistryRecord(runner.registry);
      const completion = runner.run(`{
        const dep = require('./dep.cjs');
        globalThis.${EVAL_PROBE} = {
          thisIsGlobal: this === globalThis,
          argumentsType: typeof arguments,
          filename: __filename,
          dirname: __dirname,
          moduleId: module.id,
          moduleFilename: module.filename,
          modulePath: module.path,
          moduleParent: module.parent,
          moduleLoaded: module.loaded,
          requireMain: require.main,
          moduleRecord: module,
          bindings: {
            descriptors: Object.fromEntries(
              ${JSON.stringify(CJS_BINDINGS)}.map((key) => [
                key,
                Object.getOwnPropertyDescriptor(globalThis, key),
              ]),
            ),
            requireBinding: require,
            moduleBinding: module,
            exportsBinding: exports,
            filenameBinding: __filename,
            dirnameBinding: __dirname,
            moduleExports: module.exports,
          },
          cache: require.cache,
          during: Object.values(require.cache).includes(module),
          dep,
        };
        ({ marker: 'completion' });
      }`);
      const probe = Reflect.get(globalThis, EVAL_PROBE) as EvalIdentityProbe;

      expect(completion).not.toBeNull();
      expect(completion).not.toBeUndefined();
      expect({
        thisIsGlobal: probe.thisIsGlobal,
        argumentsType: probe.argumentsType,
        filename: probe.filename,
        dirname: probe.dirname,
        moduleId: probe.moduleId,
        moduleFilename: probe.moduleFilename,
        modulePath: probe.modulePath,
        moduleParent: probe.moduleParent,
        moduleLoaded: probe.moduleLoaded,
        requireMain: probe.requireMain,
        during: probe.during,
        dep: {
          answer: probe.dep.answer,
          parentId: probe.dep.parentId,
          parentFilename: probe.dep.parentFilename,
        },
      }).toEqual({
        thisIsGlobal: true,
        argumentsType: 'undefined',
        filename: '[eval]',
        dirname: '.',
        moduleId: '[eval]',
        moduleFilename: '/work/[eval]',
        modulePath: '.',
        moduleParent: undefined,
        moduleLoaded: false,
        requireMain: undefined,
        during: false,
        dep: {
          answer: 42,
          parentId: '[eval]',
          parentFilename: '/work/[eval]',
        },
      });
      expect(probe.dep.parent).toBe(probe.moduleRecord);
      const bindingValues = {
        require: probe.bindings.requireBinding,
        module: probe.bindings.moduleBinding,
        exports: probe.bindings.moduleExports,
        __filename: probe.bindings.filenameBinding,
        __dirname: probe.bindings.dirnameBinding,
      };
      for (const key of CJS_BINDINGS) {
        const descriptor = probe.bindings.descriptors[key];
        expect(Object.keys(descriptor).sort(), key).toEqual(
          ['configurable', 'enumerable', 'value', 'writable'].sort(),
        );
        expect(descriptor.value, key).toBe(bindingValues[key]);
        expect(
          {
            writable: descriptor.writable,
            enumerable: descriptor.enumerable,
            configurable: descriptor.configurable,
          },
          key,
        ).toEqual({ writable: true, enumerable: true, configurable: true });
      }
      expect(probe.bindings.moduleBinding).toBe(probe.moduleRecord);
      expect(probe.bindings.exportsBinding).toBe(probe.bindings.moduleExports);
      expect(Object.values(probe.cache)).not.toContain(probe.moduleRecord);
      expectNoEvalRegistryRecord(runner.registry);
    } finally {
      restoreCjsBindings(bindings);
    }
  });

  it('keeps both sequential detached records absent after return while reusing one loader', () => {
    const vfs = new MemoryFsSync();
    setSyncMirror(vfs);
    vfs.loadFixture({
      '/work/dep.cjs': `
globalThis.${DEP_LOADS} = (globalThis.${DEP_LOADS} ?? 0) + 1;
module.exports = { load: globalThis.${DEP_LOADS}, parent: module.parent };
`,
    });
    const bindings = snapshotCjsBindings();
    const source = `
      (globalThis.${EVAL_RUNS} ??= []).push({
        module,
        cache: require.cache,
        during: Object.values(require.cache).includes(module),
        child: require('./dep.cjs'),
      });
    `;

    try {
      const runner = reflectedCreateNodeEvalScriptRunner()({ vfs, cwd: '/work' });
      expectNoEvalRegistryRecord(runner.registry);
      runner.run(source);
      const first = (Reflect.get(globalThis, EVAL_RUNS) as EvalRecordProbe[])[0];
      if (first === undefined) throw new Error('first eval probe missing');

      expect(first.during).toBe(false);
      expect(first.child.parent).toBe(first.module);
      expect(Object.values(first.cache)).not.toContain(first.module);
      expectNoEvalRegistryRecord(runner.registry);

      runner.run(source);
      const runs = Reflect.get(globalThis, EVAL_RUNS) as EvalRecordProbe[];
      const second = runs[1];
      if (second === undefined) throw new Error('second eval probe missing');

      expect(runs).toHaveLength(2);
      expect(second.during).toBe(false);
      expect(second.module).not.toBe(first.module);
      expect(second.child).toBe(first.child);
      expect(second.child.parent).toBe(first.module);
      expect(second.child.parent).not.toBe(second.module);
      expect(Reflect.get(globalThis, DEP_LOADS)).toBe(1);
      expectNoEvalRegistryRecord(runner.registry);
      for (const cache of [first.cache, second.cache]) {
        expect(Object.values(cache)).not.toContain(first.module);
        expect(Object.values(cache)).not.toContain(second.module);
      }
    } finally {
      restoreCjsBindings(bindings);
    }
  });

  it('keeps eval CommonJS bindings live through an asynchronous completion', async () => {
    const vfs = new MemoryFsSync();
    setSyncMirror(vfs);
    vfs.loadFixture({
      '/work/dep.cjs': 'module.exports = { answer: 42 };',
    });
    const bindings = snapshotCjsBindings();

    try {
      const runner = reflectedCreateNodeEvalScriptRunner()({ vfs, cwd: '/work' });
      const completion = runner.run(`Promise.resolve().then(() => require('./dep.cjs').answer)`);

      await expect(completion).resolves.toBe(42);
      expectNoEvalRegistryRecord(runner.registry);
    } finally {
      restoreCjsBindings(bindings);
    }
  });

  it('preserves the realm Promise descriptor and identities before, during, and after eval', () => {
    const vfs = new MemoryFsSync();
    const bindings = snapshotCjsBindings();
    const beforeDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'Promise');
    if (beforeDescriptor === undefined) throw new Error('realm Promise descriptor missing');
    const beforeConstructor = Promise;
    const beforePrototype = Promise.prototype;
    const probe: PromiseRealmProbe = {};
    Reflect.set(globalThis, EVAL_PROBE, probe);

    try {
      const runner = reflectedCreateNodeEvalScriptRunner()({ vfs, cwd: '/work' });
      const completion = runner.run(`
        const completion = Promise.resolve(42);
        const probe = globalThis.${EVAL_PROBE};
        probe.during = {
          descriptor: Object.getOwnPropertyDescriptor(globalThis, 'Promise'),
          constructor: Promise,
          prototype: Promise.prototype,
          completionConstructor: completion.constructor,
          completionPrototype: Object.getPrototypeOf(completion),
        };
        completion;
      `);
      const during = probe.during;
      if (during === undefined) throw new Error('eval Promise probe missing');

      expect(beforeDescriptor.value).toBe(beforeConstructor);
      expect(during.descriptor).toEqual(beforeDescriptor);
      expect(during.constructor).toBe(beforeConstructor);
      expect(during.prototype).toBe(beforePrototype);
      expect(during.completionConstructor).toBe(beforeConstructor);
      expect(during.completionPrototype).toBe(beforePrototype);
      expect(Object.getOwnPropertyDescriptor(globalThis, 'Promise')).toEqual(beforeDescriptor);
      expect(Promise).toBe(beforeConstructor);
      expect(Promise.prototype).toBe(beforePrototype);
      expect(completion).toBeInstanceOf(beforeConstructor);
      expect((completion as { readonly constructor: unknown }).constructor).toBe(beforeConstructor);
      expect(Object.getPrototypeOf(completion)).toBe(beforePrototype);
    } finally {
      Object.defineProperty(globalThis, 'Promise', beforeDescriptor);
      restoreCjsBindings(bindings);
    }
  });

  it.each([
    ['ordinary invalid JavaScript', 'const value = ;'],
    ['a top-level return', 'return 1;'],
    ['an incomplete destructured parameter', 'function f( {'],
    ['an invalid repeated dot', 'let a..b'],
    ['an ESM import in CommonJS eval', 'import value from "pkg"'],
    ['an ESM export in CommonJS eval', 'export const value = 1'],
    ['a decorator', '@dec class Value {}'],
  ])('preserves %s as a real SyntaxError', (_description, source) => {
    const vfs = new MemoryFsSync();
    const bindings = snapshotCjsBindings();
    let thrown: unknown;

    try {
      const runner = reflectedCreateNodeEvalScriptRunner()({ vfs, cwd: '/work' });
      runner.run(source);
    } catch (error) {
      thrown = error;
    } finally {
      restoreCjsBindings(bindings);
    }

    expect(thrown).toBeInstanceOf(SyntaxError);
    expect(thrown).not.toBeInstanceOf(NotImplementedError);
  });

  it.each([
    'const n: number = 1; n',
    'value as number',
    'import type { Value } from "pkg"',
    'function f<T>(value?: T): T { return value! }',
    'function f(this) {}; f',
  ])('rejects TypeScript-only eval source through the named loud gap: %s', (source) => {
    const vfs = new MemoryFsSync();
    const bindings = snapshotCjsBindings();
    const createRunner = reflectedCreateNodeEvalScriptRunner();
    let thrown: unknown;
    try {
      const runner = createRunner({ vfs, cwd: '/work' });
      runner.run(source);
    } catch (error) {
      thrown = error;
    } finally {
      restoreCjsBindings(bindings);
    }

    expect(thrown).toBeInstanceOf(NotImplementedError);
    expect((thrown as NotImplementedError).feature).toBe('runtime-js.node-eval-typescript-context');
  });

  it('preserves JavaScript SyntaxError when explicit CommonJS disables TypeScript stripping', () => {
    const vfs = new MemoryFsSync();
    const bindings = snapshotCjsBindings();
    let thrown: unknown;
    try {
      const runner = reflectedCreateNodeEvalScriptRunner()({
        vfs,
        cwd: '/work',
        explicitCommonJs: true,
      });
      runner.run('const n: number = 1');
    } catch (error) {
      thrown = error;
    } finally {
      restoreCjsBindings(bindings);
    }

    expect(thrown).toBeInstanceOf(SyntaxError);
    expect(thrown).not.toBeInstanceOf(NotImplementedError);
    expect((thrown as Error).message).toContain('Missing initializer in const declaration');
  });

  it.each([
    {
      label: 'guest microtask',
      origin: 'uncaught' as const,
      source: "queueMicrotask(()=>{throw new Error('micro')});42",
      stack:
        'Error: micro\n    at eval ([eval]:1:27)\n    at node:internal/process/task_queues:151:7',
      caret: 26,
    },
    {
      label: 'promise reaction',
      origin: 'unhandled' as const,
      source: "Promise.resolve().then(()=>{throw new Error('then')});42",
      stack:
        'Error: then\n    at eval ([eval]:1:35)\n    at node:internal/process/task_queues:105:5',
      caret: 34,
    },
    {
      label: 'timer callback',
      origin: 'uncaught' as const,
      source: "setTimeout(()=>{throw new Error('timer')},0);42",
      stack:
        'Error: timer\n    at eval ([eval]:1:23)\n    at Timeout._onTimeout (/runtime/builtins/timers.ts:108:7)',
      caret: 16,
    },
  ])('projects the Node caret location for a late $label', ({ origin, source, stack, caret }) => {
    const error = new Error('placeholder');
    error.stack = stack;

    const projected = loaderImplementation.projectNodeEvalError(error, source, origin);

    expect(projected).toBe(error);
    expect(error.stack).toContain(`${source}\n${' '.repeat(caret)}^\n`);
  });
});
