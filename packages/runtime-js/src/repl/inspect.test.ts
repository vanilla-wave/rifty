import { describe, expect, it } from 'vitest';
import { formatArgs, formatNodeEvalPrintValue, inspect } from './inspect.ts';

describe('inspect', () => {
  it('formats primitives', () => {
    expect(inspect(undefined)).toBe('undefined');
    expect(inspect(null)).toBe('null');
    expect(inspect(42)).toBe('42');
    expect(inspect(true)).toBe('true');
    expect(inspect('hi')).toBe("'hi'");
    // Node renders bigints with a trailing `n` at every depth.
    expect(inspect(3n)).toBe('3n');
    expect(inspect({ a: 3n })).toBe('{ a: 3n }');
    expect(inspect([1n, 2n])).toBe('[ 1n, 2n ]');
  });

  it('formats arrays', () => {
    expect(inspect([1, 2, 3])).toBe('[ 1, 2, 3 ]');
  });

  it('formats objects', () => {
    expect(inspect({ a: 1, b: 'two' })).toBe("{ a: 1, b: 'two' }");
  });

  it('labels circular refs with Node reference ids', () => {
    const o: Record<string, unknown> = { name: 'root' };
    o.self = o;
    expect(inspect(o)).toBe("<ref *1> { name: 'root', self: [Circular *1] }");
  });

  it('formatArgs passes strings through verbatim', () => {
    expect(formatArgs(['hello', 1, { a: 1 }])).toBe('hello 1 { a: 1 }');
  });

  it('formats functions with name', () => {
    function foo() {}
    expect(inspect(foo)).toBe('[Function: foo]');
  });

  it('formats Error with stack', () => {
    const err = new Error('boom');
    const out = inspect(err);
    expect(out).toContain('Error');
    expect(out).toContain('boom');
  });

  it('prints a rejected eval Error with only the canonical user frame', async () => {
    const error = new Error('print-nope');
    error.stack =
      'Error: print-nope\n    at eval ([eval]:1:16)\n    at /project/runtime-js/loader.ts:1:1';
    const originalStack = error.stack;

    await expect(formatNodeEvalPrintValue(Promise.reject(error))).resolves.toBe(
      'Promise {\n  <rejected> Error: print-nope\n      at [eval]:1:16\n}',
    );
    expect(error.stack).toBe(originalStack);
  });

  it('does not consult a guest-mutated Promise.resolve while inspecting', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(Promise, 'resolve');
    if (descriptor === undefined) throw new Error('Promise.resolve descriptor missing');
    const resolve = Promise.resolve.bind(Promise);
    let calls = 0;
    Object.defineProperty(Promise, 'resolve', {
      ...descriptor,
      value: (value: unknown) => {
        calls += 1;
        return resolve(value);
      },
    });

    let pendingOutput: Promise<string>;
    let interceptedCalls: number;
    try {
      pendingOutput = formatNodeEvalPrintValue(new Promise(() => {}));
      interceptedCalls = calls;
    } finally {
      Object.defineProperty(Promise, 'resolve', descriptor);
    }
    const output = await pendingOutput;
    expect(output).toBe('Promise { <pending> }');
    expect(interceptedCalls).toBe(0);
  });
});
