import { describe, expect, it } from 'vitest';
import nodeEvalContextCase from '../cases/process/node-eval-context.case.ts';
import { nodeCliEvalInvocations, nodeCliEvalSourceTerminatorMatrix } from './node-cli-eval.ts';
import type { NodeCliEvalInvocation, ParityCase } from './types.ts';

function evalCase(invocations: readonly NodeCliEvalInvocation[]): ParityCase {
  return {
    kind: 'node-cli-eval',
    code: '',
    expectedPhysicalWorkers: invocations.length,
    nodeCliEval: { sequential: invocations },
  };
}

describe('node CLI eval invocation model', () => {
  it('keeps the identity proof to exactly two simultaneous physical children', () => {
    expect(nodeEvalContextCase.nodeCliEval?.concurrent?.map(({ label }) => label)).toEqual([
      'isolation-concurrent-a',
      'isolation-concurrent-b',
    ]);
  });

  it('derives the Rifty launch semantics from the exact native argv carrier', () => {
    const { sequential } = nodeCliEvalInvocations(
      evalCase([
        {
          label: 'separated-eval',
          nodeArgv: ['--eval', 'source-a', '--', 'alpha', '-x'],
        },
        {
          label: 'inline-eval',
          nodeArgv: ['--eval=source-b', 'beta'],
        },
        {
          label: 'print-equals-nonempty-rhs',
          nodeArgv: ['--print=not-the-source', 'source-c', 'gamma'],
        },
        {
          label: 'print-equals-empty-rhs',
          nodeArgv: ['--print=', 'source-d', 'delta'],
        },
        {
          label: 'bare-print',
          nodeArgv: ['-p'],
        },
      ]),
    );

    expect(sequential).toEqual([
      {
        label: 'separated-eval',
        nodeArgv: ['--eval', 'source-a', '--', 'alpha', '-x'],
        source: 'source-a',
        print: false,
        execArgv: ['--eval', 'source-a'],
        scriptArgs: ['alpha', '-x'],
      },
      {
        label: 'inline-eval',
        nodeArgv: ['--eval=source-b', 'beta'],
        source: 'source-b',
        print: false,
        execArgv: ['--eval=source-b'],
        scriptArgs: ['beta'],
      },
      {
        label: 'print-equals-nonempty-rhs',
        nodeArgv: ['--print=not-the-source', 'source-c', 'gamma'],
        source: 'source-c',
        print: true,
        execArgv: ['--print=not-the-source', 'source-c'],
        scriptArgs: ['gamma'],
      },
      {
        label: 'print-equals-empty-rhs',
        nodeArgv: ['--print=', 'source-d', 'delta'],
        source: 'source-d',
        print: true,
        execArgv: ['--print=', 'source-d'],
        scriptArgs: ['delta'],
      },
      {
        label: 'bare-print',
        nodeArgv: ['-p'],
        source: '',
        print: true,
        execArgv: ['-p'],
        scriptArgs: [],
      },
    ]);
  });

  it.each(nodeCliEvalSourceTerminatorMatrix('source'))(
    '$option projects the $sourceState source × terminator row from raw argv',
    ({ label, nodeArgv, expected }) => {
      if (expected.kind === 'usage-error') {
        expect(() => nodeCliEvalInvocations(evalCase([{ label, nodeArgv }]))).toThrow(
          'requires a source argument',
        );
        return;
      }

      const { sequential } = nodeCliEvalInvocations(evalCase([{ label, nodeArgv }]));
      expect(sequential).toEqual([
        {
          label,
          nodeArgv,
          source: expected.source,
          print: expected.print,
          execArgv: expected.execArgv,
          scriptArgs: expected.scriptArgs,
        },
      ]);
    },
  );

  it('projects an immediate terminator after inline --eval source', () => {
    const label = 'inline-eval-terminator';
    const nodeArgv = ['--eval=source', '--', 'alpha', 'two words', '-x'];
    const { sequential } = nodeCliEvalInvocations(evalCase([{ label, nodeArgv }]));

    expect(sequential).toEqual([
      {
        label,
        nodeArgv,
        source: 'source',
        print: false,
        execArgv: ['--eval=source'],
        scriptArgs: ['alpha', 'two words', '-x'],
      },
    ]);
  });

  it('preserves explicit CommonJS input type across eval grammar boundaries', () => {
    const invocations = [
      {
        label: 'commonjs-eval',
        nodeArgv: ['--input-type=commonjs', '-e', 'source-a', 'alpha'],
      },
      {
        label: 'commonjs-inline-eval',
        nodeArgv: ['--input-type=commonjs', '--eval=source-b', '--', 'beta'],
      },
      {
        label: 'commonjs-empty-print-terminator',
        nodeArgv: ['--input-type=commonjs', '-p', '--', '', 'gamma'],
      },
    ] as const satisfies readonly NodeCliEvalInvocation[];

    expect(nodeCliEvalInvocations(evalCase(invocations)).sequential).toEqual([
      {
        ...invocations[0],
        source: 'source-a',
        print: false,
        execArgv: ['--input-type=commonjs', '-e', 'source-a'],
        scriptArgs: ['alpha'],
      },
      {
        ...invocations[1],
        source: 'source-b',
        print: false,
        execArgv: ['--input-type=commonjs', '--eval=source-b'],
        scriptArgs: ['beta'],
      },
      {
        ...invocations[2],
        source: '',
        print: true,
        execArgv: ['--input-type=commonjs', '-p'],
        scriptArgs: ['', 'gamma'],
      },
    ]);
  });

  it.each(['-p', '--print', '--print=ignored', '--print=not-the-source', '--print='] as const)(
    '%s projects a separated empty token as argv, not source-bearing execArgv',
    (option) => {
      const { sequential } = nodeCliEvalInvocations(
        evalCase([{ label: `empty-${option}`, nodeArgv: [option, ''] }]),
      );

      expect(sequential).toEqual([
        {
          label: `empty-${option}`,
          nodeArgv: [option, ''],
          source: '',
          print: true,
          execArgv: [option],
          scriptArgs: [''],
        },
      ]);
    },
  );

  it.each(['-p', '--print', '--print=ignored', '--print=not-the-source', '--print='] as const)(
    '%s rejects a terminator followed by a program entry as outside the eval carrier',
    (option) => {
      expect(() =>
        nodeCliEvalInvocations(
          evalCase([{ label: `program-after-${option}`, nodeArgv: [option, '--', 'x'] }]),
        ),
      ).toThrow('terminator selects a program entry, not eval');
    },
  );

  it.each(['-p', '--print', '--print=ignored', '--print=not-the-source', '--print='] as const)(
    '%s keeps an empty post-terminator token in entryless eval argv',
    (option) => {
      const label = `empty-entry-after-${option}`;
      const nodeArgv = [option, '--', '', 'alpha'];
      const { sequential } = nodeCliEvalInvocations(evalCase([{ label, nodeArgv }]));

      expect(sequential).toEqual([
        {
          label,
          nodeArgv,
          source: '',
          print: true,
          execArgv: [option],
          scriptArgs: ['', 'alpha'],
        },
      ]);
    },
  );

  it('validates and snapshots the causal stdio handshake before either runner starts', () => {
    const stdioHandshake = [
      { stream: 'stdout' as const, marker: 'first|' },
      { stream: 'stderr' as const, marker: 'second\n' },
    ];
    const { sequential } = nodeCliEvalInvocations(
      evalCase([{ label: 'handshake', nodeArgv: ['-e', '42'], stdioHandshake }]),
    );

    expect(sequential[0]?.stdioHandshake).toEqual(stdioHandshake);
    expect(sequential[0]?.stdioHandshake).not.toBe(stdioHandshake);
    expect(Object.isFrozen(sequential[0]?.stdioHandshake)).toBe(true);
    expect(() =>
      nodeCliEvalInvocations(
        evalCase([
          {
            label: 'bad-handshake',
            nodeArgv: ['-e', '42'],
            stdioHandshake: [{ stream: 'stdout', marker: '', extra: true }],
          } as unknown as NodeCliEvalInvocation,
        ]),
      ),
    ).toThrow('must contain only an exact stream and non-empty marker');
  });

  it.each(['source', 'print', 'execArgv', 'scriptArgs'] as const)(
    'rejects the independently declared legacy %s half before either runner starts',
    (field) => {
      const invocation = {
        label: `legacy-${field}`,
        nodeArgv: ['-e', 'native-source', 'alpha'],
        [field]:
          field === 'source'
            ? 'different-rifty-source'
            : field === 'print'
              ? true
              : field === 'execArgv'
                ? ['-p', 'different-rifty-source']
                : ['different-rifty-arg'],
      };

      expect(() =>
        nodeCliEvalInvocations(evalCase([invocation as unknown as NodeCliEvalInvocation])),
      ).toThrow(`nodeCliEval.sequential[0].${field} is derived from nodeArgv`);
    },
  );
});
