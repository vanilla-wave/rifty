import { NotImplementedError } from '@riftydev/io';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  Script,
  compileFunction,
  createContext,
  runInContext,
  runInNewContext,
  runInThisContext,
} from './index.ts';
import { ensureVmEngineReady } from './quickjs-loader.ts';

// Unit runtime-js/vm-run-in-this-context-offsets: offsets are honoured on the
// host-realm entry points only; every sandbox entry point keeps a named loud
// gap for a VALID non-zero offset, after Node's own int32 validation.

function thrownBy(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error('expected a throw');
}

function expectGap(fn: () => unknown, feature: string): void {
  const error = thrownBy(fn);
  expect(error).toBeInstanceOf(NotImplementedError);
  expect((error as NotImplementedError).feature).toBe(feature);
}

describe('vm offsets outside the host realm', () => {
  // Sandbox contexts need the default QuickJS engine loaded (boot does this in a worker).
  beforeAll(async () => {
    await ensureVmEngineReady();
  });

  it('a Script built with offsets runs in this context and stays loud in a sandbox', () => {
    const lined = new Script('40 + 2', { filename: '/virtual/lined.js', lineOffset: 2 });
    expect(lined.runInThisContext()).toBe(42);
    expectGap(() => lined.runInContext(createContext({})), 'vm.Script.lineOffset');
    expectGap(() => lined.runInNewContext({}), 'vm.Script.lineOffset');

    const columned = new Script('40 + 2', { filename: '/virtual/columned.js', columnOffset: -3 });
    expect(columned.runInThisContext()).toBe(42);
    expectGap(() => columned.runInContext(createContext({})), 'vm.Script.columnOffset');
    expectGap(() => columned.runInNewContext({}), 'vm.Script.columnOffset');
  });

  it('sandbox entry points name the gap for valid offsets', () => {
    expectGap(
      () => runInContext('1', createContext({}), { lineOffset: 1 }),
      'vm.runInContext.lineOffset',
    );
    expectGap(() => runInNewContext('1', {}, { columnOffset: 1 }), 'vm.runInContext.columnOffset');
    expectGap(
      () => compileFunction('return 1', [], { lineOffset: 1 }),
      'vm.compileFunction.lineOffset',
    );
    expectGap(
      () => compileFunction('return 1', [], { columnOffset: -1 }),
      'vm.compileFunction.columnOffset',
    );
  });

  it("invalid offsets fail Node's validation before any gap", () => {
    // Node v24.16.0: evidence §Validation (vm.runInContext → new Script → validateInt32).
    const invalidType = thrownBy(() =>
      runInContext('1', createContext({}), { lineOffset: '1' as unknown as number }),
    ) as { name?: string; code?: string; message?: string };
    expect([invalidType.name, invalidType.code, invalidType.message]).toEqual([
      'TypeError',
      'ERR_INVALID_ARG_TYPE',
      `The "options.lineOffset" property must be of type number. Received type string ('1')`,
    ]);
    const fraction = thrownBy(() => compileFunction('return 1', [], { columnOffset: 1.5 })) as {
      name?: string;
      code?: string;
      message?: string;
    };
    expect([fraction.name, fraction.code, fraction.message]).toEqual([
      'RangeError',
      'ERR_OUT_OF_RANGE',
      'The value of "options.columnOffset" is out of range. It must be an integer. Received 1.5',
    ]);
  });

  it('zero offsets keep every entry point working', () => {
    expect(runInThisContext('1 + 1', { lineOffset: 0, columnOffset: 0 })).toBe(2);
    expect(runInContext('1 + 1', createContext({}), { lineOffset: 0, columnOffset: -0 })).toBe(2);
  });
});
