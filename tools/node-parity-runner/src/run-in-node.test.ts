import { describe, expect, it } from 'vitest';
import { runInNode } from './run-in-node.ts';

describe('runInNode', () => {
  it('runs node-cli-eval with exact native argv and returns canonical process output', async () => {
    const source = `
      console.log(JSON.stringify({
        execArgv: process.execArgv.map((value, index) => index === 1 ? '<source>' : value),
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
            source,
            print: false,
            execArgv: ['-e', source],
            scriptArgs: ['alpha'],
          },
        ],
      },
    });

    expect(JSON.parse(output)).toEqual([
      {
        label: 'direct-short-e',
        stdout: '{"execArgv":["-e","<source>"],"argv":["<node>","alpha"]}\n',
        stderr: '',
        frames: [
          {
            stream: 'stdout',
            text: '{"execArgv":["-e","<source>"],"argv":["<node>","alpha"]}\n',
          },
        ],
        code: 0,
        signal: null,
      },
    ]);
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
