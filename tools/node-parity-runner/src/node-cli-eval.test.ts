import { describe, expect, it } from 'vitest';
import {
  canonicalNodeCliEvalOutcome,
  createNodeCliEvalCapture,
  nodeCliEvalInvocations,
} from './node-cli-eval.ts';

describe('node CLI eval parity carrier', () => {
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
