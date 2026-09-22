import { readFile, writeFile } from 'node:fs/promises';
import { type Page, expect, test } from '@playwright/test';
import { MAIN_TSX } from '../../apps/playground/src/templates/react-vite/app.ts';
import { FILTER_BAR_TSX } from '../../apps/playground/src/templates/react-vite/components.ts';
import type { AgentTrace } from '../../packages/agent/src/index.ts';
import { agentModelServer } from './fixtures/agent-model-server.ts';
import {
  openActiveProjectFromLauncher,
  openShellTerminal,
  pickStarter,
  runTerminalLineSettled,
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
  const source = `document.body.insertAdjacentHTML('beforeend', '<output id="agent-proof" style="position:fixed;top:0;right:0;z-index:999;background:white;color:black">Agent changed this preview</output>');\n${MAIN_TSX}`;
  const model = await agentModelServer([
    [{ name: 'write_file', args: { path: 'src/main.tsx', content: source } }],
    [{ name: 'shell', args: { command: 'npm run build && echo AGENT_UI_TERMINAL' } }],
    [{ name: 'preview_fetch', args: { path: '/src/main.tsx' } }],
    [{ name: 'preview_query', args: { selector: '#agent-proof' } }],
    'Preview checked.',
  ]);
  model.holdFinal('Preview checked.');
  try {
    await page.goto('/');
    await pickStarter(page, 'real-vite');
    expect(
      requests.filter((url) =>
        /\/ai\/|\/packages\/agent\/|pi-agent-core|pi-ai|openai-completions/.test(url),
      ),
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
    const previewTool = panel.locator('[data-tool-name="preview_query"]');
    await previewTool.locator('summary').click();
    await expect(previewTool.getByTestId('ai-tool-result')).toContainText(
      'Agent changed this preview',
    );
    model.releaseFinal();
    await expect(panel).toHaveAttribute('data-status', 'done');
    await expect(previewTool.locator('details')).toHaveAttribute('open', '');
    await expect(previewTool.getByTestId('ai-tool-result')).toBeVisible();
    await expect(panel.locator('[data-tool-name="write_file"]')).toContainText('src/main.tsx');
    await expect(panel.locator('[data-tool-name="shell"]')).toContainText('npm run build');
    await expect(page.getByRole('tab', { name: 'Agent', exact: true })).toBeVisible();
    await expect.poll(() => terminalBuffer(page)).toMatch(/(?:^|\n)AGENT_UI_TERMINAL(?:\r?\n|$)/);
    await expect(
      page.frameLocator('[data-testid="preview"] iframe').locator('#agent-proof'),
    ).toHaveText('Agent changed this preview');
    await expect(
      page.frameLocator('[data-testid="preview"] iframe').locator('#agent-proof'),
    ).toBeInViewport();
    const src = page.getByRole('treeitem', { name: 'src', exact: true });
    if ((await src.getAttribute('aria-expanded')) === 'false') await src.click();
    await page.getByRole('treeitem', { name: /^main\.tsx/ }).click();
    await page
      .waitForFunction(
        () =>
          [...document.querySelectorAll('[role="tab"][aria-selected="true"]')].some((tab) =>
            tab.textContent?.includes('main.tsx'),
          ) || document.querySelector('.rf-toast[data-tone="error"]'),
        undefined,
        { timeout: 5000 },
      )
      .catch(() => {});
    const openFailure = await page.locator('.rf-toast[data-tone="error"]').allTextContents();
    if (openFailure.length) throw new Error(`Editor open failed: ${openFailure.join('; ')}`);
    await expect(page.locator('[data-testid="editor"] .view-lines').first()).toContainText(
      'agent-proof',
    );
    await page.getByRole('tab', { name: 'GIT', exact: true }).click();
    await expect(page.locator('.rf-sidebar')).toContainText('main.tsx');
    const trace = await exported(page);
    expect(trace.status).toBe('done');
    expect(toolResults(trace).every((entry) => !entry.isError)).toBe(true);
    expect(toolResults(trace).find((entry) => entry.toolName === 'preview_fetch')?.content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'text', text: expect.stringContaining('agent-proof') }),
      ]),
    );
    expect(trace.timings).toHaveLength(1);
    expect(trace.usage.totalTokens).toBeGreaterThan(0);
    expect(JSON.stringify(trace.finalDiff)).toContain('agent-proof');
    expect(
      trace.events.some(
        ({ event }) => event.type === 'output' && event.chunk === 'AGENT_UI_TERMINAL\n',
      ),
    ).toBe(true);
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
    'Settings applied.',
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
    await settings(page, model.baseUrl, { calls: 3 });
    await expect(panel.getByTestId('ai-messages')).not.toContainText('Read the saved file.');
    await send(page, 'After applying settings.');
    await expect(panel).toHaveAttribute('data-status', 'done');
    expect(
      model.requests.at(-1)?.body.messages.filter((entry) => entry.role === 'user'),
    ).toHaveLength(1);
    expect((await exported(page)).config.maxToolCalls).toBe(3);
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
    [{ name: 'shell', args: { command: 'echo AGENT_SWITCH_ENTERED && sleep 20' } }],
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
    await expect.poll(() => terminalBuffer(page)).toMatch(/(?:^|\n)AGENT_UI_ENTERED(?:\r?\n|$)/);
    await panel.getByRole('button', { name: 'Stop', exact: true }).click();
    await expect(panel).toHaveAttribute('data-status', 'aborted');
    const stopped = await exported(page);
    expect(toolResults(stopped).at(-1)?.details).toHaveProperty('status', 'cancelled');
    await send(page, 'Run the next command.');
    await expect(panel).toHaveAttribute('data-status', 'done');
    await expect
      .poll(() => terminalBuffer(page))
      .toMatch(/(?:^|\n)committedAGENT_UI_NEXT(?:\r?\n|$)/);
    expect(model.requests[3]?.body.messages.filter((entry) => entry.role === 'tool')).toHaveLength(
      2,
    );
    await send(page, 'Run another long command.');
    await expect.poll(() => terminalBuffer(page)).toMatch(/(?:^|\n)AGENT_CLOSE_ENTERED(?:\r?\n|$)/);
    await panel.getByRole('button', { name: 'Close chat', exact: true }).click();
    await expect(panel).toHaveCount(0);
    await openChat(page);
    await send(page, 'Fresh conversation.');
    await expect(panel).toHaveAttribute('data-status', 'done');
    expect(model.requests[6]?.body.messages.filter((entry) => entry.role === 'user')).toHaveLength(
      1,
    );
    await send(page, 'Switch while this command is active.');
    await expect
      .poll(() => terminalBuffer(page))
      .toMatch(/(?:^|\n)AGENT_SWITCH_ENTERED(?:\r?\n|$)/);
    await expect(panel).toHaveAttribute('data-status', 'running');
    await pickStarter(page, 'node-worker');
    await expect(panel.getByTestId('ai-messages')).not.toContainText('Fresh conversation.');
    await send(page, 'Write only into this project.');
    await expect(panel).toHaveAttribute('data-status', 'done');
    expect(model.requests[9]?.body.messages.filter((entry) => entry.role === 'user')).toHaveLength(
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

test('agent terminal preserves the same split stdout as a user-submitted command', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const command = `node -e "process.stdout.write('UI_PART'); setTimeout(() => process.stdout.write('_DONE'), 20)"`;
  const model = await agentModelServer([[{ name: 'shell', args: { command } }], 'Stream ended.']);
  try {
    await page.goto('/');
    await pickStarter(page);
    await openShellTerminal(page);
    await runTerminalLineSettled(page, command);
    expect(await terminalBuffer(page)).toContain('UI_PART_DONE');
    await openChat(page);
    await settings(page, model.baseUrl);
    await send(page, 'Run the same stream.');
    await expect(page.getByTestId('ai-panel')).toHaveAttribute('data-status', 'done');
    const trace = await exported(page);
    expect(toolResults(trace)[0]?.details).toHaveProperty('stdout', 'UI_PART_DONE');
    expect(await terminalBuffer(page)).toContain('UI_PART_DONE');
  } finally {
    await model.close();
  }
});

test('native failed tool result stays visibly failed after the model continues', async ({
  page,
}) => {
  const model = await agentModelServer([
    [{ name: 'read_file', args: { path: 'missing-agent-file.txt' } }],
    'The file is absent.',
  ]);
  try {
    await page.goto('/');
    await pickStarter(page);
    await openChat(page);
    await settings(page, model.baseUrl);
    await send(page, 'Read the missing file.');
    const panel = page.getByTestId('ai-panel');
    await expect(panel).toHaveAttribute('data-status', 'done');
    const row = panel.locator('[data-tool-name="read_file"]');
    await expect(row).toHaveAttribute('data-state', 'error');
    await row.locator('summary').click();
    await expect(row.getByTestId('ai-tool-result')).toBeVisible();
    await expect(row.getByTestId('ai-tool-result')).toContainText('missing-agent-file.txt');
    expect(toolResults(await exported(page))[0]?.isError).toBe(true);
  } finally {
    await model.close();
  }
});

test('agent leaf-component write reaches the live React preview before and after a build', async ({
  page,
}) => {
  test.setTimeout(240_000);
  const first = FILTER_BAR_TSX.replace(
    '<div className="filter-bar">',
    '<div className="filter-bar"><input aria-label="Agent first search" />',
  );
  const second = first.replace('Agent first search', 'Agent second search');
  const model = await agentModelServer([
    [{ name: 'write_file', args: { path: 'src/components/FilterBar.tsx', content: first } }],
    'First edit.',
    [{ name: 'write_file', args: { path: 'src/components/FilterBar.tsx', content: second } }],
    [{ name: 'shell', args: { command: 'npm run build' } }],
    'Second edit built.',
  ]);
  const messages: string[] = [];
  const modules: { url: string; body: string }[] = [];
  const pending: Promise<void>[] = [];
  page.on('response', (response) => {
    if (/FilterBar|@react-refresh/.test(response.url()))
      pending.push(
        response
          .text()
          .then((body) => {
            modules.push({ url: response.url(), body });
          })
          .catch(() => {}),
      );
  });
  page.on('console', (message) => {
    if (/vite|hmr|refresh/i.test(message.text())) messages.push(message.text());
  });
  try {
    await page.goto('/');
    await pickStarter(page, 'real-vite');
    const frame = page.frameLocator('[data-testid="preview"] iframe');
    await expect(frame.locator('#root')).toContainText('Trackline', { timeout: 180_000 });
    await frame.getByRole('link', { name: 'Issues', exact: true }).click();
    await expect(frame.locator('.filter-bar')).toBeVisible();
    await frame.locator('body').evaluate((element) => {
      Reflect.set(element.ownerDocument.defaultView!, '__agentLeafDocument', 'same');
    });
    await openChat(page);
    await settings(page, model.baseUrl);
    await send(page, 'Add a search input.');
    await expect(page.getByTestId('ai-panel')).toHaveAttribute('data-status', 'done');
    console.log('AGENT LEAF FIRST', JSON.stringify(messages));
    await expect(frame.getByLabel('Agent first search')).toBeVisible({ timeout: 15_000 });
    await send(page, 'Rename the search input and build.');
    await expect(page.getByTestId('ai-panel')).toHaveAttribute('data-status', 'done');
    await expect(frame.getByLabel('Agent second search')).toBeVisible({ timeout: 15_000 });
    expect(
      await frame
        .locator('body')
        .evaluate((element) =>
          Reflect.get(element.ownerDocument.defaultView!, '__agentLeafDocument'),
        ),
    ).toBe('same');
    expect([
      ...new Set(
        modules
          .filter((module) => module.url.includes('@react-refresh'))
          .map((module) => module.url),
      ),
    ]).toHaveLength(1);
  } finally {
    console.log('AGENT LEAF HMR', JSON.stringify(messages));
    await Promise.all(pending);
    await writeFile('/tmp/pr333-hmr-modules.json', JSON.stringify(modules, null, 2));
    await model.close();
  }
});

for (const collapsed of [false, true]) {
  test(`Agent shell reveals its terminal from Problems with collapsed=${collapsed}`, async ({
    page,
  }) => {
    const model = await agentModelServer([
      [{ name: 'shell', args: { command: 'echo AGENT_VISIBLE_FROM_PROBLEMS' } }],
      'Command completed.',
    ]);
    try {
      await page.goto('/');
      await pickStarter(page);
      await openChat(page);
      await settings(page, model.baseUrl);
      await page.getByRole('tab', { name: /^Problems/ }).click();
      if (collapsed)
        await page.getByRole('button', { name: 'Collapse panel', exact: true }).click();
      await send(page, 'Run the command in the visible agent terminal.');
      await expect(page.getByTestId('ai-panel')).toHaveAttribute('data-status', 'done');
      expect(toolResults(await exported(page)).at(-1)?.details).toHaveProperty(
        'stdout',
        'AGENT_VISIBLE_FROM_PROBLEMS\n',
      );
      await expect(
        page.locator('.rf-terminal-slot[data-active="true"] [data-testid="terminal"]'),
      ).toBeVisible({ timeout: 1500 });
      await expect(page.getByRole('tab', { name: 'Agent', exact: true })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      await expect(page.locator('.rf-console__pane[data-view="terminal"]')).toHaveAttribute(
        'data-active',
        'true',
      );
      await expect(page.getByRole('button', { name: 'Collapse panel', exact: true })).toBeVisible();
    } finally {
      await model.close();
    }
  });
}

test('first pi command is refused before model dispatch and keeps the draft', async ({ page }) => {
  test.setTimeout(180_000);
  const model = await agentModelServer(['Plain message accepted.', 'Plain message accepted.']);
  try {
    await page.goto('/?agentBench=1');
    await pickStarter(page);
    await openChat(page);
    await settings(page, model.baseUrl);
    await page.evaluate(async () => {
      const hook = Reflect.get(globalThis, '__riftyAgentBench') as {
        seed(input: { taskId: string; files: Record<string, string> }): Promise<void>;
      };
      await hook.seed({
        taskId: 'first-command',
        files: {
          '.pi/skills/deploy/SKILL.md':
            '---\nname: deploy\ndescription: Deploy this project\n---\nDeploy.',
          '.pi/prompts/review.md': 'Review.',
        },
      });
    });
    const panel = page.getByTestId('ai-panel');
    for (const [index, command] of ['/skill:deploy', '/review'].entries()) {
      await settings(page, model.baseUrl);
      await send(page, command);
      await expect(panel).toHaveAttribute('data-status', 'error');
      await expect(panel.getByRole('alert')).toContainText(`Unsupported chat command ${command}`);
      await expect(panel.getByLabel('Message', { exact: true })).toHaveValue(command);
      expect(model.requests).toHaveLength(index);
      expect((await exported(page)).transcript).toEqual([]);
      await send(page, 'hello');
      await expect(panel).toHaveAttribute('data-status', 'done');
      expect(model.requests).toHaveLength(index + 1);
    }
  } finally {
    await model.close();
  }
});

test('project resources load at start; editor edits wait for chat /reload and visible report', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1600, height: 1000 });
  const model = await agentModelServer([
    [{ name: 'read_file', args: { path: '.pi/skills/deploy/SKILL.md' } }],
    'Arrr, skill read.',
    'Arrr, still old.',
    'Path noted.',
    'Comment noted.',
    'Missing noted.',
    'Ignored noted.',
    'New instructions applied.',
  ]);
  try {
    await page.goto('/?agentBench=1');
    await pickStarter(page);
    await openChat(page);
    await settings(page, model.baseUrl);
    await page.evaluate(async () => {
      const hook = Reflect.get(globalThis, '__riftyAgentBench') as {
        seed(input: { taskId: string; files: Record<string, string> }): Promise<void>;
      };
      await hook.seed({
        taskId: 'project-resources',
        files: {
          'AGENTS.md': 'Answer in pirate speak.',
          'CLAUDE.md': 'Losing context.',
          'sub/CLAUDE.md': 'Descendant context.',
          '.pi/skills/deploy/SKILL.md':
            '---\nname: deploy\ndescription: Deploy this project\n---\nFollow deployment steps.',
          '.pi/skills/hidden/SKILL.md':
            '---\nname: hidden\ndescription: Secret\ndisable-model-invocation: true\n---\nHidden.',
          '.pi/extensions/foo.ts': 'export {};',
          '.pi/prompts/review.md': 'Review.',
          '.pi/prompts/ignored.md': 'Ignored.',
          '.pi/prompts/.gitignore': 'ignored.md\n',
          '.pi/skills/invalid/SKILL.md': '---\nname: invalid\n---\nMissing description.',
        },
      });
    });
    // New session starts over the completed fixture.
    await settings(page, model.baseUrl);
    await send(page, 'deploy this');
    const panel = page.getByTestId('ai-panel');
    await expect(panel).toHaveAttribute('data-status', 'done');
    const prompt = (index: number) =>
      String(
        model.requests[index]?.body.messages.find((message) => message.role === 'system')?.content,
      );
    expect(prompt(0)).toContain('Answer in pirate speak.');
    expect(prompt(0)).toContain('<name>deploy</name>');
    expect(prompt(0)).not.toContain('<name>hidden</name>');
    expect(prompt(0)).not.toContain('Losing context.');
    expect(prompt(0)).not.toContain('Descendant context.');
    const report = panel.getByTestId('ai-resources');
    await expect(report).toContainText('AGENTS.md');
    await expect(report).toContainText('deploy');
    await expect(report).toContainText('.pi/extensions');
    await expect(report).toContainText('.pi/prompts');
    await expect(report).toContainText('description is required');
    expect(prompt(0).indexOf('<project_context>')).toBeLessThan(
      prompt(0).indexOf('<available_skills>'),
    );
    expect(prompt(0).indexOf('</available_skills>')).toBeLessThan(
      prompt(0).indexOf('Current working directory:'),
    );
    expect(JSON.stringify(toolResults(await exported(page)))).toContain('Follow deployment steps.');
    await page.getByRole('treeitem', { name: /^AGENTS\.md/ }).click();
    // Existing editor hook fires the real Monaco change event; select-all is
    // unreliable in headless Chromium (EditorHost's ADR-0166 test seam).
    await expect
      .poll(() =>
        page.evaluate(() => {
          const setValue = Reflect.get(globalThis, '__riftySetEditorValue') as
            | ((path: string, text: string) => boolean)
            | undefined;
          return setValue?.('/AGENTS.md', 'Answer in plain speech.') ?? false;
        }),
      )
      .toBe(true);
    await expect(page.locator('[data-testid="editor"] .view-lines')).toContainText(
      'Answer in plain speech.',
    );
    await expect(page.locator('[data-testid="editor"] .view-lines')).not.toContainText(
      'Answer in pirate speak.',
    );
    await page.keyboard.press('ControlOrMeta+KeyS');
    await expect(page.locator('.rf-toast[data-tone="success"]')).toContainText('Saved');
    await send(page, 'same instructions?');
    await expect(panel).toHaveAttribute('data-status', 'done');
    expect(prompt(2)).toContain('Answer in pirate speak.');
    await send(page, '/reload');
    await expect(report).toContainText('Reloaded');
    expect(model.requests).toHaveLength(3);
    // Pi expands /skill:<loaded skill> and /<.pi/prompts template>: the chat refuses those
    // instead of forwarding; every other '/'-text reaches the model unchanged, as in pi.
    await send(page, '/skill:deploy');
    await expect(panel.getByRole('alert')).toContainText('Unsupported chat command /skill:deploy');
    await send(page, '/review');
    await expect(panel.getByRole('alert')).toContainText('Unsupported chat command /review');
    expect(model.requests).toHaveLength(3);
    const plain = [
      '/src/main.tsx needs a fix',
      '// TODO: keep this',
      '/missing explain this path',
      '/ignored explain this path',
    ];
    for (const [index, text] of plain.entries()) {
      await send(page, text);
      await expect.poll(() => model.requests.length).toBe(4 + index);
      await expect(panel).toHaveAttribute('data-status', 'done');
      expect(JSON.stringify(model.requests[3 + index]?.body.messages.at(-1))).toContain(text);
    }
    await send(page, 'updated instructions?');
    await expect.poll(() => model.requests.length).toBe(8);
    await expect(panel).toHaveAttribute('data-status', 'done');
    expect(prompt(7)).toContain('Answer in plain speech.');
    expect(prompt(7)).not.toContain('Answer in pirate speak.');
  } finally {
    await model.close();
  }
});
