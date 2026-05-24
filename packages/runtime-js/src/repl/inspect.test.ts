import { describe, expect, it } from 'vitest';
import { formatArgs, inspect } from './inspect.ts';

describe('inspect', () => {
  it('formats primitives', () => {
    expect(inspect(undefined)).toBe('undefined');
    expect(inspect(null)).toBe('null');
    expect(inspect(42)).toBe('42');
    expect(inspect(true)).toBe('true');
    expect(inspect('hi')).toBe('"hi"');
  });

  it('formats arrays', () => {
    expect(inspect([1, 2, 3])).toBe('[ 1, 2, 3 ]');
  });

  it('formats objects', () => {
    expect(inspect({ a: 1, b: 'two' })).toBe('{ a: 1, b: "two" }');
  });

  it('handles circular refs', () => {
    const o: Record<string, unknown> = {};
    o.self = o;
    expect(inspect(o)).toContain('[Circular]');
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
});
