import { expect, it } from 'vitest';
import { playgroundWorkbenchOptions } from './playground-workbench-host.ts';

it('supplies every companion worker asset at the host boundary', () => {
  const options = playgroundWorkbenchOptions();

  expect(Object.keys(options.deployment.workers).sort()).toEqual([
    'devServer',
    'kernel',
    'node',
    'owner',
    'typescript',
  ]);
  expect(options.deployment.workers.typescript).toMatch(/ts-lsp-worker-entry/);
});
