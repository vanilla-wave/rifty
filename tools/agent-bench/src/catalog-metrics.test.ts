import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type AgentSessionEvent,
  createAgentSession,
  createModels,
  createOpenAIProvider,
} from '@riftydev/agent';
import { expect, it } from 'vitest';
import { MemoryVfs } from '../../../packages/vfs/src/index.ts';
import { scriptedProvider } from '../../../tests/integration/fixtures/workbench-vite-consumer/src/agent-scripted-provider.ts';
import { loadConfig } from './config.ts';
import { coreObservation } from './lanes/core-observation.ts';
import { type Report, writeReport } from './report.ts';

const endpoint = {
  id: 'small',
  name: 'Small',
  provider: 'local',
  api: 'openai-completions' as const,
  baseUrl: 'https://bench.invalid/v1',
  contextWindow: 32768,
  maxTokens: 4096,
  input: ['text' as const],
  reasoning: true,
  thinking: 'medium' as const,
  temperature: 1,
  samplingParams: { top_p: 0.95 },
  compat: { supportsReasoningEffort: true },
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
};

it('loads a native catalog endpoint without inventing its window or output limit', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'rifty-bench-config-'));
  try {
    const file = join(dir, 'config.json');
    await writeFile(file, JSON.stringify({ endpoint }));
    expect((await loadConfig(file)).endpoint).toEqual(endpoint);
    const { contextWindow: _window, ...missing } = endpoint;
    await writeFile(file, JSON.stringify({ endpoint: missing }));
    await expect(loadConfig(file)).rejects.toThrow(/contextWindow/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

async function observed(
  replies: Parameters<typeof scriptedProvider>[0],
  cached = 0,
  maxToolCalls?: number,
) {
  const wire = scriptedProvider(replies);
  const models = createModels();
  models.setProvider(
    createOpenAIProvider({
      id: endpoint.provider,
      models: [endpoint],
      fetch: async (input, init) => {
        const response = await wire.fetch(input, init);
        if (!cached) return response;
        const body = (await response.text()).replaceAll(
          '"prompt_tokens":10',
          `"prompt_tokens":10,"prompt_tokens_details":{"cached_tokens":${cached}}`,
        );
        return new Response(body, { status: response.status, headers: response.headers });
      },
    }),
  );
  const vfs = new MemoryVfs();
  await vfs.writeFile('/one.txt', 'hello');
  const session = createAgentSession({
    maxToolCalls,
    models,
    model: endpoint.id,
    host: {
      root: '/',
      async close() {},
      capabilities: () => ({
        files: {
          read: (path: string) => vfs.readFileText(path),
          list: async (path: string) =>
            (await vfs.readdir(path)).map((entry) => ({
              path: `${path.replace(/\/$/, '')}/${entry.name}`,
              kind: entry.isDirectory ? ('dir' as const) : ('file' as const),
            })),
          async change(path: string, transform: (text: string | null) => string | null) {
            const next = transform((await vfs.exists(path)) ? await vfs.readFileText(path) : null);
            if (next === null) await vfs.rm(path);
            else await vfs.writeFile(path, next);
          },
        },
      }),
    },
  });
  const events: AgentSessionEvent[] = [];
  session.subscribe((event) => events.push(structuredClone(event)));
  try {
    await session.send('Inspect the file.');
    return {
      trace: await session.exportTrace(),
      observation: coreObservation(await session.exportTrace(), wire.requests, events),
      text: await vfs.readFileText('/one.txt'),
    };
  } finally {
    await session.dispose();
  }
}

it('counts actual pi usage, edit failure and argument validation without changing tools', async () => {
  const result = await observed([
    [{ name: 'edit_file', args: { path: 'one.txt', old: 'absent', new: 'world' } }],
    [{ name: 'read_file', args: {} }],
    'Done.',
  ]);
  expect(result.text).toBe('hello');
  expect(result.observation).toMatchObject({
    inputTokens: 30,
    outputTokens: 9,
    retries: 0,
    compactions: 0,
    repeatedCallNotices: 0,
    editFailures: 1,
    malformedToolCalls: 1,
  });
});

it('classifies real provider context errors and renders metrics/effective catalog values', async () => {
  const result = await observed([{ error: 'maximum context length is 32768 tokens' }]);
  expect(result.observation).toMatchObject({
    agentStatus: 'context-exceeded',
    contextExceeded: true,
  });
  const dir = await mkdtemp(join(tmpdir(), 'rifty-bench-report-'));
  try {
    const report = {
      header: {
        createdAt: new Date(0).toISOString(),
        sourceRevision: 'probe',
        sourceDirty: false,
        versions: { node: 'test', piCli: '0.85.1' },
        model: endpoint.id,
        endpoint,
        profile: 'test',
        taskSet: 'unchanged',
        limits: { maxToolCalls: 40, runTimeoutMs: 600000 },
        runsPerTask: 1,
        toolContextCaveat: '',
        unsupported: [],
      },
      runs: [
        {
          ...result.observation,
          task: 'existing',
          lane: 'rifty',
          runIndex: 1,
          profile: 'test',
          outcome: 'context-exceeded',
          elapsedMs: 1,
          judge: { pass: false, probes: [] },
          finalDiff: [],
          artifacts: { trace: 'trace.json' },
          failureClass: 'provider',
          note: 'manual class retained',
        },
      ],
    } as unknown as Report;
    await writeReport(dir, report);
    const markdown = await readFile(join(dir, 'summary.md'), 'utf8');
    for (const text of [
      'contextWindow',
      'thinking',
      'Input tokens',
      'Output tokens',
      'Retries',
      'Compactions',
      'Repeated calls',
      'Edit failures',
      'Malformed calls',
      'context-exceeded',
      'manual class retained',
    ])
      expect(markdown).toContain(text);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it('counts native CLI compaction and its summary usage from actual session events', async () => {
  const {
    DefaultResourceLoader,
    ModelRuntime,
    SessionManager,
    SettingsManager,
    createAgentSession: createPiSession,
  } = await import('@earendil-works/pi-coding-agent');
  const { eventMetrics } = await import('./metrics.ts');
  const dir = await mkdtemp(join(tmpdir(), 'rifty-native-compaction-metrics-'));
  const wire = scriptedProvider(['Summary of the old exchange.']);
  const settings = SettingsManager.inMemory({
    compaction: { enabled: true, reserveTokens: 64, keepRecentTokens: 20 },
    retry: { enabled: false },
  });
  const loader = new DefaultResourceLoader({
    cwd: dir,
    agentDir: dir,
    settingsManager: settings,
    noContextFiles: true,
    noSkills: true,
    noPromptTemplates: true,
    noExtensions: true,
    noThemes: true,
  });
  await loader.reload();
  const runtime = await ModelRuntime.create({
    modelsPath: null,
    authPath: join(dir, 'auth.json'),
    modelsStorePath: join(dir, 'models-store.json'),
    refreshOnCreate: false,
    allowModelNetwork: false,
  });
  runtime.registerNativeProvider(
    createOpenAIProvider({ id: endpoint.provider, models: [endpoint], fetch: wire.fetch }),
  );
  const manager = SessionManager.inMemory(dir);
  const usage = {
    input: 1,
    output: 1,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 2,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
  for (const [prompt, response] of [
    ['old '.repeat(300), 'old answer '.repeat(300)],
    ['recent', 'recent answer'],
  ]) {
    manager.appendMessage({ role: 'user', content: prompt!, timestamp: 1 });
    manager.appendMessage({
      role: 'assistant',
      api: 'openai-completions',
      provider: endpoint.provider,
      model: endpoint.id,
      content: [{ type: 'text', text: response! }],
      stopReason: 'stop',
      timestamp: 2,
      usage,
    });
  }
  const { session } = await createPiSession({
    cwd: dir,
    agentDir: dir,
    modelRuntime: runtime,
    model: runtime.getModel(endpoint.provider, endpoint.id)!,
    sessionManager: manager,
    settingsManager: settings,
    resourceLoader: loader,
  });
  const events: unknown[] = [];
  const detach = session.subscribe((event) => events.push(event));
  try {
    const result = await session.compact();
    expect(wire.requests.length).toBeGreaterThan(0);
    expect(eventMetrics(events, endpoint.contextWindow, 'done')).toMatchObject({
      compactions: 1,
      inputTokens: result.usage?.input,
      outputTokens: result.usage?.output,
      retries: 0,
    });
    expect(result.usage?.input).toBe(wire.requests.length * 10);
    expect(result.usage?.output).toBe(wire.requests.length * 3);
  } finally {
    detach();
    session.dispose();
    await rm(dir, { recursive: true, force: true });
  }
});

it('input-token totals include the cache hits reported by the real pi parser', async () => {
  const result = await observed(['Done.'], 6);
  expect(result.trace.usage).toMatchObject({ input: 4, output: 3, totalTokens: 13 });
  expect(result.observation).toMatchObject({ inputTokens: 10, outputTokens: 3 });
});

it('does not count a budget-blocked proposal as an executed tool after receipt formatting', async () => {
  const result = await observed(
    [
      [
        { name: 'write_file', args: { path: 'one.txt', content: 'one' } },
        { name: 'write_file', args: { path: 'one.txt', content: 'must not write' } },
      ],
    ],
    0,
    1,
  );
  expect(result.observation).toMatchObject({ agentStatus: 'budget-exceeded', toolCalls: 1 });
  expect(result.text).toBe('one');
});
