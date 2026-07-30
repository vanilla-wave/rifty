import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { assertNodeCliEvalOracleVersion } from './node-cli-eval.ts';
import { runInNode } from './run-in-node.ts';

describe('runInNode', () => {
  it('runs node-cli-eval with exact native argv and returns canonical process output', async () => {
    const source = `
      console.log(JSON.stringify({
        execArgv: process.execArgv,
        argv: process.argv,
      }));
    `;
    const output = await runInNode({
      kind: 'node-cli-eval',
      code: '',
      expectedPhysicalWorkers: 1,
      nodeCliEval: {
        sequential: [
          {
            label: 'direct-short-e',
            nodeArgv: ['-e', source, '--', 'alpha'],
          },
        ],
      },
    });

    const outcomes = JSON.parse(output) as {
      readonly label: string;
      readonly stdout: string;
      readonly stderr: string;
      readonly frames: readonly { readonly stream: string; readonly text: string }[];
      readonly code: number | null;
      readonly signal: string | null;
    }[];
    const outcome = outcomes[0];
    if (outcome === undefined) throw new Error('native eval outcome missing');
    const observed = JSON.parse(outcome.stdout) as {
      readonly execArgv: readonly string[];
      readonly argv: readonly string[];
    };

    expect(outcomes).toHaveLength(1);
    expect(observed.execArgv).toEqual(['-e', source]);
    expect(observed.argv).toEqual(['<node>', 'alpha']);
    expect(outcome).toEqual({
      label: 'direct-short-e',
      stdout: outcome.stdout,
      stderr: '',
      frames: [{ stream: 'stdout', text: outcome.stdout }],
      code: 0,
      signal: null,
    });
  });

  it('terminates a real native oracle that exceeds the per-case timeout', async () => {
    await expect(
      runInNode(
        {
          code: 'setTimeout(() => process.exit(0), 500);',
        },
        { timeoutMs: 50 },
      ),
    ).rejects.toThrow('Node parity case timed out after 50ms');
  });
});

describe('Node v24.16.0 CLI eval oracle', () => {
  it('rejects every attached short eval/print source spelling with exact exit 9 stderr', () => {
    assertNodeCliEvalOracleVersion(process.version);
    const options = [
      '-eSRC',
      '-e=SRC',
      '-pSRC',
      '-p=SRC',
      '-peSRC',
      '-pe=SRC',
      '-epSRC',
      '-ep=SRC',
    ] as const;

    for (const option of options) {
      const outcome = spawnSync(process.execPath, [option], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      expect(outcome.error).toBeUndefined();
      expect(outcome.signal).toBeNull();
      expect(outcome.status).toBe(9);
      expect(outcome.stdout).toBe('');
      expect(outcome.stderr).toBe(`${process.execPath}: bad option: ${option}\n`);
    }
  });
});
