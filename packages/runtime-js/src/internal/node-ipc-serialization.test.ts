import { describe, expect, it } from 'vitest';
import { serializeNodeIpcMessage } from './node-ipc-serialization.ts';

function capture(value: unknown): Error & { code?: string } {
  try {
    serializeNodeIpcMessage(value);
  } catch (error) {
    return error as Error & { code?: string };
  }
  throw new Error('expected serialization to throw');
}

describe('Node default child-process IPC serialization', () => {
  it('uses Node top-level argument validation codes', () => {
    expect(capture(undefined)).toMatchObject({ name: 'TypeError', code: 'ERR_MISSING_ARGS' });
    for (const value of [() => {}, Symbol('message'), 1n]) {
      expect(capture(value)).toMatchObject({ name: 'TypeError', code: 'ERR_INVALID_ARG_TYPE' });
    }
  });

  it('leaves nested JSON failures as native uncoded TypeErrors', () => {
    const circular: { self?: unknown } = {};
    circular.self = circular;

    const nestedBigInt = capture({ value: 1n });
    const circularError = capture(circular);
    expect(nestedBigInt).toMatchObject({ name: 'TypeError' });
    expect(nestedBigInt).not.toHaveProperty('code');
    expect(circularError).toMatchObject({ name: 'TypeError' });
    expect(circularError).not.toHaveProperty('code');
  });
});
