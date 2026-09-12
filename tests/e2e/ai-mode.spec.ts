import { readFile } from 'node:fs/promises';
import { type Page, expect, test } from '@playwright/test';
import { MAIN_TSX } from '../../apps/playground/src/templates/react-vite/app.ts';
import type { AgentTrace } from '../../packages/agent/src/index.ts';
import { agentModelServer } from './fixtures/agent-model-server.ts';
import {
  openActiveProjectFromLauncher,
  pickStarter,
  terminalBuffer,
} from './helpers/playground.ts';

async function openChat(page: Page) {
  const toggle = page.getByRole('button', { name: '+chat', exact: true });
  await expect(toggle).toBeVisible({ timeout: 1500 });
  await toggle.click();
  await expect(page.getByTestId('ai-panel')).toBeVisible();
}

async function settings(
  page: Page,
  baseUrl: string,
  options: { key?: string; calls?: number; seconds?: number } = {},
) {
  const panel = page.getByTestId('ai-panel');
  await panel.getByRole('button', { name: 'Settings', exact: true }).click();
  await panel.getByLabel('Base URL', { exact: true }).fill(baseUrl);
  await panel.getByLabel('Model', { exact: true }).fill('scripted');
  await panel.getByLabel('API key (optional)', { exact: true }).fill(options.key ?? '');
  await panel.getByLabel('Tool limit', { exact: true }).fill(String(options.calls ?? 100));
  await panel
    .getByLabel('Time limit (seconds)', { exact: true })
    .fill(String(options.seconds ?? 180));
  await panel.getByRole('button', { name: 'Apply and reset chat', exact: true }).click();
}

async function send(page: Page, text: string, enter = false) {
  const panel = page.getByTestId('ai-panel');
  await panel.getByLabel('Message', { exact: true }).fill(text);
  if (enter) await panel.getByLabel('Message', { exact: true }).press('Enter');
  else await panel.getByRole('button', { name: 'Send', exact: true }).click();
}

async function exported(page: Page): Promise<AgentTrace> {
  const downloaded = page.waitForEvent('download');
  await page
    .getByTestId('ai-panel')
    .getByRole('button', { name: 'Export session', exact: true })
    .click();
  const path = await (await downloaded).path();
  if (!path) throw new Error('Trace download has no local artifact');
  return JSON.parse(await readFile(path, 'utf8')) as AgentTrace;
}

const toolResults = (trace: AgentTrace) =>
  trace.transcript.filter((entry) => entry.role === 'toolResult');

test('lazy +chat streams real React edits/build/preview into editor, SCM, Agent terminal and export', async ({
  page,
}) => {
  test.setTimeout(420_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  const source = `document.body.insertAdjacentHTML('beforeend', '<output id="agent-proof">Agent changed this preview</output>');\n${MAIN_TSX}`;
  const model = await agentModelServer([
    [{ name: 'write_file', args: { path: 'src/main.tsx', content: source } }],
    [{ name: 'shell', args: { command: 'npm run build && echo AGENT_UI_TERMINAL' } }],
    [{ name: 'preview_query', args: { selector: '#agent-proof' } }],
    'Preview checked.',
  ]);
  model.holdFinal('Preview checked.');
  try {
    await page.goto('/');
    await pickStarter(page, 'real-vite');
    expect(
      requests.filter((url) => /\/ai\/|pi-agent-core|pi-ai|openai-completions/.test(url)),
    ).toEqual([]);
    await openChat(page);
    await expect(
      page.frameLocator('[data-testid="preview"] iframe').locator('#root'),
    ).toContainText('Trackline', { timeout: 180_000 });
    await settings(page, model.baseUrl);
    await send(page, 'Add a visible status note to the React preview, build and inspect it.', true);
    const panel = page.getByTestId('ai-panel');
    await expect(panel).toContainText('Preview checked.', { timeout: 180_000 });
    await expect(panel).toHaveAttribute('data-status', 'running');
    await expect(panel.getByRole('button', { name: 'Reset', exact: true })).toBeDisabled();
    model.releaseFinal();
    await expect(panel).toHaveAttribute('data-status', 'done');
    await expect(panel.locator('[data-tool-name="write_file"]')).toContainText('src/main.tsx');
    await expect(panel.locator('[data-tool-name="shell"]')).toContainText('npm run build');
    await expect(page.getByRole('tab', { name: 'Agent', exact: true })).toBeVisible();
    await expect.poll(() => terminalBuffer(page)).toContain('AGENT_UI_TERMINAL');
    await expect(
      page.frameLocator('[data-testid="preview"] iframe').locator('#agent-proof'),
    ).toHaveText('Agent changed this preview');
    const src = page.getByRole('treeitem', { name: 'src', exact: true });
    if ((await src.getAttribute('aria-expanded')) === 'false') await src.click();
    await page.getByRole('treeitem', { name: /^main\.tsx/ }).click();
    await expect(page.locator('[data-testid="editor"] .view-lines').first()).toContainText(
      'agent-proof',
    );
    await page.getByRole('tab', { name: 'GIT', exact: true }).click();
    await expect(page.locator('.rf-sidebar')).toContainText('main.tsx');
    const trace = await exported(page);
    expect(trace.status).toBe('done');
    expect(toolResults(trace).every((entry) => !entry.isError)).toBe(true);
    expect(trace.timings).toHaveLength(1);
    expect(trace.usage.totalTokens).toBeGreaterThan(0);
    expect(JSON.stringify(trace.finalDiff)).toContain('agent-proof');
    expect(JSON.stringify(trace.events)).toContain('AGENT_UI_TERMINAL');
    expect(await page.evaluate(() => Reflect.has(globalThis, '__riftyAgentBench'))).toBe(false);
    const geometry = await page.evaluate(() => {
      const bounds = (selector: string) => {
        const box = document.querySelector(selector)?.getBoundingClientRect();
        if (!box) throw new Error(`Missing layout surface: ${selector}`);
        return { x: box.x, right: box.right, width: box.width, height: box.height };
      };
      return {
        chat: bounds('[data-testid="ai-panel"]'),
        editor: bounds('[data-testid="editor"]'),
        preview: bounds('[data-testid="preview"]'),
        viewport: innerWidth,
      };
    });
    expect(geometry.chat.width).toBeGreaterThanOrEqual(280);
    expect(geometry.editor.width).toBeGreaterThan(100);
    expect(geometry.preview.width).toBeGreaterThan(200);
    expect(geometry.chat.x).toBeGreaterThanOrEqual(geometry.preview.right);
    expect(geometry.chat.right).toBeLessThanOrEqual(geometry.viewport);
    await page.screenshot({ path: '/tmp/pr333-ai-chat-desktop.png', fullPage: true });
  } finally {
    await model.close();
  }
});

test('settings keep only endpoint/model; Reset retains files and reload clears key/conversation/limits', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const key = 'PR333_SYNTHETIC_UI_KEY';
  const model = await agentModelServer([
    [{ name: 'write_file', args: { path: 'agent-saved.txt', content: 'kept after reset' } }],
    'Saved.',
    [{ name: 'read_file', args: { path: 'agent-saved.txt' } }],
    'Still here.',
  ]);
  try {
    await page.goto('/');
    await pickStarter(page);
    await page.evaluate(() => localStorage.setItem('rf.ai.v2', '{broken'));
    await openChat(page);
    await settings(page, model.baseUrl, { key, calls: 2, seconds: 7 });
    expect(
      await page.evaluate(() => JSON.parse(localStorage.getItem('rf.ai.v2') ?? 'null')),
    ).toEqual({ baseUrl: model.baseUrl, model: 'scripted' });
    await send(page, 'Save a file.');
    const panel = page.getByTestId('ai-panel');
    await expect(panel).toHaveAttribute('data-status', 'done');
    expect(model.requests[0]?.authorization).toBe(`Bearer ${key}`);
    expect(JSON.stringify(await exported(page))).not.toContain(key);
    await panel.getByRole('button', { name: 'Reset', exact: true }).click();
    await expect(panel.getByTestId('ai-messages')).not.toContainText('Save a file.');
    await send(page, 'Read the saved file.');
    await expect(panel).toHaveAttribute('data-status', 'done');
    expect(JSON.stringify(toolResults(await exported(page)))).toContain('kept after reset');
    expect(model.requests[2]?.body.messages.filter((entry) => entry.role === 'user')).toHaveLength(
      1,
    );
    await page.reload();
    if (await page.getByTestId('launcher').isVisible()) await openActiveProjectFromLauncher(page);
    await openChat(page);
    await panel.getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(panel.getByLabel('Base URL', { exact: true })).toHaveValue(model.baseUrl);
    await expect(panel.getByLabel('Model', { exact: true })).toHaveValue('scripted');
    await expect(panel.getByLabel('API key (optional)', { exact: true })).toHaveValue('');
    await expect(panel.getByLabel('Tool limit', { exact: true })).toHaveValue('100');
    await expect(panel.getByLabel('Time limit (seconds)', { exact: true })).toHaveValue('180');
    await expect(panel.getByTestId('ai-messages')).not.toContainText('Read the saved file.');
  } finally {
    await model.close();
  }
});

test('provider error and real Stop preserve history; next command, close and project switch use the correct session', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const model = await agentModelServer([
    [{ name: 'write_file', args: { path: 'agent-history.txt', content: 'committed' } }],
    { error: 'provider failed after write' },
    [{ name: 'shell', args: { command: 'echo AGENT_UI_ENTERED && sleep 20' } }],
    [{ name: 'shell', args: { command: 'cat agent-history.txt && echo AGENT_UI_NEXT' } }],
    'Continued.',
    [{ name: 'shell', args: { command: 'echo AGENT_CLOSE_ENTERED && sleep 20' } }],
    [{ name: 'shell', args: { command: 'echo FRESH_CHAT' } }],
    'Fresh chat.',
    [{ name: 'write_file', args: { path: 'new-project.txt', content: 'new project only' } }],
    'New project.',
  ]);
  try {
    await page.goto('/');
    await pickStarter(page);
    await openChat(page);
    await settings(page, model.baseUrl);
    const panel = page.getByTestId('ai-panel');
    await send(page, 'Commit a write.');
    await expect(panel).toHaveAttribute('data-status', 'error');
    await expect(panel).toContainText('provider failed after write');
    await send(page, 'Continue with a long command.');
    await expect.poll(() => terminalBuffer(page)).toContain('AGENT_UI_ENTERED');
    await panel.getByRole('button', { name: 'Stop', exact: true }).click();
    await expect(panel).toHaveAttribute('data-status', 'aborted');
    const stopped = await exported(page);
    expect(toolResults(stopped).at(-1)?.details).toHaveProperty('status', 'cancelled');
    await send(page, 'Run the next command.');
    await expect(panel).toHaveAttribute('data-status', 'done');
    await expect.poll(() => terminalBuffer(page)).toContain('AGENT_UI_NEXT');
    expect(model.requests[3]?.body.messages.filter((entry) => entry.role === 'tool')).toHaveLength(
      2,
    );
    await send(page, 'Run another long command.');
    await expect.poll(() => terminalBuffer(page)).toContain('AGENT_CLOSE_ENTERED');
    await panel.getByRole('button', { name: 'Close chat', exact: true }).click();
    await expect(panel).toHaveCount(0);
    await openChat(page);
    await send(page, 'Fresh conversation.');
    await expect(panel).toHaveAttribute('data-status', 'done');
    expect(model.requests[6]?.body.messages.filter((entry) => entry.role === 'user')).toHaveLength(
      1,
    );
    await pickStarter(page, 'node-worker');
    await expect(panel.getByTestId('ai-messages')).not.toContainText('Fresh conversation.');
    await send(page, 'Write only into this project.');
    await expect(panel).toHaveAttribute('data-status', 'done');
    expect(model.requests[8]?.body.messages.filter((entry) => entry.role === 'user')).toHaveLength(
      1,
    );
    await expect(page.getByRole('treeitem', { name: /^new-project\.txt/ })).toBeVisible();
    expect(toolResults(await exported(page))).toHaveLength(1);
  } finally {
    await model.close();
  }
});

test('storage refusal stays usable; network errors name proxy remedy and budgets are distinct', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const model = await agentModelServer(['Waiting for model finish.', 'Next run works.']);
  model.holdFinal('Waiting for model finish.');
  try {
    await page.addInitScript(() => {
      const set = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key: string, value: string) {
        if (key === 'rf.ai.v2') throw new DOMException('settings quota', 'QuotaExceededError');
        return Reflect.apply(set, this, [key, value]);
      };
    });
    await page.goto('/');
    await pickStarter(page);
    await openChat(page);
    await settings(page, '/broken-model/v1');
    const panel = page.getByTestId('ai-panel');
    await expect(panel).toContainText('not saved');
    await page.route('**/broken-model/v1/chat/completions', (route) => route.abort('failed'));
    await send(page, 'Try the endpoint.');
    await expect(panel).toHaveAttribute('data-status', 'error');
    await expect(panel).toContainText('RIFTY_AI_PROXY_TARGET');
    await expect(panel).toContainText('/ai-proxy/v1');
    await settings(page, model.baseUrl, { seconds: 1 });
    await send(page, 'Use the time budget.');
    await expect(panel).toHaveAttribute('data-status', 'budget-exceeded');
    expect((await exported(page)).status).toBe('budget-exceeded');
    await send(page, 'Try again.');
    await expect(panel).toHaveAttribute('data-status', 'done');
    await expect(panel).toContainText('Next run works.');
  } finally {
    await model.close();
  }
});

test('opt-in benchmark hook seeds public files and exports actual session metadata', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const model = await agentModelServer([
    [{ name: 'read_file', args: { path: 'bench-seed.txt' } }],
    'Seed read.',
  ]);
  try {
    await page.goto('/?agentBench=1');
    await pickStarter(page);
    await openChat(page);
    await settings(page, model.baseUrl);
    // agent-bench hook: external validation harness only. Not public API.
    await page.evaluate(async () => {
      const hook = Reflect.get(globalThis, '__riftyAgentBench') as {
        seed(input: { taskId: string; files: Record<string, string> }): Promise<void>;
      };
      await hook.seed({
        taskId: 'ui-hook-proof',
        files: { 'bench-seed.txt': 'real seeded bytes' },
      });
    });
    await send(page, 'Read the seed.');
    await expect(page.getByTestId('ai-panel')).toHaveAttribute('data-status', 'done');
    // agent-bench hook: external validation harness only. Not public API.
    const actual = await page.evaluate(async () => {
      const hook = Reflect.get(globalThis, '__riftyAgentBench') as {
        exportTrace(): Promise<AgentTrace>;
        sessionMetadata(): Promise<unknown>;
      };
      return { trace: await hook.exportTrace(), metadata: await hook.sessionMetadata() };
    });
    expect(JSON.stringify(toolResults(actual.trace))).toContain('real seeded bytes');
    expect(actual.metadata).toMatchObject({
      taskId: 'ui-hook-proof',
      model: 'scripted',
      profile: actual.trace.profile,
      maxToolCalls: 100,
      runTimeoutMs: 180_000,
    });
    await expect(page.getByRole('treeitem', { name: /^bench-seed\.txt/ })).toBeVisible();
  } finally {
    await model.close();
  }
});
