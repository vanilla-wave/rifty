import { expect, test } from '@playwright/test';
import { bootOwner, gotoHarness } from './fixtures.ts';
import type * as Proof from './fixtures/agent-core-proof.ts';

const proofUrl = `/@fs${process.cwd()}/tests/browser-unit/fixtures/agent-core-proof.ts`;

test.beforeEach(async ({ page }, info) => {
  await gotoHarness(page);
  await bootOwner(page, {
    workspaceId: `agent-core-${info.testId}`,
    persistence: 'ephemeral',
    template: info.title.startsWith('diagnostics match') ? 'typescript' : 'hidden-empty',
  });
});

test('real Workbench files and terminal, custom tools/transport, declared capabilities and trace', async ({
  page,
}) => {
  const result = await page.evaluate(
    async (url) => ((await import(/* @vite-ignore */ url)) as typeof Proof).proveTools(),
    proofUrl,
  );
  expect(result.status).toBe('done');
  expect(result.file).toBe('agent-content');
  expect(result.delivered).toBe('custom-action');
  expect(result.requests.every((request) => request.authorization === null)).toBe(true);
  const tools = result.requests[0]?.body.tools.map((tool) => tool.function.name);
  expect(tools).toContain('deliver_note');
  expect(tools).not.toContain('diagnostics');
  expect(tools).not.toContain('preview_fetch');
  expect(JSON.stringify(result.requests[0]?.body.messages)).toContain(
    'Project instruction: preserve',
  );
  expect(JSON.stringify(result.requests[0]?.body.messages)).toMatch(
    /unavailable.*diagnostics|diagnostics.*unavailable/i,
  );
  expect(
    result.events.some((event) => event.type === 'output' && event.chunk.includes('agent-content')),
  ).toBe(true);
  expect(result.trace.transcript.some((message) => message.role === 'toolResult')).toBe(true);
  expect(result.trace.usage.totalTokens).toBeGreaterThan(0);
  expect(result.trace.timings[0]?.endedAt).toBeGreaterThanOrEqual(
    result.trace.timings[0]?.startedAt ?? Number.POSITIVE_INFINITY,
  );
  expect(result.trace.config).not.toHaveProperty('apiKey');
});

test('provider failure retains completed write and continuation receives its result', async ({
  page,
}) => {
  const result = await page.evaluate(
    async (url) => ((await import(/* @vite-ignore */ url)) as typeof Proof).proveRecovery(),
    proofUrl,
  );
  expect(result.failedStatus).toBe('error');
  expect(result.failedTrace.transcript.some((message) => message.role === 'toolResult')).toBe(true);
  expect(result.status).toBe('done');
  expect(result.file).toBe('committed-once');
  expect(JSON.stringify(result.requests[2]?.body.messages)).toContain('call-0-0');
  expect(
    result.trace.transcript.filter(
      (message) => message.role === 'toolResult' && message.toolName === 'write_file',
    ),
  ).toHaveLength(1);
});

test('Stop settles active and pending calls, releases the real terminal, then runs again', async ({
  page,
}) => {
  const result = await page.evaluate(
    async (url) => ((await import(/* @vite-ignore */ url)) as typeof Proof).proveStop(),
    proofUrl,
  );
  expect(result.stoppedStatus).toBe('aborted');
  expect(
    result.stoppedTrace.transcript.filter((message) => message.role === 'toolResult'),
  ).toHaveLength(2);
  expect(
    result.stoppedTrace.transcript
      .filter((message) => message.role === 'toolResult')
      .every((message) => message.role === 'toolResult' && message.isError),
  ).toBe(true);
  expect(result.paths).not.toContain('/must-not-run.txt');
  expect(result.status).toBe('done');
  expect(
    result.events.some((event) => event.type === 'output' && event.chunk.includes('NEXT_COMMAND')),
  ).toBe(true);
});

test('budget exhaustion is distinct and blocks the next side effect', async ({ page }) => {
  const result = await page.evaluate(
    async (url) => ((await import(/* @vite-ignore */ url)) as typeof Proof).proveBudget(),
    proofUrl,
  );
  expect(result.status).toBe('budget-exceeded');
  expect(result.paths).toContain('/allowed.txt');
  expect(result.paths).not.toContain('/over-budget.txt');
});

test('file tools enforce exact edits and unified patches over real project files', async ({
  page,
}) => {
  const result = await page.evaluate(
    async (url) => ((await import(/* @vite-ignore */ url)) as typeof Proof).proveFileTools(),
    proofUrl,
  );
  expect(result.status).toBe('done');
  expect(result.file).toBe('alpha\ndelta\n');
  const errors = result.trace.transcript.filter(
    (message) => message.role === 'toolResult' && message.isError,
  );
  expect(errors).toHaveLength(1);
  expect(JSON.stringify(errors)).toContain('string not found');
  expect(JSON.stringify(result.trace.transcript)).toContain('nested/source.txt:2: gamma');
});

test('diagnostics match the real companion and export includes SCM state', async ({ page }) => {
  const result = await page.evaluate(
    async (url) => ((await import(/* @vite-ignore */ url)) as typeof Proof).proveCompanion(),
    proofUrl,
  );
  expect(result.status).toBe('done');
  expect(result.expectedDiagnostics.length).toBeGreaterThan(0);
  const resultMessage = result.trace.transcript.find(
    (message) => message.role === 'toolResult' && message.toolName === 'diagnostics',
  );
  expect(resultMessage?.content).toEqual([
    { type: 'text', text: JSON.stringify(result.expectedDiagnostics) },
  ]);
  expect(JSON.stringify(result.trace.finalDiff)).toContain('diagnostic.ts');
  expect(result.trace.finalDiff).not.toHaveProperty('error');
});

test('preview tools use a real host document and exact supplied URL', async ({ page }) => {
  const result = await page.evaluate(
    async (url) => ((await import(/* @vite-ignore */ url)) as typeof Proof).provePreview(),
    proofUrl,
  );
  expect(result.status).toBe('done');
  expect(result.output).toBe('changed');
  const results = result.trace.transcript.filter((message) => message.role === 'toolResult');
  expect(results.every((message) => message.role === 'toolResult' && !message.isError)).toBe(true);
  expect(JSON.stringify(results)).toContain('browser-unit-harness');
  expect(JSON.stringify(results.at(-1))).toContain('changed');
});

test('tool result cap preserves UTF-8 head and tail with an explicit omitted-byte count', async ({
  page,
}) => {
  const result = await page.evaluate(
    async (url) => ((await import(/* @vite-ignore */ url)) as typeof Proof).proveCap(),
    proofUrl,
  );
  expect(result.status).toBe('done');
  const message = result.trace.transcript.find((entry) => entry.role === 'toolResult');
  const text =
    message?.content
      .filter((entry) => entry.type === 'text')
      .map((entry) => entry.text)
      .join('') ?? '';
  expect(new TextEncoder().encode(text).length).toBeLessThanOrEqual(16 * 1024);
  expect(text).toContain('HEAD');
  expect(text).toContain('TAIL');
  expect(text).toMatch(/\[truncated \d+ bytes\]/);
  expect(text).not.toContain('\ufffd');
});

test('a full custom stream receives explicit outcomes for calls skipped by Stop', async ({
  page,
}) => {
  const result = await page.evaluate(
    async (url) => ((await import(/* @vite-ignore */ url)) as typeof Proof).proveStop(true),
    proofUrl,
  );
  expect(result.stoppedStatus).toBe('aborted');
  expect(result.status).toBe('done');
  expect(result.requests).toHaveLength(3);
});

test('wall-clock budget cancels a stalled provider request', async ({ page }) => {
  const result = await page.evaluate(
    async (url) => ((await import(/* @vite-ignore */ url)) as typeof Proof).proveTimeBudget(),
    proofUrl,
  );
  expect(result).toEqual({ status: 'budget-exceeded', aborted: true });
});

test('Workbench host retains the read CAS version when an editor saves concurrently', async ({
  page,
}) => {
  const result = await page.evaluate(
    async (url) => ((await import(/* @vite-ignore */ url)) as typeof Proof).proveConcurrentEdit(),
    proofUrl,
  );
  expect(result).toEqual({ file: 'editor-change', error: 'FileConflictError' });
});
