import { describe, expect, it } from 'vitest';
import { processExitFromChildEvent } from './process-exit.ts';

describe('processExitFromChildEvent', () => {
  it.each([
    [0, null, { code: 0, signal: null }],
    [7, null, { code: 7, signal: null }],
    [null, 'SIGINT', { code: null, signal: 'SIGINT' }],
    [null, 'SIGTERM', { code: null, signal: 'SIGTERM' }],
  ] as const)('accepts the exact child pair (%s, %s)', (code, signal, expected) => {
    expect(processExitFromChildEvent(code, signal)).toEqual(expected);
  });

  it.each([
    [0, 'SIGTERM'],
    [null, null],
    [null, 'SIGKILL'],
    [-1, null],
    [1.5, null],
  ] as const)('rejects the invalid child pair (%s, %s)', (code, signal) => {
    expect(() => processExitFromChildEvent(code, signal)).toThrow(/invalid exit/i);
  });
});
