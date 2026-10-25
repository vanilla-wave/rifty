import { expect, it } from 'vitest';
import { runInRifty } from './run-in-rifty.ts';

it('[fault: observable-order / false-fallback] keeps guest eval behind QuickJS readiness', async () => {
  const output = await runInRifty(
    {
      kind: 'node-cli-eval',
      code: '',
      expectedPhysicalWorkers: 1,
      nodeCliEval: {
        sequential: [
          {
            label: 'quickjs-readiness-rejection',
            nodeArgv: ['-e', "process.stdout.write('entry-ran')"],
          },
        ],
        concurrent: [],
      },
    },
    { nodeCliEvalPreEntryFault: 'quickjs-readiness-rejection' },
  );
  const outcomes = JSON.parse(output) as readonly [
    { readonly stdout: string; readonly stderr: string; readonly code: number | null },
  ];

  expect(outcomes[0]).toMatchObject({ stdout: '', code: 1 });
  expect(outcomes[0]?.stderr).toContain('rifty-parity-missing-quickjs-readiness.wasm');
}, 35_000);
