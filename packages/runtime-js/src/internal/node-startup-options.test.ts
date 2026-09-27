import { Worker as NativeWorker } from 'node:worker_threads';
import { expect, it } from 'vitest';
import { Worker } from '../builtins/worker_threads.ts';

for (const execArgv of [
  ['--conditions', '--unknown'],
  ['--require', '--conditions', 'development'],
]) {
  it(`preserves native operand validation before another option: ${execArgv.join(' ')}`, () => {
    let expected: unknown;
    try {
      new NativeWorker('0', { eval: true, execArgv });
    } catch (error) {
      expected = error;
    }
    expect(expected).toBeInstanceOf(Error);
    expect(() => new Worker('/unused-entry.cjs', { execArgv })).toThrowError(
      expect.objectContaining({
        name: (expected as Error).name,
        message: (expected as Error).message,
        code: 'ERR_WORKER_INVALID_EXEC_ARGV',
      }),
    );
  });
}
