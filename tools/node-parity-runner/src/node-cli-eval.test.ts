import { describe, expect, it } from 'vitest';
import {
  assertNodeCliEvalNoCarrierPath,
  assertNodeCliEvalOracleVersion,
  canonicalNodeCliEvalOutcome,
  createNodeCliEvalCapture,
  createNodeCliEvalStdioHandshake,
  nodeCliEvalInvocations,
} from './node-cli-eval.ts';

describe('node CLI eval parity carrier', () => {
  it('fails loudly if the ambient Node oracle drifts from the frozen version', () => {
    expect(() => assertNodeCliEvalOracleVersion('v24.15.0')).toThrow(
      'node-cli-eval oracle requires v24.16.0; received v24.15.0',
    );
    expect(() => assertNodeCliEvalOracleVersion('v24.16.0')).not.toThrow();
  });

  it('keeps a partial stdout frame before an intervening stderr line across split UTF-8', () => {
    const capture = createNodeCliEvalCapture();
    capture.push('stdout', new Uint8Array([0x61, 0xe2, 0x82]));
    capture.push('stderr', 'err\n');
    capture.push('stdout', new Uint8Array([0xac, 0x0a]));

    expect(capture.finish(7, null)).toEqual({
      stdout: 'a€\n',
      stderr: 'err\n',
      frames: [
        { stream: 'stdout', text: 'a' },
        { stream: 'stderr', text: 'err\n' },
        { stream: 'stdout', text: '€\n' },
      ],
      code: 7,
      signal: null,
    });
  });

  it('keeps reversed unterminated stream tails in write order at EOF', () => {
    const capture = createNodeCliEvalCapture();
    capture.push('stderr', 'stderr-first');
    capture.push('stdout', 'stdout-last');

    expect(capture.finish(0, null)).toEqual({
      stdout: 'stdout-last',
      stderr: 'stderr-first',
      frames: [
        { stream: 'stderr', text: 'stderr-first' },
        { stream: 'stdout', text: 'stdout-last' },
      ],
      code: 0,
      signal: null,
    });
  });

  it('normalises adjacent same-stream chunks into one logical line', () => {
    const capture = createNodeCliEvalCapture();
    capture.push('stdout', 'one-');
    capture.push('stdout', 'line\n');

    expect(capture.finish(0, null).frames).toEqual([{ stream: 'stdout', text: 'one-line\n' }]);
  });

  it('releases causal stream markers only after each exact observable predecessor', () => {
    const tokens: string[] = [];
    const handshake = createNodeCliEvalStdioHandshake(
      [
        { stream: 'stdout', marker: 'stdout-ready|' },
        { stream: 'stderr', marker: 'stderr-ready\n' },
      ],
      (token) => tokens.push(token),
    );

    handshake.observe('stdout', 'stdout-');
    handshake.observe('stderr', 'ignored-before-gate\n');
    expect(tokens).toEqual([]);
    handshake.observe('stdout', 'ready|');
    expect(tokens).toEqual(['1']);
    handshake.observe('stdout', 'ignored-between-gates');
    handshake.observe('stderr', 'stderr-ready\n');
    expect(tokens).toEqual(['1', '2']);
    expect(() => handshake.finish()).not.toThrow();
  });

  it('rejects a causal stream carrier that exits before every marker is observable', () => {
    const handshake = createNodeCliEvalStdioHandshake(
      [
        { stream: 'stderr', marker: 'first' },
        { stream: 'stdout', marker: 'second' },
      ],
      () => {},
    );
    handshake.observe('stderr', 'first');

    expect(() => handshake.finish()).toThrow('stopped at step 1 of 2');
  });

  it('keeps only the contracted eval error prelude and first user frame', () => {
    const value = canonicalNodeCliEvalOutcome(
      {
        label: 'throw',
        nodeArgv: [],
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
      label: 'absolute carrier frame before the eval prelude',
      source: "throw new Error('boom')",
      stderr:
        "Error: carrier bootstrap\n    at /project/generated/eval-before.cjs:1:1\n[eval]:1\nthrow new Error('boom')\n^\n\nError: boom\n    at [eval]:1:7\n",
    },
    {
      label: 'absolute carrier-only error header',
      source: 'return 1',
      stderr:
        '/project/generated/eval-header.cjs:1\nreturn 1\n^^^^^^\n\nSyntaxError: Illegal return statement\n',
    },
    {
      label: 'generated carrier path after the throw user frame',
      source: "throw new Error('boom')",
      stderr:
        "[eval]:1\nthrow new Error('boom')\n^\n\nError: boom\n    at [eval]:1:7\n    at /work/.rifty-eval-throw.cjs:1:7\n",
    },
    {
      label: 'absolute carrier path after the syntax user frame',
      source: 'return 1',
      stderr:
        '[eval]:1\nreturn 1\n^^^^^^\nReturn statement is not allowed here\n\nSyntaxError: Illegal return statement\n    at [eval]:1:1\n    at compile (/project/generated/eval-syntax.cjs:1:1)\n',
    },
    {
      label: 'file URL carrier path after the rejection user frame',
      source: "Promise.reject(new Error('unhandled'))",
      stderr:
        "[eval]:1\nPromise.reject(new Error('unhandled'))\n               ^\n\nError: unhandled\n    at [eval]:1:16\n    at file:///tmp/rifty-eval-unhandled.mjs:1:16\n",
    },
  ])('rejects $label before projecting raw stderr', ({ source, stderr }) => {
    expect(() => assertNodeCliEvalNoCarrierPath(stderr)).toThrow(
      /node-cli-eval raw eval stderr leaked a generated or absolute carrier path/u,
    );
    expect(() =>
      canonicalNodeCliEvalOutcome(
        {
          label: 'path-leak',
          nodeArgv: ['-e', source],
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
