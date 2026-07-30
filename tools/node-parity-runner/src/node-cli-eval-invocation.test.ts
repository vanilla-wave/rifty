import { describe, expect, it } from 'vitest';
import { nodeCliEvalInvocations } from './node-cli-eval.ts';
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
          label: 'print-equals',
          nodeArgv: ['--print=ignored', 'source-c', 'gamma'],
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
        label: 'print-equals',
        nodeArgv: ['--print=ignored', 'source-c', 'gamma'],
        source: 'source-c',
        print: true,
        execArgv: ['--print=ignored', 'source-c'],
        scriptArgs: ['gamma'],
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
