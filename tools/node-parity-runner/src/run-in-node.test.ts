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
  it('distinguishes separated empty source tokens from absent source', () => {
    assertNodeCliEvalOracleVersion(process.version);
    const absentCases = [
      {
        nodeArgv: ['-e'],
        status: 9,
        stdout: '',
        stderr: `${process.execPath}: -e requires an argument\n`,
      },
      {
        nodeArgv: ['--eval'],
        status: 9,
        stdout: '',
        stderr: `${process.execPath}: --eval requires an argument\n`,
      },
      {
        nodeArgv: ['-pe'],
        status: 9,
        stdout: '',
        stderr: `${process.execPath}: --eval requires an argument\n`,
      },
      {
        nodeArgv: ['-p'],
        status: 0,
        stdout: 'undefined\n',
        stderr: '',
      },
      {
        nodeArgv: ['--print'],
        status: 0,
        stdout: 'undefined\n',
        stderr: '',
      },
      {
        nodeArgv: ['--print=ignored'],
        status: 0,
        stdout: 'undefined\n',
        stderr: '',
      },
    ] as const;
    const cases = [
      {
        nodeArgv: ['-e', ''],
        execArgv: ['-e', ''],
        argv: [],
        stdout: '',
      },
      {
        nodeArgv: ['--eval', ''],
        execArgv: ['--eval', ''],
        argv: [],
        stdout: '',
      },
      {
        nodeArgv: ['-pe', ''],
        execArgv: ['-pe', ''],
        argv: [],
        stdout: 'undefined\n',
      },
      {
        nodeArgv: ['-p', ''],
        execArgv: ['-p'],
        argv: [''],
        stdout: 'undefined\n',
      },
      {
        nodeArgv: ['--print', ''],
        execArgv: ['--print'],
        argv: [''],
        stdout: 'undefined\n',
      },
      {
        nodeArgv: ['--print=ignored', ''],
        execArgv: ['--print=ignored'],
        argv: [''],
        stdout: 'undefined\n',
      },
    ] as const;
    const probeSource =
      'console.log(JSON.stringify({execArgv:process.execArgv,argv:process.argv.slice(1)}))';
    const probeUrl = `data:text/javascript,${encodeURIComponent(probeSource)}`;

    for (const testCase of absentCases) {
      const outcome = spawnSync(process.execPath, testCase.nodeArgv, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      expect(outcome.error).toBeUndefined();
      expect(outcome.signal).toBeNull();
      expect(outcome.status).toBe(testCase.status);
      expect(outcome.stdout).toBe(testCase.stdout);
      expect(outcome.stderr).toBe(testCase.stderr);
    }

    for (const testCase of cases) {
      const outcome = spawnSync(process.execPath, testCase.nodeArgv, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      expect(outcome.error).toBeUndefined();
      expect(outcome.signal).toBeNull();
      expect(outcome.status).toBe(0);
      expect(outcome.stdout).toBe(testCase.stdout);
      expect(outcome.stderr).toBe('');

      const identityOutcome = spawnSync(process.execPath, testCase.nodeArgv, {
        encoding: 'utf8',
        env: { ...process.env, NODE_OPTIONS: `--import=${probeUrl}` },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const identity = JSON.stringify({
        execArgv: testCase.execArgv,
        argv: testCase.argv,
      });
      expect(identityOutcome.error).toBeUndefined();
      expect(identityOutcome.signal).toBeNull();
      expect(identityOutcome.status).toBe(0);
      expect(identityOutcome.stdout).toBe(`${identity}\n${testCase.stdout}`);
      expect(identityOutcome.stderr).toBe('');
    }

    for (const option of ['-p', '--print', '--print=ignored'] as const) {
      const identityOutcome = spawnSync(process.execPath, [option], {
        encoding: 'utf8',
        env: { ...process.env, NODE_OPTIONS: `--import=${probeUrl}` },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const identity = JSON.stringify({ execArgv: [option], argv: [] });
      expect(identityOutcome.error).toBeUndefined();
      expect(identityOutcome.signal).toBeNull();
      expect(identityOutcome.status).toBe(0);
      expect(identityOutcome.stdout).toBe(`${identity}\nundefined\n`);
      expect(identityOutcome.stderr).toBe('');
    }
  });

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
