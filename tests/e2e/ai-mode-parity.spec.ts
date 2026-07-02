/**
 * AI mode parity cases (docs/backlog/distribution/ai-mode-playground.md) +
 * agent-bench hooks (ADR-0191), CI-safe (no real model): a scripted
 * OpenAI-compatible SSE mock drives the REAL tool paths on the react-vite
 * preset (dev server + ts-LS):
 *   (a) shell `node -e "console.log(1)"` ≡ the same line typed in a user
 *       terminal (same pty path, same stdout/exit code);
 *   (b) write_file on a watched component triggers the same HMR preview
 *       update as an editor save (Fast Refresh, no full reload — sentinel);
 *   (c) edit_file with a non-matching `old` fails loudly in the chat card;
 *   (d) diagnostics on a type-error file matches the Problems panel content;
 * plus preview_fetch / preview_query / preview_click / preview_type against
 * the live preview, and `__riftyAgentBench` seed/exportTrace/sessionMetadata
 * under `?agentBench=1`.
 */
import { type Page, expect, test } from '@playwright/test';
import {
  expectViteDevServerReady,
  openShellTerminal,
  pickStarter,
  runTerminalLine,
  terminalBuffer,
} from './helpers/playground.ts';

const PORT = 5174;
const BROKEN_TS = "export const brokenParity: number = 'not a number';\n";
const TS2322_MSG = "Type 'string' is not assignable to type 'number'";

interface SseChunkChoice {
  index: number;
  delta: Record<string, unknown>;
  finish_reason: string | null;
}

function sseChunk(delta: Record<string, unknown>, finish: string | null = null): string {
  const choice: SseChunkChoice = { index: 0, delta, finish_reason: finish };
  const body = {
    id: 'chatcmpl-mock',
    object: 'chat.completion.chunk',
    created: 1,
    model: 'mock-model',
    choices: [choice],
    ...(finish ? { usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 } } : {}),
  };
  return `data: ${JSON.stringify(body)}\n\n`;
}

let toolCallCounter = 0;
function toolCallSse(name: string, args: Record<string, unknown>): string {
  toolCallCounter += 1;
  return [
    sseChunk({ role: 'assistant', content: `calling ${name}` }),
    sseChunk({
      tool_calls: [
        {
          index: 0,
          id: `call_${name}_${toolCallCounter}`,
          type: 'function',
          function: { name, arguments: JSON.stringify(args) },
        },
      ],
    }),
    sseChunk({}, 'tool_calls'),
    'data: [DONE]\n\n',
  ].join('');
}

function finalSse(text: string): string {
  return [
    sseChunk({ role: 'assistant', content: text }),
    sseChunk({}, 'stop'),
    'data: [DONE]\n\n',
  ].join('');
}

/** The latest tool-result content in the mocked model's request body. */
function lastToolContent(postData: string): string {
  const parsed = JSON.parse(postData) as {
    messages: { role: string; content: unknown }[];
  };
  const last = [...parsed.messages].reverse().find((m) => m.role === 'tool');
  if (!last) throw new Error('mock: no tool result in request');
  if (typeof last.content === 'string') return last.content;
  if (Array.isArray(last.content)) {
    return (last.content as { type?: string; text?: string }[])
      .filter((block) => block.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text)
      .join('');
  }
  throw new Error('mock: unrecognized tool content shape');
}

async function sendAndAwaitDone(page: Page, prompt: string): Promise<void> {
  await page.fill('[data-testid="ai-input"]', prompt);
  await page.press('[data-testid="ai-input"]', 'Enter');
  await expect(page.locator('[data-testid="ai-status"]')).toHaveText('done', { timeout: 120_000 });
}

test.describe('AI mode parity on react-vite', () => {
  test('shell/HMR/edit_file/diagnostics parity + preview tools + agent-bench hooks', async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'workspace owner is COI/SAB-gated — chromium only');
    test.setTimeout(420_000);

    const marker = `ai-hmr-${Date.now()}`;
    // App.tsx line (same shape as react-vite-preset.spec.ts): stamps the
    // always-visible .brand element so the HMR-patched module proves it ran.
    const markerLine = `setInterval(() => { const el = document.querySelector('.brand'); if (el) el.textContent = ${JSON.stringify(
      marker,
    )}; }, 50);\n`;

    // agent-bench gate is a URL flag — boot with it, then pick the preset.
    await page.goto('/?agentBench=1');
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, {
      timeout: 20_000,
    });
    await expect(page.locator('[data-testid="launcher"]')).toBeVisible({ timeout: 15_000 });
    await pickStarter(page, 'react-vite');
    await expectViteDevServerReady(page, PORT, 120_000);

    const frame = page.frameLocator(`iframe[title="Preview port ${PORT}"]`);
    await expect(frame.locator('.stat-card--total .stat-card__value')).toHaveText('25', {
      timeout: 60_000,
    });

    // ── agent-bench namespace present + seed through the acked owner path.
    expect(await page.evaluate(() => '__riftyAgentBench' in globalThis)).toBe(true);
    await page.evaluate(() =>
      (
        globalThis as typeof globalThis & {
          __riftyAgentBench: { seed(files: Record<string, string>): Promise<void> };
        }
      ).__riftyAgentBench.seed({ 'seed-marker.txt': 'bench-seeded\n' }),
    );
    await expect(
      page.locator('.rf-row[role="treeitem"][data-kind="file"]', { hasText: 'seed-marker.txt' }),
    ).toBeVisible({ timeout: 30_000 });

    // ── Scripted model. Registered AFTER boot (page.route during cold boot
    // breaks owner-worker fetches under COI — see ai-mode.spec.ts).
    const script: ((postData: string) => string)[] = [
      // send 1 — parity (a): shell
      () => toolCallSse('shell', { command: 'node -e "console.log(1)"' }),
      () => finalSse('shell run complete'),
      // send 2 — parity (b): read then write the watched component
      () => toolCallSse('read_file', { path: 'src/App.tsx' }),
      (postData) =>
        toolCallSse('write_file', {
          path: 'src/App.tsx',
          content: markerLine + lastToolContent(postData),
        }),
      () => finalSse('component updated'),
      // send 3 — preview_query + preview_click (live preview DOM)
      () => toolCallSse('preview_query', { selector: '.brand' }),
      () => toolCallSse('preview_click', { selector: 'a[href="/issues"]' }),
      () => finalSse('navigated to issues'),
      // send 4 — preview_type (framework-visible input) + preview_fetch
      () => toolCallSse('preview_type', { selector: '.filter-bar select', text: 'open' }),
      () => toolCallSse('preview_fetch', { path: '/src/App.tsx' }),
      () => finalSse('filtered and fetched'),
      // send 5 — parity (c): edit_file with a non-matching old string
      () =>
        toolCallSse('edit_file', {
          path: 'src/App.tsx',
          old: 'THIS STRING DOES NOT EXIST ANYWHERE',
          new: 'x',
        }),
      () => finalSse('saw the edit error'),
      // send 6 — parity (d): write a type error, then diagnostics
      () => toolCallSse('write_file', { path: 'src/broken-parity.ts', content: BROKEN_TS }),
      () => toolCallSse('diagnostics', { path: 'src/broken-parity.ts' }),
      () => finalSse('PARITY-DONE'),
    ];
    let calls = 0;
    await page.route('**/mock-ai/v1/chat/completions', async (route) => {
      const handler = script[calls];
      calls += 1;
      if (!handler) {
        await route.fulfill({ status: 500, body: 'mock script exhausted' });
        return;
      }
      await route.fulfill({
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
        body: handler(route.request().postData() ?? ''),
      });
    });

    // ── Open AI mode, point it at the mock.
    await page.click('[data-testid="ai-toggle"]');
    await expect(page.locator('[data-testid="ai-panel"]')).toBeVisible({ timeout: 30_000 });
    await page.click('[data-testid="ai-settings-open"]');
    await page.fill('[data-testid="ai-settings-baseurl"]', '/mock-ai/v1');
    await page.fill('[data-testid="ai-settings-key"]', 'test-key-e2e');
    await page.fill('[data-testid="ai-settings-model"]', 'mock-model');
    await page.click('[data-testid="ai-settings-save"]');

    // ── send 1 — parity (a): agent shell output ≡ user terminal output.
    await sendAndAwaitDone(page, 'run node -e console.log(1)');
    const shellCard = page.locator('[data-testid="ai-tool-card"][data-tool="shell"]');
    await shellCard.locator('summary').click();
    await expect(shellCard.locator('.rf-ai__toolresult')).toContainText('exit code: 0');
    // The same line typed into a USER terminal (same owner pty path):
    await openShellTerminal(page);
    await runTerminalLine(page, 'node -e "console.log(1)"');
    await expect
      .poll(async () => (await terminalBuffer(page)).replace(/\r/g, ''), { timeout: 30_000 })
      .toMatch(/\n1\n/);

    // ── send 2 — parity (b): write_file → same HMR update as an editor save.
    await frame.locator('body').evaluate(() => {
      (globalThis as typeof globalThis & { __riftyHmrSentinel?: string }).__riftyHmrSentinel =
        'alive';
    });
    await sendAndAwaitDone(page, 'stamp the brand element from App.tsx');
    await expect(
      page.locator('[data-testid="ai-tool-card"][data-tool="write_file"]').first(),
    ).toBeVisible();
    await expect(frame.locator('.brand')).toHaveText(marker, { timeout: 30_000 });
    // Fast Refresh, not a reload: the pre-edit sentinel survived.
    await expect
      .poll(() =>
        frame
          .locator('body')
          .evaluate(
            () =>
              (globalThis as typeof globalThis & { __riftyHmrSentinel?: string })
                .__riftyHmrSentinel,
          ),
      )
      .toBe('alive');

    // ── send 3: preview_query sees the live DOM; preview_click navigates.
    await sendAndAwaitDone(page, 'inspect the brand and open the issues page');
    const queryCard = page.locator('[data-testid="ai-tool-card"][data-tool="preview_query"]');
    await queryCard.locator('summary').click();
    await expect(queryCard.locator('.rf-ai__toolresult')).toContainText('1 match(es)');
    await expect(queryCard.locator('.rf-ai__toolresult')).toContainText('brand');
    await expect(frame.locator('.issue-card')).toHaveCount(25, { timeout: 30_000 });

    // ── send 4: preview_type filters (React saw the change); preview_fetch
    // returns the dev-server-served module (contains the HMR marker).
    await sendAndAwaitDone(page, 'filter open issues and fetch the component source');
    await expect(frame.locator('.issue-card')).toHaveCount(12, { timeout: 30_000 });
    const fetchCard = page.locator('[data-testid="ai-tool-card"][data-tool="preview_fetch"]');
    await fetchCard.locator('summary').click();
    await expect(fetchCard.locator('.rf-ai__toolresult')).toContainText('200');
    await expect(fetchCard.locator('.rf-ai__toolresult')).toContainText(marker);

    // ── send 5 — parity (c): non-matching edit_file fails loudly in the card.
    await sendAndAwaitDone(page, 'try a bad edit');
    const editCard = page.locator('[data-testid="ai-tool-card"][data-tool="edit_file"]');
    await expect(editCard).toHaveAttribute('data-error', 'true');
    await editCard.locator('summary').click();
    await expect(editCard.locator('.rf-ai__toolresult')).toContainText(
      'string not found in src/App.tsx',
    );

    // ── send 6 — parity (d): diagnostics ≡ Problems panel content.
    await sendAndAwaitDone(page, 'write a broken file and check its diagnostics');
    const diagCard = page.locator('[data-testid="ai-tool-card"][data-tool="diagnostics"]');
    await diagCard.locator('summary').click();
    await expect(diagCard.locator('.rf-ai__toolresult')).toContainText(TS2322_MSG, {
      timeout: 60_000,
    });
    await expect(diagCard.locator('.rf-ai__toolresult')).toContainText('TS2322');
    // The Problems panel shows the SAME diagnostic once the file is open.
    const srcRow = page
      .locator('.rf-row[role="treeitem"][data-kind="dir"]', { hasText: 'src' })
      .first();
    await expect(srcRow).toBeVisible({ timeout: 30_000 });
    if ((await srcRow.getAttribute('aria-expanded')) !== 'true') {
      await srcRow.click({ force: true });
    }
    await page
      .locator('.rf-row[role="treeitem"][data-kind="file"]', { hasText: 'broken-parity.ts' })
      .first()
      .click({ force: true });
    await page.click('[data-testid="problems-tab"]');
    const problemRow = page.locator('[data-testid="problem-row"]', { hasText: TS2322_MSG });
    await expect(problemRow).toBeVisible({ timeout: 60_000 });
    await expect(problemRow).toContainText('broken-parity.ts');

    expect(calls).toBe(script.length);

    // ── agent-bench exportTrace / sessionMetadata observe the live session.
    type BenchGlobal = typeof globalThis & {
      __riftyAgentBench: {
        exportTrace(): Promise<unknown>;
        sessionMetadata(): unknown;
      };
    };
    const metadata = await page.evaluate(() =>
      (globalThis as BenchGlobal).__riftyAgentBench.sessionMetadata(),
    );
    expect(metadata).toEqual({
      promptProfile: 'pi-baseline+rifty-adapter-v1',
      model: 'mock-model',
      limits: { maxToolCalls: 50, runTimeoutMs: 600_000 },
      presetId: 'react-vite',
    });
    const benchTrace = (await page.evaluate(() =>
      (globalThis as BenchGlobal).__riftyAgentBench.exportTrace(),
    )) as {
      profile: string;
      status: string;
      toolCalls: { name: string; isError: boolean }[];
      terminal: { command: string; output: string }[];
      config: Record<string, unknown>;
    };
    expect(benchTrace.profile).toBe('pi-baseline+rifty-adapter-v1');
    expect(benchTrace.status).toBe('done');
    expect(benchTrace.toolCalls.map((c) => c.name)).toEqual([
      'shell',
      'read_file',
      'write_file',
      'preview_query',
      'preview_click',
      'preview_type',
      'preview_fetch',
      'edit_file',
      'write_file',
      'diagnostics',
    ]);
    // parity (a), trace side: the agent's stdout for console.log(1) is exactly "1".
    expect(benchTrace.terminal[0]?.command).toBe('node -e "console.log(1)"');
    expect(
      benchTrace.terminal[0]?.output
        .replace(/\r/g, '')
        .replace(/^exit code: 0\n/, '')
        .trim(),
    ).toBe('1');
    expect(JSON.stringify(benchTrace)).not.toContain('test-key-e2e');
  });
});
