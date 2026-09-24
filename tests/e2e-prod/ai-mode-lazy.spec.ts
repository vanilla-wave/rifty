import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { agentModelServer } from '../e2e/fixtures/agent-model-server.ts';
import { pickStarter, waitForProjectIndex } from '../e2e/helpers/playground.ts';

test('production loads Monaco for the project and agent/Pi only for chat', async ({ page }) => {
  test.setTimeout(120_000);
  const assets = join(process.cwd(), 'apps/playground/dist/assets');
  const agentChunks: string[] = [];
  const editorChunks: string[] = [];
  for (const name of await readdir(assets)) {
    if (!name.endsWith('.js.map')) continue;
    const map = JSON.parse(await readFile(join(assets, name), 'utf8')) as { sources: string[] };
    if (
      map.sources.some((source) =>
        /(?:packages\/agent\/src\/|src\/ai\/|pi-agent-core\/|pi-ai\/)/.test(source),
      )
    )
      agentChunks.push(name.slice(0, -4));
    if (map.sources.some((source) => source.endsWith('src/components/EditorHost.tsx')))
      editorChunks.push(name.slice(0, -4));
  }
  expect(
    agentChunks.length,
    'production source maps identify the actual hashed agent chunks',
  ).toBeGreaterThan(0);
  expect(editorChunks.length).toBeGreaterThan(0);
  const fetched: string[] = [];
  const editorsFetched: string[] = [];
  page.on('request', (request) => {
    const file = new URL(request.url()).pathname.split('/').at(-1);
    if (file && agentChunks.includes(file)) fetched.push(file);
    if (file && editorChunks.includes(file)) editorsFetched.push(file);
  });
  const model = await agentModelServer(['Production chat streamed.']);
  try {
    await page.goto('/');
    await waitForProjectIndex(page);
    await expect(page.getByRole('button', { name: '+chat', exact: true })).toBeDisabled();
    expect(editorsFetched).toEqual([]);
    await pickStarter(page);
    await expect(page.locator('[data-testid="editor"] .monaco-editor').first()).toBeVisible();
    expect(editorsFetched.length).toBeGreaterThan(0);
    expect(fetched).toEqual([]);
    await page.getByRole('button', { name: '+chat', exact: true }).click();
    const panel = page.getByTestId('ai-panel');
    await expect(panel).toBeVisible();
    expect(fetched.length).toBeGreaterThan(0);
    await panel.getByRole('button', { name: 'Settings', exact: true }).click();
    await panel.getByLabel('Base URL', { exact: true }).fill(model.baseUrl);
    await panel.getByLabel('Model', { exact: true }).fill('scripted');
    await panel.getByRole('button', { name: 'Apply and reset chat', exact: true }).click();
    await panel.getByLabel('Message', { exact: true }).fill('Confirm the production chat.');
    await panel.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(panel).toHaveAttribute('data-status', 'done');
    await expect(panel).toContainText('Production chat streamed.');
    expect(model.requests).toHaveLength(1);
    expect(model.requests[0]?.authorization).toBeNull();
  } finally {
    await model.close();
  }
});
