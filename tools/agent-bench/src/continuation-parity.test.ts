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
  | 'length-recovery'
  | 'file-ops'
  | 'length-twice'
  | 'length-tool-stop'
  | 'restored-length-tool'
  | 'resend'
  | 'resend-length';
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
    // Recovery-omission scenarios (review of PR #423): a recovered attempt leaves with its results.
    if (scenario === 'length-tool-stop' && !summary && count === 1)
      Object.assign(response, {
        ...answer('', 10, 'length'),
        content: [{ type: 'toolCall', id: 'cut', name: 'effect', arguments: {} }],
      });
    if (scenario === 'length-tool-stop' && !summary && count === 2)
      Object.assign(response, answer('429 rate limit', 7, 'error'));
    if (scenario === 'resend' && !summary && count <= 3)
      Object.assign(response, answer('maximum context length is 5000 tokens', 10, 'error'));
    if (scenario === 'resend-length' && !summary && count <= 3)
      Object.assign(response, answer('Truncated', 10, 'length'));
    // Pi 1.x: a length stop below the model's output limit gets one compact-and-continue.
    if (
      (scenario === 'length-recovery' && !summary && count === 1) ||
      (scenario === 'length-twice' && !summary)
    )
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
  const lowUsage = (list: Message[]) =>
    list.map((message) =>
      message.role === 'assistant' ? { ...message, usage: answer('low').usage } : message,
    );
  // CLI file-operation extraction keys on its own tool names (read/write/edit).
  const fileOps = (): Message[] => [
    { role: 'user', content: 'Inspect files', timestamp: 0 },
    {
      ...answer('', 10, 'toolUse'),
      content: [
        // Summaries omit thinking (CLI 1.6.0 serializeConversation).
        { type: 'thinking', thinking: 'private reasoning' },
        { type: 'toolCall', id: 'r1', name: 'read', arguments: { path: '/c.ts' } },
        { type: 'toolCall', id: 'r2', name: 'read', arguments: { path: '/a.ts' } },
        { type: 'toolCall', id: 'w1', name: 'write', arguments: { path: '/b.ts' } },
        { type: 'toolCall', id: 'e1', name: 'edit', arguments: { path: '/a.ts' } },
      ],
      timestamp: 0,
    },
    ...['read', 'read', 'write', 'edit'].map((name, index) => ({
      role: 'toolResult' as const,
      toolCallId: ['r1', 'r2', 'w1', 'e1'][index]!,
      toolName: name,
      content: [{ type: 'text' as const, text: 'done' }],
      isError: false,
      timestamp: 0,
    })),
    ...seed(),
  ];
  const initialMessages =
    scenario === 'threshold' || scenario === 'summary-failure'
      ? seed()
      : scenario === 'file-ops'
        ? fileOps()
        : scenario === 'stale-overflow' ||
            scenario === 'overflow-episodes' ||
            scenario === 'silent-overflow' ||
            scenario === 'retry-overflow-tail' ||
            scenario === 'length-recovery' ||
            scenario === 'length-twice' ||
            scenario === 'resend' ||
            scenario === 'resend-length'
          ? lowUsage(seed())
          : scenario === 'restored-length-tool'
            ? [
                ...lowUsage(seed()),
                { role: 'user', content: 'Run the effect', timestamp: 5 },
                {
                  ...answer('', 10, 'length'),
                  content: [{ type: 'toolCall', id: 'effect-one', name: 'effect', arguments: {} }],
                  timestamp: 6,
                },
                {
                  role: 'toolResult',
                  toolCallId: 'effect-one',
                  toolName: 'effect',
                  content: [{ type: 'text', text: 'settled' }],
                  isError: false,
                  timestamp: 7,
                },
              ]
          : [];
  const stopsOnRetry = scenario === 'abort-backoff' || scenario === 'length-tool-stop';
  // A second prompt after the first run settles (stopped or failed recovery).
  const prompts =
    scenario === 'length-tool-stop' || scenario === 'resend' || scenario === 'resend-length'
      ? ['continue', 'again']
      : ['continue'];
  let messages: readonly AgentMessage[];
  try {
    if (kind === 'native') {
      const settingsManager = SettingsManager.inMemory({
        retry: {
          enabled: true,
          maxRetries: 3,
          baseDelayMs: stopsOnRetry ? 2000 : 1,
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
      const sessionManager = SessionManager.inMemory(dir);
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
        if (event.type === 'auto_retry_start' && stopsOnRetry)
          setTimeout(() => {
            void session.abort();
          }, 0);
        if (event.type === 'auto_retry_start')
          retries.push({ attempt: event.attempt, delayMs: event.delayMs });
      });
      try {
        for (const prompt of prompts) await session.prompt(prompt);
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
        retry: { baseDelayMs: stopsOnRetry ? 2000 : 1 },
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
        if (event.type === 'retry' && event.phase === 'start' && stopsOnRetry)
          setTimeout(() => {
            void session.stop();
          }, 0);
        if (event.type === 'retry' && event.phase === 'start')
          retries.push({ attempt: event.attempt, delayMs: event.delayMs! });
      });
      try {
        for (const prompt of prompts) await session.send(prompt);
        if (scenario === 'retry-overflow-tail') expect(session.status()).toBe('context-exceeded');
        messages = (await session.exportTrace()).transcript;
        // The exported history stays restorable (paired calls and results).
        await createAgentSession({
          host: { root: dir, capabilities: () => ({}), async close() {} },
          models,
          model: 'probe',
          tools,
          initialMessages: messages,
        }).dispose();
      } finally {
        await session.dispose();
      }
    }
    const normalized = (value: unknown) =>
      JSON.parse(
        JSON.stringify(value, (key, value) =>
          ['timestamp', 'details', 'durationMs'].includes(key)
            ? undefined
            : // ADR-0475: rifty prefixes failed tool text with its budget receipt line.
              key === 'text' && typeof value === 'string'
              ? value.replace(/^\{"status":"failed","callsLeft":\d+,"msLeft":\d+\}\n/, '')
              : value,
        ),
      );
    // Prompt bytes differ by design; system message positions must match.
    const placed = messages.map((message) =>
      message.role === 'system' ? { role: 'system' } : message,
    );
    return {
      prompt: conversationPrompt,
      requests: requests.map((r) => ({ ...r, messages: normalized(r.messages) })),
      retries,
      compactions,
      reportedCompactions: eventMetrics(compactionEvents, model.contextWindow, 'done').compactions,
      ...(scenario === 'retry-overflow-tail' || scenario === 'length-twice'
        ? { failure: (compactionEvents.at(-1) as { errorMessage?: string }).errorMessage }
        : {}),
      messages: normalized(placed),
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
  'file-ops',
  'length-twice',
  'length-tool-stop',
  'restored-length-tool',
  'resend',
  'resend-length',
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
    if (scenario === 'length-twice')
      expect(rifty).toMatchObject({
        failure: 'Truncated response recovery failed after one compact-and-retry attempt.',
      });
    if (scenario === 'file-ops') {
      expect(JSON.stringify(rifty.requests)).not.toContain('private reasoning');
      expect(JSON.stringify(native.requests)).not.toContain('private reasoning');
    }
    if (scenario === 'file-ops')
      expect(JSON.stringify(rifty.messages)).toContain(
        '<read-files>\\n/c.ts\\n</read-files>\\n\\n<modified-files>\\n/a.ts\\n/b.ts\\n</modified-files>',
      );
    if (scenario === 'length-recovery')
      expect(rifty.compactions).toEqual([
        expect.objectContaining({ reason: 'overflow', success: true }),
      ]);
  },
  30000,
);
