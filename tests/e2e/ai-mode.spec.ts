import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { pickStarter } from './helpers/playground.ts';

/**
 * AI mode PASS 1 (docs/backlog/distribution/ai-mode-playground.md, ADR-0190),
 * CI-safe: no real model. A page.route mock serves an OpenAI-compatible SSE
 * chat-completions endpoint that scripts one session:
 *   1st call → tool_call write_file src/hello.txt
 *   2nd call → tool_call shell   (node prints the file back)
 *   3rd call → final assistant text (no tool calls → done)
 * Asserted: lazy-loading (no ai module fetch before toggle), both tool calls
 * render in chat, the file lands in the real workspace (explorer), the shell
 * output is visible, and the exported trace JSON carries transcript + tool
 * calls + terminal output + config WITHOUT the apiKey.
 */

interface SseChunkChoice {
  index: number;
  delta: Record<string, unknown>;
  finish_reason: string | null;
}

function sseChunk(
  delta: Record<string, unknown>,
  finish: string | null = null,
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number },
): string {
  const choice: SseChunkChoice = { index: 0, delta, finish_reason: finish };
  const body: Record<string, unknown> = {
    id: 'chatcmpl-mock',
    object: 'chat.completion.chunk',
    created: 1,
    model: 'mock-model',
    choices: [choice],
    ...(usage ? { usage } : {}),
  };
  return `data: ${JSON.stringify(body)}\n\n`;
}

function toolCallSse(text: string, name: string, args: Record<string, unknown>): string {
  return [
    sseChunk({ role: 'assistant', content: text }),
    sseChunk({
      tool_calls: [
        {
          index: 0,
          id: `call_${name}`,
          type: 'function',
          function: { name, arguments: JSON.stringify(args) },
        },
      ],
    }),
    sseChunk({}, 'tool_calls', { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 }),
    'data: [DONE]\n\n',
  ].join('');
}

function finalSse(text: string): string {
  return [
    sseChunk({ role: 'assistant', content: text }),
    sseChunk({}, 'stop', { prompt_tokens: 40, completion_tokens: 8, total_tokens: 48 }),
    'data: [DONE]\n\n',
  ].join('');
}

const HELLO_CONTENT = 'hello from ai\n';
const SHELL_COMMAND =
  "node -e \"console.log(require('node:fs').readFileSync('/scratch/src/hello.txt','utf8'))\"";

test('AI mode: mocked endpoint drives write_file + shell; trace exports without the key', async ({
  page,
}) => {
  test.setTimeout(240_000);

  // Lazy-loading watch: the ai module must not be fetched before the toggle.
  const aiModuleRequests: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/src/ai/')) aiModuleRequests.push(request.url());
  });

  await page.goto('/');
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, {
    timeout: 20_000,
  });
  // The project-first chooser auto-opens ~1s after a cold boot — out-wait it
  // so pickStarter never races the opening animation (react-vite spec pattern).
  await expect(page.locator('[data-testid="launcher"]')).toBeVisible({ timeout: 15_000 });
  await pickStarter(page, 'project-files');
  expect(aiModuleRequests, 'ai module must not load before AI mode opens').toEqual([]);

  // Scripted OpenAI-compatible SSE endpoint (same-origin via relative baseUrl).
  // Registered AFTER boot: active page.route interception during cold boot
  // breaks the workspace-owner worker fetches under COI (owner never ready).
  let calls = 0;
  await page.route('**/mock-ai/v1/chat/completions', async (route) => {
    calls += 1;
    const body =
      calls === 1
        ? toolCallSse('Creating the file.', 'write_file', {
            path: 'src/hello.txt',
            content: HELLO_CONTENT,
          })
        : calls === 2
          ? toolCallSse('Verifying via shell.', 'shell', { command: SHELL_COMMAND })
          : finalSse('All done — the file exists and prints correctly.');
    await route.fulfill({
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
      body,
    });
  });

  // Without ?agentBench=1 the bench namespace must be absent entirely (ADR-0191).
  expect(await page.evaluate(() => '__riftyAgentBench' in globalThis)).toBe(false);

  // Open AI mode (lazy import fires now) and configure the mocked endpoint.
  await page.click('[data-testid="ai-toggle"]');
  await expect(page.locator('[data-testid="ai-panel"]')).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => aiModuleRequests.length, { timeout: 30_000 }).toBeGreaterThan(0);

  await page.click('[data-testid="ai-settings-open"]');
  await page.fill('[data-testid="ai-settings-baseurl"]', '/mock-ai/v1');
  await page.fill('[data-testid="ai-settings-key"]', 'test-key-e2e');
  await page.fill('[data-testid="ai-settings-model"]', 'mock-model');
  await page.click('[data-testid="ai-settings-save"]');

  // Send the prompt (Enter = send).
  await page.fill('[data-testid="ai-input"]', 'Create src/hello.txt and print it');
  await page.press('[data-testid="ai-input"]', 'Enter');

  // Both tool calls render as cards (name + args + result).
  const writeCard = page.locator('[data-testid="ai-tool-card"][data-tool="write_file"]');
  const shellCard = page.locator('[data-testid="ai-tool-card"][data-tool="shell"]');
  await expect(writeCard).toBeVisible({ timeout: 60_000 });
  await expect(shellCard).toBeVisible({ timeout: 60_000 });

  // The run completes: final assistant text, status back to done.
  await expect(page.locator('[data-testid="ai-msg"][data-role="assistant"]').last()).toContainText(
    'All done',
    { timeout: 120_000 },
  );
  await expect(page.locator('[data-testid="ai-status"]')).toHaveText('done', { timeout: 30_000 });
  expect(calls).toBe(3);

  // Shell output (the file's content) is visible in the expanded card.
  await shellCard.locator('summary').click();
  await expect(shellCard.locator('.rf-ai__toolresult')).toContainText('hello from ai');
  await expect(shellCard.locator('.rf-ai__toolresult')).toContainText('exit code: 0');

  // The write landed in the REAL workspace: explorer shows src/hello.txt.
  const srcRow = page
    .locator('.rf-row[role="treeitem"][data-kind="dir"]', { hasText: 'src' })
    .first();
  await expect(srcRow).toBeVisible({ timeout: 30_000 });
  if ((await srcRow.getAttribute('aria-expanded')) !== 'true') {
    await srcRow.click({ force: true });
  }
  await expect(
    page.locator('.rf-row[role="treeitem"][data-kind="file"]', { hasText: 'hello.txt' }).first(),
  ).toBeVisible({ timeout: 30_000 });

  // Vibe view (ADR-0190): layout-only switch — chat + preview stay, IDE
  // chrome hides, and the SAME session/panel survives the toggle.
  await page.click('[data-testid="ai-view-vibe"]');
  await expect(page.locator('.rf-shell')).toHaveAttribute('data-ai-view', 'vibe');
  await expect(page.locator('.rf-editorhost')).toBeHidden();
  await expect(page.locator('.rf-console')).toBeHidden();
  await expect(page.locator('.rf-sidebar')).toBeHidden();
  await expect(page.locator('[data-testid="ai-panel"]')).toBeVisible();
  await expect(page.locator('[data-testid="preview"]')).toBeVisible();
  // The transcript (same session) is still there.
  await expect(writeCard).toBeVisible();
  await page.click('[data-testid="ai-view-chat"]');
  await expect(page.locator('.rf-shell')).toHaveAttribute('data-ai-view', 'chat');
  await expect(page.locator('.rf-editorhost')).toBeVisible();

  // Export session → parse the downloaded trace JSON.
  const downloadPromise = page.waitForEvent('download');
  await page.click('[data-testid="ai-export"]');
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('rifty-ai-session.json');
  const downloadedPath = await download.path();
  expect(downloadedPath).not.toBeNull();
  const raw = await readFile(downloadedPath as string, 'utf8');
  const trace = JSON.parse(raw) as {
    profile: string;
    config: Record<string, unknown>;
    transcript: { role: string; text: string }[];
    toolCalls: { name: string; isError?: boolean; result?: string }[];
    terminal: { command: string; exitCode: number; output: string }[];
    usage: { totalTokens: number };
    status: string;
    budget: { exceeded: boolean };
    finalDiff: unknown;
  };
  expect(trace.profile).toBe('pi-baseline+rifty-adapter-v1');
  expect(trace.status).toBe('done');
  expect(trace.budget).toEqual({ exceeded: false });
  expect(trace.config).toMatchObject({ baseUrl: '/mock-ai/v1', model: 'mock-model' });
  expect(trace.toolCalls.map((call) => call.name)).toEqual(['write_file', 'shell']);
  expect(trace.toolCalls.every((call) => call.isError === false)).toBe(true);
  expect(trace.transcript.map((m) => m.role)).toContain('user');
  expect(trace.transcript.at(-1)).toMatchObject({ role: 'assistant' });
  expect(trace.terminal).toHaveLength(1);
  expect(trace.terminal[0]?.command).toContain('node -e');
  expect(trace.terminal[0]?.output).toContain('hello from ai');
  expect(trace.usage.totalTokens).toBeGreaterThan(0);
  expect(trace).toHaveProperty('finalDiff');
  // The apiKey must be absent from the export — structurally, not filtered.
  expect(raw).not.toContain('test-key-e2e');
  expect(raw).not.toContain('apiKey');
});
