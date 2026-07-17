import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { playgroundWorkbenchOptions } from './playground-workbench-host.ts';

const hostSource = readFileSync(new URL('./playground-workbench-host.ts', import.meta.url), 'utf8');

it('uses only sealed Workbench entrypoints', () => {
  expect(hostSource).not.toContain("from '../workbench/internal/");
});

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
