import { describe, expect, it } from 'vitest';
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
