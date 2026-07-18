import { expect, it, vi } from 'vitest';
import { WorkbenchOriginOccupiedError } from '../workbench/public.ts';
import type { OpenPlaygroundWorkbench, PlaygroundWorkbench } from '../workbench/playground.ts';
import {
  createOpenPlaygroundAppWorkbench,
  playgroundWorkbenchOptions,
} from './playground-workbench-host.ts';

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

it('returns the opened Workbench without hiding its identity', async () => {
  const workbench = Object.freeze({}) as PlaygroundWorkbench;
  const open = vi.fn<OpenPlaygroundWorkbench>(async () => workbench);

  const result = await createOpenPlaygroundAppWorkbench(open)();

  expect(result).toEqual({ status: 'opened', workbench });
  expect(open).toHaveBeenCalledWith(playgroundWorkbenchOptions());
});

it('translates only typed origin contention to the closed occupied outcome', async () => {
  const open = vi.fn<OpenPlaygroundWorkbench>(async () => {
    throw new WorkbenchOriginOccupiedError();
  });

  await expect(createOpenPlaygroundAppWorkbench(open)()).resolves.toEqual({
    status: 'occupied',
  });
});

it('preserves every non-contention Workbench failure as fatal', async () => {
  const cause = new DOMException('lock manager denied access', 'SecurityError');
  const open = vi.fn<OpenPlaygroundWorkbench>(async () => {
    throw cause;
  });

  await expect(createOpenPlaygroundAppWorkbench(open)()).rejects.toBe(cause);
});
