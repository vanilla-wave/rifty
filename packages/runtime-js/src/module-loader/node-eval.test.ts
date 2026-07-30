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
  readonly child: object;
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
        dep: probe.dep,
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
module.exports = { load: globalThis.${DEP_LOADS} };
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
