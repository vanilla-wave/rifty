import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runInThisContext } from './index.ts';

// Unit runtime-js/vm-run-in-this-context-offsets, fault matrix: a script's own
// `sourceURL` (Node v24.16.0 oracle: parity case
// vm/run-in-this-context-own-source-url) is read by a V8 probe that borrows
// `Error.stackTraceLimit` / `Error.prepareStackTrace` for one synchronous
// formatting. Each row drives another writer of those slots.

declare global {
  var __riftyOwnRuns: number | undefined;
}

const OWN_SOURCE = '(function f() {\n  return new Error("s") })\n//# sourceURL=/virtual/own.js';
const OWN_FRAME = '/virtual/own.js:2:10';
const OFFSETS = { filename: '/virtual/file.js', lineOffset: 3, columnOffset: 2 };
const PLAIN_SOURCE = 'var s = "sourceURL";\n(function p() {\n  return new Error("s") })';
const LATE_SOURCE = '(function outer() {\n  return function inner() { throw new Error("late") } })';
const LATE_FRAME = '/virtual/late.js:4:35';

function frameOf(error: unknown): string {
  return /\/virtual\/[a-z]+\.js(?::-?\d+){0,2}/.exec(String((error as Error).stack))?.[0] ?? '';
}

function lateFrame(inner: () => void): string {
  try {
    inner();
  } catch (error) {
    return frameOf(error);
  }
  return 'no-throw';
}

let saved: { limit?: PropertyDescriptor; hook?: PropertyDescriptor };

function restore(
  key: string,
  descriptor: PropertyDescriptor | undefined,
  target: object = Error,
): void {
  if (descriptor) Object.defineProperty(target, key, descriptor);
  else Reflect.deleteProperty(target, key);
}

beforeEach(() => {
  saved = {
    limit: Object.getOwnPropertyDescriptor(Error, 'stackTraceLimit'),
    hook: Object.getOwnPropertyDescriptor(Error, 'prepareStackTrace'),
  };
});

afterEach(() => {
  restore('stackTraceLimit', saved.limit);
  restore('prepareStackTrace', saved.hook);
  globalThis.__riftyOwnRuns = undefined;
});

describe("a script's own sourceURL is read without disturbing the stack slots", () => {
  it('guest accessors on both slots are never invoked and keep their descriptors', () => {
    const calls: string[] = [];
    const limit: PropertyDescriptor = {
      configurable: true,
      enumerable: true,
      get: () => calls.push('limit get'),
      set: () => calls.push('limit set'),
    };
    const hook: PropertyDescriptor = {
      configurable: true,
      enumerable: false,
      get: () => calls.push('hook get'),
      set: () => calls.push('hook set'),
    };
    Object.defineProperty(Error, 'stackTraceLimit', limit);
    Object.defineProperty(Error, 'prepareStackTrace', hook);

    const own = runInThisContext(OWN_SOURCE, { filename: '/virtual/file.js' }) as () => Error;

    expect(calls).toEqual([]);
    expect(Object.getOwnPropertyDescriptor(Error, 'stackTraceLimit')).toEqual(limit);
    expect(Object.getOwnPropertyDescriptor(Error, 'prepareStackTrace')).toEqual(hook);
    restore('stackTraceLimit', saved.limit);
    restore('prepareStackTrace', saved.hook);
    expect(frameOf(own())).toBe(OWN_FRAME);
  });

  it('a zero stack trace limit still finds the name and stays zero', () => {
    Error.stackTraceLimit = 0;
    const own = runInThisContext(OWN_SOURCE, OFFSETS) as () => Error;
    expect(Error.stackTraceLimit).toBe(0);
    Error.stackTraceLimit = 10;
    expect(frameOf(own())).toBe(OWN_FRAME);
  });

  it('the guest code runs once; code that parses only inside the probe never runs', () => {
    globalThis.__riftyOwnRuns = 0;
    runInThisContext(`globalThis.__riftyOwnRuns++;\n${OWN_SOURCE}`, OFFSETS);
    expect(globalThis.__riftyOwnRuns).toBe(1);

    const injected =
      '1;}; globalThis.__riftyOwnRuns = 99; function z() {\n//# sourceURL=/virtual/x.js';
    expect(() => runInThisContext(injected, OFFSETS)).toThrow(SyntaxError);
    expect(globalThis.__riftyOwnRuns).toBe(1);
  });

  it('the offset owner survives the probe and keeps projecting', () => {
    const inner = (
      runInThisContext(LATE_SOURCE, {
        filename: '/virtual/late.js',
        lineOffset: 2,
        columnOffset: -4,
      }) as () => () => void
    )();
    const owner = Object.getOwnPropertyDescriptor(Error, 'prepareStackTrace');

    const own = runInThisContext(OWN_SOURCE, { filename: '/virtual/file.js' }) as () => Error;

    expect(Object.getOwnPropertyDescriptor(Error, 'prepareStackTrace')).toEqual(owner);
    expect(frameOf(own())).toBe(OWN_FRAME);
    expect(lateFrame(inner)).toBe(LATE_FRAME);
  });

  it("inside a stack hook V8 skips the probe's hook: the name is V8's own frame, no guest accessor runs", () => {
    // Node v24.16.0 (parity vm/run-in-this-context-own-source-url-in-hook):
    // own name, offsets dropped; unnamed code keeps its filename and offsets.
    const calls: string[] = [];
    const lie = 'Error\n    at eval (/virtual/lie.js:3:8)';
    const proto = {
      name: Object.getOwnPropertyDescriptor(Error.prototype, 'name'),
      message: Object.getOwnPropertyDescriptor(Error.prototype, 'message'),
    };
    let made: Array<() => Error> = [];
    let thrown: unknown;
    Error.prepareStackTrace = () => {
      Object.defineProperty(Error.prototype, 'name', {
        configurable: true,
        get() {
          calls.push('name');
          return lie;
        },
        set() {},
      });
      Object.defineProperty(Error.prototype, 'message', {
        configurable: true,
        get() {
          calls.push('message');
          return '';
        },
        set() {},
      });
      try {
        made = [
          runInThisContext(OWN_SOURCE, OFFSETS) as () => Error,
          runInThisContext(PLAIN_SOURCE, {
            ...OFFSETS,
            filename: '/virtual/plain.js',
          }) as () => Error,
          runInThisContext(PLAIN_SOURCE, { filename: '/virtual/zero.js' }) as () => Error,
        ];
      } catch (error) {
        thrown = error;
      } finally {
        restore('name', proto.name, Error.prototype);
        restore('message', proto.message, Error.prototype);
      }
      return 'hooked';
    };
    void new Error('outer').stack;
    (Error as { prepareStackTrace?: unknown }).prepareStackTrace = undefined;

    expect(thrown).toBeUndefined();
    expect(calls).toEqual([]);
    expect(made.map((make) => frameOf(make()))).toEqual([
      OWN_FRAME,
      '/virtual/plain.js:6:10',
      '/virtual/zero.js:3:10',
    ]);
  });

  it('a frozen Error is a named gap wherever the slots are needed', () => {
    // Node v24.16.0: all three calls run (evidence §Own sourceURL). A separate
    // process: freezing this realm's Error cannot be undone.
    const vmIndex = fileURLToPath(new URL('./index.ts', import.meta.url));
    const script = [
      `import { runInThisContext } from ${JSON.stringify(vmIndex)};`,
      'Object.freeze(Error);',
      "const gap = (fn) => { try { fn(); return 'ran'; } catch (e) { return e.name + ' ' + e.feature; } };",
      'console.log([',
      "  gap(() => runInThisContext('1', { filename: '/virtual/plain.js' })),",
      "  gap(() => runInThisContext('1\\n//# sourceURL=/virtual/own.js', { filename: '/virtual/f.js' })),",
      "  gap(() => runInThisContext('1', { filename: '/virtual/f.js', lineOffset: 1 })),",
      "].join('|'));",
    ].join('\n');
    const output = execFileSync(
      process.execPath,
      ['--import', 'tsx', '--input-type=module', '-e', script],
      { encoding: 'utf8', cwd: fileURLToPath(new URL('../../../../..', import.meta.url)) },
    );
    expect(output.trim()).toBe(
      'ran|NotImplementedError vm.runInThisContext.frozenError|NotImplementedError vm.runInThisContext.frozenError',
    );
  });
});
