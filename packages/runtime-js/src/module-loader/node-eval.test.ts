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
      expect(runner.registry.has('/work/[eval]')).toBe(false);
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
      expect(Object.values(probe.cache)).not.toContain(probe.moduleRecord);
      expect(runner.registry.has('/work/[eval]')).toBe(false);
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
      expect(runner.registry.has('/work/[eval]')).toBe(false);
      runner.run(source);
      const first = (Reflect.get(globalThis, EVAL_RUNS) as EvalRecordProbe[])[0];
      if (first === undefined) throw new Error('first eval probe missing');

      expect(first.during).toBe(false);
      expect(first.child.parent).toBe(first.module);
      expect(Object.values(first.cache)).not.toContain(first.module);
      expect(runner.registry.has('/work/[eval]')).toBe(false);

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
      expect(runner.registry.has('/work/[eval]')).toBe(false);
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
      expect(runner.registry.has('/work/[eval]')).toBe(false);
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

  it('rejects TypeScript-only eval source through the named loud gap', () => {
    const vfs = new MemoryFsSync();
    const bindings = snapshotCjsBindings();
    const createRunner = reflectedCreateNodeEvalScriptRunner();
    let thrown: unknown;
    try {
      const runner = createRunner({ vfs, cwd: '/work' });
      runner.run('const n: number = 1; n');
    } catch (error) {
      thrown = error;
    } finally {
      restoreCjsBindings(bindings);
    }

    expect(thrown).toBeInstanceOf(NotImplementedError);
    expect((thrown as NotImplementedError).feature).toBe('runtime-js.node-eval-typescript-context');
  });
});
