/**
 * Smoke conformance: ensure the inspect format we emit to stdout is broadly
 * Node-shaped (so a user looking at REPL output isn't surprised).
 */
import { describe, expect, it } from 'vitest';
import { inspect } from '../../packages/runtime-js/src/repl/inspect.ts';

describe('inspect (conformance)', () => {
  it('formats nested objects similar to Node util.inspect', () => {
    expect(inspect({ a: { b: 1 } })).toBe('{ a: { b: 1 } }');
  });
  it('uses class name as prefix', () => {
    class Point {
      x = 1;
      y = 2;
    }
    expect(inspect(new Point())).toBe('Point { x: 1, y: 2 }');
  });
});
