import { describe, expect, it } from 'vitest';
import assert from './assert.ts';

describe('assert.ifError', () => {
  it('passes through null/undefined', () => {
    expect(() => assert.ifError(null)).not.toThrow();
    expect(() => assert.ifError(undefined)).not.toThrow();
  });

  it('throws an AssertionError preserving the ORIGINAL error stack frames', () => {
    function deepThrowSite(): Error {
      return new Error('boom'); // a recognisable frame in the original stack
    }
    const original = deepThrowSite();
    try {
      assert.ifError(original);
      throw new Error('ifError did not throw');
    } catch (e) {
      const err = e as Error & { code?: string; operator?: string };
      expect(err.code).toBe('ERR_ASSERTION');
      expect(err.operator).toBe('ifError');
      expect(err.message).toBe('ifError got unwanted exception: boom');
      // The original throw-site frame must survive in the thrown stack (Node
      // contract), not just the message — proves we appended the real frames.
      expect(err.stack).toContain('deepThrowSite');
    }
  });

  it('inspects a non-Error value in the message', () => {
    expect(() => assert.ifError('xyz')).toThrow("ifError got unwanted exception: 'xyz'");
  });
});
