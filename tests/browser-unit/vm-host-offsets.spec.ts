import { expect, test } from '@playwright/test';
import callsite from '../../tools/node-parity-runner/cases/vm/host-offset-callsite-projection.case.ts';
import identity from '../../tools/node-parity-runner/cases/vm/host-offset-source-identity.case.ts';
import direct from '../../tools/node-parity-runner/cases/vm/run-in-this-context-offsets.case.ts';
import script from '../../tools/node-parity-runner/cases/vm/script-this-context-offsets.case.ts';
import { runInNode } from '../../tools/node-parity-runner/src/run-in-node.ts';
import { gotoHarness } from './fixtures.ts';

const vmUrl = `/@fs${process.cwd()}/packages/runtime-js/src/builtins/vm/index.ts`;

for (const [label, fixture] of [
  ['runInThisContext', direct],
  ['Script', script],
  ['source identity', identity],
  ['custom renderer CallSites', callsite],
] as const) {
  test(`host vm ${label} offsets match native Node in Chromium`, async ({ page }) => {
    const oracle = await runInNode(fixture);
    await gotoHarness(page);
    const actual = await page.evaluate(
      async ({ url, source }) => {
        const vm = await import(/* @vite-ignore */ url);
        const output: string[] = [];
        const run = new Function('require', 'console', source);
        run(
          (id: string) => {
            if (id !== 'node:vm') throw new Error(`Unexpected builtin ${id}`);
            return vm;
          },
          { log: (line: string) => output.push(line) },
        );
        return `${output.join('\n')}\n`;
      },
      { url: vmUrl, source: fixture.code },
    );
    expect(actual).toBe(oracle);
  });
}
