import { describe, expect, it } from 'vitest';
import {
  assertNodeCliEvalOracleVersion,
  canonicalNodeCliEvalOutcome,
  createNodeCliEvalCapture,
  nodeCliEvalInvocations,
} from './node-cli-eval.ts';

describe('node CLI eval parity carrier', () => {
  it('fails loudly if the ambient Node oracle drifts from the frozen version', () => {
    expect(() => assertNodeCliEvalOracleVersion('v24.15.0')).toThrow(
      'node-cli-eval oracle requires v24.16.0; received v24.15.0',
    );
    expect(() => assertNodeCliEvalOracleVersion('v24.16.0')).not.toThrow();
  });

  it('canonicalises UTF-8 transport chunks without losing stream order', () => {
    const capture = createNodeCliEvalCapture();
    capture.push('stdout', new Uint8Array([0x61, 0xe2, 0x82]));
    capture.push('stderr', 'err\n');
    capture.push('stdout', new Uint8Array([0xac, 0x0a]));

    expect(capture.finish(7, null)).toEqual({
      stdout: 'a€\n',
      stderr: 'err\n',
      frames: [
        { stream: 'stderr', text: 'err\n' },
        { stream: 'stdout', text: 'a€\n' },
      ],
      code: 7,
      signal: null,
    });
  });

  it('keeps only the contracted eval error prelude and first user frame', () => {
    const value = canonicalNodeCliEvalOutcome(
      {
        label: 'throw',
        nodeArgv: [],
        source: "throw new Error('boom')",
        print: false,
        execArgv: [],
        scriptArgs: [],
        evalErrorStderr: true,
      },
      {
        stdout: '',
        stderr:
          "[eval]:1\nthrow new Error('boom')\n^\n\nError: boom\n    at [eval]:1:7\n    at node:internal/vm:1:1\n\nNode.js v24.16.0\n",
        frames: [
          { stream: 'stderr', text: '[eval]:1\n' },
          { stream: 'stderr', text: "throw new Error('boom')\n" },
        ],
        code: 1,
        signal: null,
      },
    );

    expect(value.stderr).toBe(
      "[eval]:1\nthrow new Error('boom')\n^\n\nError: boom\n    at [eval]:1:7\n",
    );
    expect(value.frames).toEqual([{ stream: 'stderr', text: value.stderr }]);
  });

  it.each([
    {
      label: 'throw',
      source: "throw new Error('boom')",
      stderr:
        "[eval]:1\nthrow new Error('boom')\n^\n\nError: boom\n    at [eval]:1:7\n    at /work/.rifty-eval-throw.cjs:1:7\n",
    },
    {
      label: 'syntax',
      source: 'return 1',
      stderr:
        '[eval]:1\nreturn 1\n^^^^^^\nReturn statement is not allowed here\n\nSyntaxError: Illegal return statement\n    at [eval]:1:1\n    at compile (/project/generated/eval-syntax.cjs:1:1)\n',
    },
    {
      label: 'unhandled rejection',
      source: "Promise.reject(new Error('unhandled'))",
      stderr:
        "[eval]:1\nPromise.reject(new Error('unhandled'))\n               ^\n\nError: unhandled\n    at [eval]:1:16\n    at file:///tmp/rifty-eval-unhandled.mjs:1:16\n",
    },
  ])('rejects a generated eval path hidden after the $label user frame', ({ source, stderr }) => {
    expect(() =>
      canonicalNodeCliEvalOutcome(
        {
          label: 'path-leak',
          nodeArgv: ['-e', source],
          source,
          print: false,
          execArgv: ['-e', source],
          scriptArgs: [],
          evalErrorStderr: true,
        },
        {
          stdout: '',
          stderr,
          frames: [{ stream: 'stderr', text: stderr }],
          code: 1,
          signal: null,
        },
      ),
    ).toThrow(/node-cli-eval raw eval stderr leaked a generated or absolute carrier path/u);
  });

  it('rejects duplicate invocation labels before either runtime starts', () => {
    const repeated = {
      label: 'same',
      nodeArgv: ['-p'],
      source: 'undefined',
      print: true,
      execArgv: ['-p'],
      scriptArgs: [],
    } as const;
    expect(() =>
      nodeCliEvalInvocations({
        kind: 'node-cli-eval',
        code: '',
        expectedPhysicalWorkers: 2,
        nodeCliEval: { sequential: [repeated], concurrent: [repeated] },
      }),
    ).toThrow('labels must be unique');
  });
});
