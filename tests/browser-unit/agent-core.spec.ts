import { expect, test } from '@playwright/test';
import { bootOwner, gotoHarness } from './fixtures.ts';
import type * as Proof from './fixtures/agent-core-proof.ts';
import type * as HistoryProof from './fixtures/agent-history-proof.ts';

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
  expect(result.completedTrace?.timings).toHaveLength(1);
});

test('provider failure retains completed write and continuation receives its result', async ({
  page,
}) => {
  const result = await page.evaluate(
    async (url) => ((await import(/* @vite-ignore */ url)) as typeof Proof).proveRecovery(),
    proofUrl,
  );
  expect(result.failedStatus).toBe('error');
  const ended = result.trace.events
    .flatMap(({ event }) =>
      event.type === 'agent' && event.event.type === 'agent_end' ? [event.event] : [],
    )
    .at(-1);
  expect(ended?.messages[0]?.role).toBe('user');
  expect(
    ended?.messages.some(
      (message) => message.role === 'toolResult' && message.toolName === 'write_file',
    ),
  ).toBe(false);
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
  const nativeEvents = result.stoppedTrace.events.flatMap(({ event }) =>
    event.type === 'agent' ? [event.event] : [],
  );
  expect(nativeEvents.at(-1)?.type).toBe('agent_end');
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
  expect(errors).toHaveLength(3);
  expect(JSON.stringify(errors)).toContain('string not found');
  expect(JSON.stringify(errors)).toContain('string is not unique');
  expect(JSON.stringify(errors)).toContain('does not match');
  expect(JSON.stringify(result.trace.transcript)).toContain('nested/source.txt:2: gamma');
  for (const name of ['glob', 'list_files', 'read_file']) {
    const message = result.trace.transcript.find(
      (message) => message.role === 'toolResult' && message.toolName === name,
    );
    expect(message).toHaveProperty('isError', false);
    expect(JSON.stringify(message)).toContain(name === 'read_file' ? 'delta' : 'nested/source.txt');
  }
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
  expect(text.startsWith('\ufeffHEAD')).toBe(true);
  expect(text).toContain('TAIL');
  expect(text).toMatch(/\[truncated \d+ bytes\]/);
  expect(text).not.toContain('\ufffd');
  const extension = result.trace.transcript.find(
    (entry) => entry.role === 'toolResult' && entry.toolName === 'large_result',
  );
  const extensionText =
    extension?.content
      .filter((entry) => entry.type === 'text')
      .map((entry) => entry.text)
      .join('') ?? '';
  expect(new TextEncoder().encode(extensionText).length).toBeLessThanOrEqual(16 * 1024);
  expect(extensionText).toContain('EXT_HEAD');
  expect(extensionText).toContain('EXT_TAIL');
  expect(extensionText).toMatch(/\[truncated \d+ bytes\]/);
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

test('supplied API key reaches only the transport and is removed from exported values', async ({
  page,
}) => {
  const result = await page.evaluate(
    async (url) => ((await import(/* @vite-ignore */ url)) as typeof Proof).proveKeyExport(),
    proofUrl,
  );
  expect(result.authorization).toBe(`Bearer ${result.key}`);
  expect(result.trace.config).not.toHaveProperty('apiKey');
  expect(JSON.stringify(result.trace)).not.toContain(JSON.stringify(result.key).slice(1, -1));
  expect(JSON.stringify(result.trace)).toContain('[redacted]');
});

test('agent shell stdout, stderr and owner exit match the real user terminal', async ({ page }) => {
  const result = await page.evaluate(
    async (url) => ((await import(/* @vite-ignore */ url)) as typeof Proof).proveShellParity(),
    proofUrl,
  );
  const message = result.trace.transcript.find(
    (message) => message.role === 'toolResult' && message.toolName === 'shell',
  );
  expect(message).toHaveProperty('details.stdout', result.reference.stdout);
  expect(message).toHaveProperty('details.stderr', result.reference.stderr);
  expect(message).toHaveProperty('details.exitCode', result.reference.exitCode);
  expect(message).toHaveProperty('details.status', 'exited');
  expect(result.reference.exitCode).toBe(7);
  expect(JSON.stringify(result.trace.events)).toContain('PARITY_OUTPUT');
});

test('consumer domain data does not change Pi tool success semantics', async ({ page }) => {
  const trace = await page.evaluate(
    async (url) => ((await import(/* @vite-ignore */ url)) as typeof Proof).proveDomainResult(),
    proofUrl,
  );
  const result = trace.transcript.find((message) => message.role === 'toolResult');
  expect(result).toHaveProperty('isError', false);
  expect(result).toHaveProperty('details.status', 'failed');
});

test('Stop during a partial model tool call leaves a continuable provider history', async ({
  page,
}) => {
  const result = await page.evaluate(
    async (url) =>
      ((await import(/* @vite-ignore */ url)) as typeof Proof).provePartialStreamStop(),
    proofUrl,
  );
  expect(result.stopped).toBe('aborted');
  expect(result.finished).toBe('done');
  expect(result.unmatchedResults).toEqual([]);
  expect(result.paths).not.toContain('/partial.txt');
  expect(
    result.trace.transcript.some(
      (message) => message.role === 'assistant' && message.stopReason === 'aborted',
    ),
  ).toBe(true);
});

test('exact edit preserves the UTF-8 BOM outside the replaced text', async ({ page }) => {
  const bytes = await page.evaluate(
    async (url) => ((await import(/* @vite-ignore */ url)) as typeof Proof).proveBomEdit(),
    proofUrl,
  );
  expect(bytes).toEqual(Array.from(new TextEncoder().encode('\ufeffbeta')));
});

test('fresh headless session restores persisted native messages with a changed model', async ({
  page,
}) => {
  const result = await page.evaluate(async (url) => {
    const proof = (await import(/* @vite-ignore */ url)) as typeof HistoryProof;
    return proof.proveHistory();
  }, `/@fs${process.cwd()}/tests/browser-unit/fixtures/agent-history-proof.ts`);
  expect(result.status).toBe('done');
  expect(result.file).toBe('persisted work');
  expect(result.restored.transcript).toEqual(result.seed);
  expect(result.restored).toMatchObject({
    restoredMessageCount: result.seed.length,
    timings: [],
    usage: { totalTokens: 0 },
  });
  expect(JSON.stringify(result.requests[0]?.body.messages)).toContain('Remember this work.');
  expect(JSON.stringify(result.requests[0]?.body.messages)).toContain('Write remember.txt');
  expect(result.requests[0]?.body).toHaveProperty('model', 'new-model');
  expect(
    result.continued.transcript.filter(
      (m) => m.role === 'toolResult' && m.toolName === 'write_file',
    ),
  ).toHaveLength(1);
  expect(result.continued.timings).toHaveLength(1);
  expect(result.reset).toHaveProperty('restoredMessageCount', 0);
  expect(JSON.stringify(result.requests[2]?.body.messages)).not.toContain('Remember this work.');
});
