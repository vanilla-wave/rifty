import { readFile } from 'node:fs/promises';
import { type Page, expect } from '@playwright/test';
import type { AgentTrace } from '@riftydev/agent';
import {
  openShellTerminal,
  pickStarter,
  runTerminalLine,
} from '../../../../tests/e2e/helpers/playground.ts';
import type { FileTree } from '../files.ts';
import { coreObservation } from './core-observation.ts';
import type { Input, Prepared } from './types.ts';

async function stopProject(page: Page) {
  const pill = page.locator('.rf-livepill');
  if ((await pill.getAttribute('data-state')) === 'stopped') return;
  await page.locator('[data-action="open-palette"]').click();
  await page
    .getByTestId('command-palette')
    .getByRole('button', { name: 'Stop project', exact: true })
    .click();
  await expect(pill).toHaveAttribute('data-state', 'stopped', { timeout: 90000 });
}
async function archive(page: Page): Promise<FileTree> {
  await stopProject(page);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const path = await (await download).path();
  if (!path) throw new Error('Workspace archive has no file');
  const data = JSON.parse(await readFile(path, 'utf8')) as {
    files: { path: string; content: string }[];
  };
  return Object.fromEntries(
    data.files
      .filter(
        (file) =>
          !file.path.startsWith('.git/') &&
          !file.path.startsWith('node_modules/') &&
          !file.path.startsWith('dist/'),
      )
      .map((file) => [file.path, Buffer.from(file.content, 'base64').toString('utf8')]),
  );
}
export async function prepareRifty(input: Input): Promise<Prepared> {
  const { browser, task, config, endpoint, key, playgroundUrl } = input;
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  try {
    await page.goto(`${playgroundUrl}?agentBench=1`);
    await pickStarter(page, task.preset);
    await expect(
      page.frameLocator('[data-testid="preview"] iframe').locator(task.node ? 'h1' : '#root'),
    ).toContainText(task.node ? 'Hono' : 'Trackline', { timeout: 240000 });
    await page.getByRole('button', { name: '+chat', exact: true }).click();
    const panel = page.getByTestId('ai-panel');
    await expect(panel).toBeVisible();
    await panel.getByRole('button', { name: 'Settings', exact: true }).click();
    await panel.getByLabel('Base URL', { exact: true }).fill(endpoint.baseUrl);
    await panel.getByLabel('Model', { exact: true }).fill(endpoint.model);
    await panel.getByLabel('API key (optional)', { exact: true }).fill(key ?? '');
    await panel.getByLabel('Tool limit', { exact: true }).fill(String(config.limits.maxToolCalls));
    await panel
      .getByLabel('Time limit (seconds)', { exact: true })
      .fill(String(config.limits.runTimeoutMs / 1000));
    await panel.getByRole('button', { name: 'Apply and reset chat', exact: true }).click();
    await page.evaluate(async (taskId) => {
      const hook = Reflect.get(globalThis, '__riftyAgentBench') as {
        seed(input: { taskId: string; files: Record<string, string> }): Promise<void>;
      };
      await hook.seed({ taskId, files: {} });
    }, task.id);
    const before = await archive(page);
    const terminal = await openShellTerminal(page);
    await runTerminalLine(page, 'npm run dev', terminal);
    await expect(page.locator('.rf-livepill')).toHaveAttribute('data-state', 'running', {
      timeout: 180000,
    });
    const requests: unknown[] = [];
    page.on('request', (request) => {
      if (request.method() === 'POST' && request.url().startsWith(endpoint.baseUrl)) {
        const body = request.postDataJSON() as unknown;
        requests.push(body);
      }
    });
    return {
      context,
      page,
      before,
      async run() {
        await panel.getByLabel('Message', { exact: true }).fill(task.prompt);
        await panel.getByRole('button', { name: 'Send', exact: true }).click();
        await expect(panel).toHaveAttribute(
          'data-status',
          /^(done|error|aborted|budget-exceeded)$/,
          { timeout: config.limits.runTimeoutMs + 120000 },
        );
        const trace = await page.evaluate(async () => {
          const hook = Reflect.get(globalThis, '__riftyAgentBench') as {
            exportTrace(): Promise<AgentTrace>;
          };
          return hook.exportTrace();
        });
        return coreObservation(trace, requests);
      },
      async preview() {
        const element = await page.locator('[data-testid="preview"] iframe').elementHandle();
        const view = await element?.contentFrame();
        if (!view) throw new Error('No actual playground preview frame');
        return { view, previewUrl: view.url() };
      },
      async snapshot() {
        const tab = page.locator(
          `.rf-terminal-tab__select[data-session-id="${terminal.sessionId}"]`,
        );
        const running = tab.locator('..');
        if ((await running.getAttribute('data-running')) === 'true') {
          await tab.click();
          const input = page
            .locator(`.rf-terminal-slot[data-session-id="${terminal.sessionId}"] textarea`)
            .first();
          await input.focus();
          await input.press('Control+C');
          await expect(running).toHaveAttribute('data-running', 'false', { timeout: 90000 });
        }
        await expect(page.locator('.rf-livepill')).toHaveAttribute('data-state', 'stopped', {
          timeout: 90000,
        });
        return archive(page);
      },
      close: () => context.close(),
    };
  } catch (error) {
    await context.close();
    throw error;
  }
}
