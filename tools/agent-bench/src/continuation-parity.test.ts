import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type AssistantMessage,
  type Context,
  type Message,
  type Model,
  type SimpleStreamOptions,
  createAssistantMessageEventStream,
  createModels,
  createProvider,
  getCurrentSystemPrompt,
} from '@earendil-works/pi-ai';
import {
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  createAgentSession as createNativeSession,
} from '@earendil-works/pi-coding-agent';
import { type AgentMessage, Type, createAgentSession } from '@riftydev/agent';
import { expect, it } from 'vitest';
import { eventMetrics } from './metrics.ts';

const model: Model<'openai-completions'> = {
  id: 'probe',
  name: 'probe',
  provider: 'probe',
  api: 'openai-completions',
  baseUrl: 'https://continuation.invalid',
  input: ['text'],
  reasoning: false,
  contextWindow: 32000,
  maxTokens: 8192,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
};
function answer(
  text: string,
  input = 10,
  stopReason: AssistantMessage['stopReason'] = 'stop',
): AssistantMessage {
  return {
    role: 'assistant',
    model: model.id,
    provider: model.provider,
    api: model.api,
    content: [{ type: 'text', text }],
    timestamp: Date.now(),
    stopReason,
    usage: {
      input,
      output: 2,
      totalTokens: input + 2,
      cacheRead: 0,
      cacheWrite: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    ...(stopReason === 'error' ? { errorMessage: text } : {}),
  };
}
const seed = (): Message[] => [
  { role: 'user', content: 'first '.repeat(10000), timestamp: 0 },
  { ...answer('First answer', 15000), timestamp: 1 },
  { role: 'user', content: 'old '.repeat(30000), timestamp: 2 },
  { ...answer('Old answer', 30000), timestamp: 2 },
  { role: 'user', content: 'Recent question', timestamp: 3 },
  { ...answer('Recent answer', 20000), timestamp: 4 },
];
type Scenario =
  | 'retry-two'
  | 'retry-exhaust'
  | 'partial'
  | 'after-tool'
  | 'threshold'
  | 'context5000'
  | 'summary-failure'
  | 'stale-overflow'
  | 'overflow-episodes'
  | 'silent-overflow'
  | 'retry-overflow-tail'
  | 'abort-backoff'
  | 'length-recovery';
async function run(kind: 'native' | 'rifty', scenario: Scenario, riftyPrompt = '') {
  const dir = await mkdtemp(join(tmpdir(), 'rifty-continuation-parity-'));
  let conversationPrompt: string | undefined;
  const requests: {
    summary: boolean;
    messages: Context['messages'];
    maxRetries?: number;
  }[] = [];
  const retries: { attempt: number; delayMs: number }[] = [];
  const compactionEvents: unknown[] = [];
  const compactions: {
    reason: string;
    success: boolean;
    tokensBefore?: number;
    tokensAfter?: number;
  }[] = [];
  let switchModel: (() => void | Promise<void>) | undefined;
  let count = 0;
  let effects = 0;
  const stream = (
    _model: Model<'openai-completions'>,
    context: Context,
    options?: SimpleStreamOptions,
  ) => {
    // Pi 1.x carries the prompt as system messages; both sides send one current prompt.
    const system = getCurrentSystemPrompt(context.messages);
    const summary = system.startsWith('You are a context summarization assistant');
    if (!summary) conversationPrompt ??= system;
    requests.push({
      summary,
      messages: structuredClone(context.messages.filter(({ role }) => role !== 'system')),
      maxRetries: options?.maxRetries,
    });
    if (!summary) count++;
    const response = summary ? answer('Saved old context') : answer('Done');
    if (
      (scenario === 'retry-two' && count <= 2) ||
      scenario === 'abort-backoff' ||
      scenario === 'retry-exhaust' ||
      (scenario === 'partial' && count === 1) ||
      (scenario === 'after-tool' && count === 2)
    ) {
      Object.assign(
        response,
        answer(
          scenario === 'partial' ? 'connection reset before headers' : '429 rate limit',
          7,
          'error',
        ),
      );
      if (scenario === 'partial')
        response.content = [
          { type: 'text', text: 'failed partial' },
          { type: 'toolCall', id: 'discard', name: 'effect', arguments: {} },
        ];
    }
    if (
      scenario === 'context5000' ||
      scenario === 'summary-failure' ||
      scenario === 'stale-overflow'
    )
      Object.assign(
        response,
        answer(
          summary ? 'invalid credentials' : 'maximum context length is 5000 tokens',
          10,
          'error',
        ),
      );
    if (scenario === 'retry-overflow-tail' && !summary)
      Object.assign(
        response,
        answer(count === 1 ? '429' : 'maximum context length is 5000 tokens', 10, 'error'),
      );
    if (scenario === 'silent-overflow' && !summary) Object.assign(response, answer('Done', 40000));
    // Pi 1.x: a length stop below the model's output limit gets one compact-and-continue.
    if (scenario === 'length-recovery' && !summary && count === 1)
      Object.assign(response, answer('Truncated', 10, 'length'));
    if (scenario === 'overflow-episodes' && !summary && (count === 1 || count === 3))
      Object.assign(response, answer('maximum context length is 5000 tokens', 10, 'error'));
    if (
      (scenario === 'after-tool' && count === 1) ||
      (scenario === 'overflow-episodes' && !summary && count === 2)
    )
      Object.assign(response, {
        ...answer('', 10, 'toolUse'),
        content: [{ type: 'toolCall', id: 'effect-one', name: 'effect', arguments: {} }],
      });
    const events = createAssistantMessageEventStream();
    queueMicrotask(async () => {
      await new Promise((resolve) => setTimeout(resolve, 2));
      response.timestamp = Date.now();
      if (scenario === 'stale-overflow') await switchModel?.();
      events.push({ type: 'start', partial: response });
      if (scenario === 'partial' && count === 1)
        events.push({
          type: 'text_delta',
          contentIndex: 0,
          delta: 'failed partial',
          partial: response,
        });
      if (response.stopReason === 'error')
        events.push({ type: 'error', reason: 'error', error: response });
      else
        events.push({
          type: 'done',
          reason: response.stopReason as 'stop' | 'toolUse' | 'length',
          message: response,
        });
    });
    return events;
  };
  const provider = createProvider({
    id: model.provider,
    models: [model, { ...model, id: 'large', contextWindow: 1000000 }],
    auth: { apiKey: { name: 'test', resolve: async () => ({ auth: { apiKey: 'test' } }) } },
    api: { stream, streamSimple: stream },
  });
  const tools = [
    {
      name: 'effect',
      label: 'Effect',
      description: 'External effect',
      parameters: Type.Object({}),
      execute: async () => {
        effects++;
        return { content: [{ type: 'text' as const, text: 'settled' }], details: undefined };
      },
    },
  ];
  const initialMessages =
    scenario === 'threshold' || scenario === 'summary-failure'
      ? seed()
      : scenario === 'stale-overflow' ||
          scenario === 'overflow-episodes' ||
          scenario === 'silent-overflow' ||
          scenario === 'retry-overflow-tail' ||
          scenario === 'length-recovery'
        ? seed().map((message) =>
            message.role === 'assistant' ? { ...message, usage: answer('low').usage } : message,
          )
        : [];
  let messages: readonly AgentMessage[];
  try {
    if (kind === 'native') {
      const settingsManager = SettingsManager.inMemory({
        retry: {
          enabled: true,
          maxRetries: 3,
          baseDelayMs: scenario === 'abort-backoff' ? 2000 : 1,
          provider: { maxRetries: 0 },
        },
        compaction: {
          enabled: true,
          reserveTokens: 16384,
          keepRecentTokens:
            scenario === 'overflow-episodes' ? 3 : scenario === 'retry-overflow-tail' ? 30 : 20000,
        },
      });
      const resourceLoader = new DefaultResourceLoader({
        cwd: dir,
        agentDir: dir,
        settingsManager,
        noContextFiles: true,
        noSkills: true,
        noPromptTemplates: true,
        noExtensions: true,
        noThemes: true,
        // Estimates count the system message: the CLI's preamble + <cwd> sections get the
        // same character count as rifty's prompt section (wire prompt bytes are not compared).
        systemPrompt: riftyPrompt.slice(0, riftyPrompt.length - `<cwd>\n${dir}\n</cwd>`.length),
      });
      await resourceLoader.reload();
      const modelRuntime = await ModelRuntime.create({
        modelsPath: null,
        authPath: join(dir, 'auth.json'),
        modelsStorePath: join(dir, 'models-store.json'),
        refreshOnCreate: false,
        allowModelNetwork: false,
      });
      modelRuntime.registerNativeProvider(provider);
      const open = async (sessionManager: SessionManager) =>
        (
          await createNativeSession({
            cwd: dir,
            agentDir: dir,
            settingsManager,
            resourceLoader,
            modelRuntime,
            sessionManager,
            model: modelRuntime.getModel('probe', 'probe'),
            tools: ['effect'],
            customTools: tools,
          })
        ).session;
      // A resumed CLI journal starts with the CLI's own system message, as rifty's history
      // starts with rifty's; a foreign seed would make the CLI append a prompt update.
      const fresh = await open(SessionManager.inMemory(dir));
      const head = fresh.messages[0];
      fresh.dispose();
      const sessionManager = SessionManager.inMemory(dir);
      if (initialMessages.length && head?.role === 'system') sessionManager.appendMessage(head);
      for (const message of initialMessages) sessionManager.appendMessage(message);
      const session = await open(sessionManager);
      switchModel = () => session.setModel(modelRuntime.getModel('probe', 'large')!);
      session.subscribe((event) => {
        if (event.type === 'compaction_end') {
          compactionEvents.push(event);
          compactions.push({
            reason: event.reason,
            success: !!event.result,
            ...(event.result
              ? {
                  tokensBefore: event.result.tokensBefore,
                  tokensAfter: event.result.estimatedTokensAfter,
                }
              : {}),
          });
        }
        if (event.type === 'auto_retry_start' && scenario === 'abort-backoff')
          setTimeout(() => {
            void session.abort();
          }, 0);
        if (event.type === 'auto_retry_start')
          retries.push({ attempt: event.attempt, delayMs: event.delayMs });
      });
      try {
        await session.prompt('continue');
        messages = structuredClone(session.messages);
      } finally {
        session.dispose();
      }
    } else {
      const models = createModels();
      models.setProvider(provider);
      const session = createAgentSession({
        host: { root: dir, capabilities: () => ({}), async close() {} },
        models,
        model: 'probe',
        initialMessages,
        tools,
        retry: { baseDelayMs: scenario === 'abort-backoff' ? 2000 : 1 },
        compaction: {
          keepRecentTokens:
            scenario === 'overflow-episodes' ? 3 : scenario === 'retry-overflow-tail' ? 30 : 20000,
        },
      });
      switchModel = () => session.setModel('large');
      session.subscribe((event) => {
        if (event.type === 'compaction' && event.phase === 'end') {
          compactionEvents.push(event);
          compactions.push({
            reason: event.reason,
            success: !!event.success,
            ...(event.success
              ? { tokensBefore: event.tokensBefore, tokensAfter: event.tokensAfter }
              : {}),
          });
        }
        if (event.type === 'retry' && event.phase === 'start' && scenario === 'abort-backoff')
          setTimeout(() => {
            void session.stop();
          }, 0);
        if (event.type === 'retry' && event.phase === 'start')
          retries.push({ attempt: event.attempt, delayMs: event.delayMs! });
      });
      try {
        await session.send('continue');
        if (scenario === 'retry-overflow-tail') expect(session.status()).toBe('context-exceeded');
        messages = (await session.exportTrace()).transcript;
      } finally {
        await session.dispose();
      }
    }
    const normalized = (value: unknown) =>
      JSON.parse(
        JSON.stringify(value, (key, value) =>
          ['timestamp', 'details', 'durationMs'].includes(key) ? undefined : value,
        ),
      );
    // Prompt bytes differ by design; system message positions must match.
    const placed = (list: readonly AgentMessage[]) =>
      list.map((message) => (message.role === 'system' ? { role: 'system' } : message));
    messages = placed(messages);
    return {
      prompt: conversationPrompt,
      requests: requests.map((r) => ({ ...r, messages: normalized(r.messages) })),
      retries,
      compactions,
      reportedCompactions: eventMetrics(compactionEvents, model.contextWindow, 'done').compactions,
      ...(scenario === 'retry-overflow-tail'
        ? { failure: (compactionEvents.at(-1) as { errorMessage?: string }).errorMessage }
        : {}),
      messages: normalized(messages),
      effects,
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

it.each<Scenario>([
  'retry-two',
  'retry-exhaust',
  'partial',
  'after-tool',
  'threshold',
  'context5000',
  'summary-failure',
  'stale-overflow',
  'overflow-episodes',
  'silent-overflow',
  'retry-overflow-tail',
  'abort-backoff',
  'length-recovery',
])(
  'matches actual Pi CLI 1.6.0: %s',
  async (scenario) => {
    const rifty = await run('rifty', scenario);
    const native = await run('native', scenario, rifty.prompt);
    expect(rifty.reportedCompactions).toBe(
      rifty.compactions.filter((event) => event.success).length,
    );
    expect(native.reportedCompactions).toBe(
      native.compactions.filter((event) => event.success).length,
    );
    expect({ ...rifty, prompt: undefined }).toEqual({ ...native, prompt: undefined });
    if (scenario === 'after-tool' || scenario === 'overflow-episodes')
      expect(rifty.effects).toBe(1);
    if (scenario === 'partial') expect(rifty.effects).toBe(0);
    if (scenario === 'length-recovery')
      expect(rifty.compactions).toEqual([
        expect.objectContaining({ reason: 'overflow', success: true }),
      ]);
  },
  30000,
);
