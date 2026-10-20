import { spawnSync } from 'node:child_process';
import { expect, test } from '@playwright/test';
import { bootOwner, closeOwner, execLine, gotoHarness, writeOwnerFile } from './fixtures.ts';

test('async explicit Node exit keeps native status without a browser error', async ({ page }) => {
  const source = 'Promise.resolve().then(() => process.exit(1));';
  const native = spawnSync(process.execPath, ['-e', source], { encoding: 'utf8' });
  expect(native.status).toBe(1);
  expect(native.stderr).toBe('');
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await gotoHarness(page);
  await bootOwner(page, {
    workspaceId: 'async-exit',
    template: 'hidden-empty',
    persistence: 'ephemeral',
  });
  try {
    await writeOwnerFile(page, '/scratch/exit.cjs', source);
    const result = await execLine(page, 'node exit.cjs');
    expect(result.exit).toBe(native.status);
    expect(result.out).toBe(native.stdout + native.stderr);
    await closeOwner(page);
    expect(errors).toEqual([]);
  } finally {
    await closeOwner(page);
  }
});

test('failed stock Vite build reports its exit without an internal browser error', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await gotoHarness(page);
  await bootOwner(page, {
    workspaceId: 'failed-vite-exit',
    template: 'vite',
    setup: 'instant',
    persistence: 'ephemeral',
  });
  try {
    await writeOwnerFile(page, '/scratch/vite.config.js', 'export default ;');
    const result = await execLine(page, 'npx vite build');
    expect(result.exit).toBe(1);
    expect(result.out).toContain('Unexpected');
    await closeOwner(page);
    expect(errors).toEqual([]);
  } finally {
    await closeOwner(page);
  }
});
