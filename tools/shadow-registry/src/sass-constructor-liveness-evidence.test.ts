import { describe, expect, it } from 'vitest';
import evidence from './fixtures/sass-1.100.0-constructor-liveness.json';

describe('Sass 1.100.0 invalid-construction liveness evidence', () => {
  it('pins natural pure-Sass exit and the embedded refed child twice', () => {
    expect(evidence).toMatchObject({
      schema: 1,
      node: 'v24.16.0',
      platform: 'darwin',
      arch: 'arm64',
      timeoutMs: 1_500,
      attempts: 2,
    });
    for (const moduleKind of ['cjs', 'esm'] as const) {
      for (const constructorName of ['Compiler', 'AsyncCompiler'] as const) {
        const pureRuns = evidence.runs.sass[moduleKind][constructorName];
        const embeddedRuns = evidence.runs['sass-embedded'][moduleKind][constructorName];
        expect(pureRuns).toHaveLength(2);
        expect(embeddedRuns).toHaveLength(2);
        for (const run of pureRuns) {
          expect(run).toMatchObject({
            timedOut: false,
            exitCode: 0,
            signal: null,
            stderr: '',
          });
          expect(JSON.parse(run.stdout) as unknown).toMatchObject({
            outcome: 'throw',
            message: expect.stringContaining('can not be directly constructed'),
          });
        }
        for (const run of embeddedRuns) {
          expect(run).toMatchObject({
            timedOut: true,
            exitCode: null,
            signal: 'SIGKILL',
            stderr: '',
          });
          expect(JSON.parse(run.stdout) as unknown).toMatchObject({
            outcome: 'throw',
            message: expect.stringMatching(
              /^Compiler caused error: (?:Async)?Compiler can not be directly constructed/,
            ),
          });
        }
      }
    }
  });
});
