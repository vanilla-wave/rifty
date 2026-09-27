import type { AgentMessage } from '@earendil-works/pi-agent-core';
import {
  type AssistantMessage,
  type Context,
  type Model,
  type SimpleStreamOptions,
  Type,
  createAssistantMessageEventStream,
  createModels,
  createProvider,
} from '@earendil-works/pi-ai';
import { describe, expect, it } from 'vitest';
import { createAgentSession } from './session.ts';
import type { AgentSessionOptions } from './types.ts';

const host = { root: '/', capabilities: () => ({}), async close() {} };
const model: Model<'openai-completions'> = {
  id: 'small',
  name: 'small',
  provider: 'test',
  api: 'openai-completions',
  baseUrl: 'https://continuation.invalid',
  contextWindow: 32000,
  maxTokens: 8192,
  input: ['text'],
  reasoning: false,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
};
function answer(
  text = 'ok',
  input = 10,
  stopReason: AssistantMessage['stopReason'] = 'stop',
): AssistantMessage {
  return {
    role: 'assistant',
    model: model.id,
    provider: model.provider,
    api: model.api,
    content: [{ type: 'text', text }],
    stopReason,
    timestamp: Date.now(),
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
function history(): AgentMessage[] {
  return [
    { role: 'user', content: 'first '.repeat(10000), timestamp: 0 },
    { ...answer('First answer', 15000), timestamp: 1 },
    { role: 'user', content: 'old '.repeat(30000), timestamp: 2 },
    { ...answer('Old answer', 30000), timestamp: 2 },
    { role: 'user', content: 'Recent question', timestamp: 3 },
    { ...answer('Recent answer', 20000), timestamp: 4 },
  ];
}
type Reply = (
  context: Context,
  options: SimpleStreamOptions,
  count: number,
) => AssistantMessage | Promise<AssistantMessage>;
function fixture(
  reply: Reply,
  overrides: Partial<AgentSessionOptions> & {
    retry?: { enabled?: boolean; maxRetries?: number; baseDelayMs?: number };
    compaction?: { enabled?: boolean; reserveTokens?: number; keepRecentTokens?: number };
  } = {},
) {
  const requests: { context: Context; options: SimpleStreamOptions; model: string }[] = [];
  const models = createModels();
  models.setProvider(
    createProvider({
      id: 'test',
      models: [model, { ...model, id: 'large', contextWindow: 1000000 }],
      auth: { apiKey: { name: 'test', resolve: async () => ({ auth: { apiKey: 'test' } }) } },
      api: {
        stream: () => {
          throw new Error('Unexpected generic stream');
        },
        streamSimple: (selected, context, options) => {
          requests.push({
            context: structuredClone(context),
            options: { ...options },
            model: selected.id,
          });
          const stream = createAssistantMessageEventStream();
          void Promise.resolve().then(async () => {
            const response = await reply(context, options ?? {}, requests.length);
            stream.push({ type: 'start', partial: response });
            stream.push(
              response.stopReason === 'error' || response.stopReason === 'aborted'
                ? { type: 'error', reason: response.stopReason, error: response }
                : {
                    type: 'done',
                    reason: response.stopReason as 'stop' | 'length' | 'toolUse',
                    message: response,
                  },
            );
          });
          return stream;
        },
      },
    }),
  );
  const session = createAgentSession({
    host,
    models,
    model: 'small',
    ...overrides,
  } as AgentSessionOptions);
  return { session, requests };
}
const summaryRequest = (context: Context) =>
  context.systemPrompt?.startsWith('You are a context summarization assistant');

describe('native continuation boundary', () => {
  it.each([2, 4])(
    '[fault: unbounded-read] retries 429 with native bounded exponential policy (%s failures)',
    async (failures) => {
      const { session, requests } = fixture(
        (_c, _o, n) => (n <= failures ? answer('429 rate limit', 7, 'error') : answer()),
        { retry: { baseDelayMs: 1 } },
      );
      try {
        await session.send('continue');
        expect(requests).toHaveLength(Math.min(failures + 1, 4));
        const trace = await session.exportTrace();
        const retries = trace.events
          .map(({ event }) => event)
          .filter((e) => (e.type as string) === 'retry');
        expect(
          retries.filter((e) => (e as unknown as { phase: string }).phase === 'start'),
        ).toMatchObject(
          Array.from({ length: Math.min(failures, 3) }, (_, n) => ({
            attempt: n + 1,
            delayMs: 2 ** n,
          })),
        );
        expect(trace.transcript.filter((m) => m.role === 'assistant')).toHaveLength(1);
        expect(trace.usage.totalTokens).toBe(Math.min(failures, 4) * 9 + (failures < 4 ? 12 : 0));
        expect(requests.every((r) => r.options.maxRetries === 0)).toBe(true);
        expect(session.status()).toBe(failures < 4 ? 'done' : 'error');
      } finally {
        await session.dispose();
      }
    },
  );
  it('[fault: observable-order] native overflow classification takes priority over retry substring 500', async () => {
    const { session, requests } = fixture(
      () => answer('maximum context length is 5000 tokens', 10, 'error'),
      { retry: { baseDelayMs: 1 } },
    );
    try {
      await session.send('continue');
      expect(requests).toHaveLength(1);
      expect(session.status()).toBe('context-exceeded');
    } finally {
      await session.dispose();
    }
  });
  it('supports retry off and does not retry quota errors', async () => {
    for (const [error, retry] of [
      ['429 rate limit', { enabled: false }],
      ['insufficient_quota', { baseDelayMs: 1 }],
    ] as const) {
      const { session, requests } = fixture(() => answer(error, 10, 'error'), { retry });
      try {
        await session.send('continue');
        expect(requests).toHaveLength(1);
        expect(session.status()).toBe('error');
      } finally {
        await session.dispose();
      }
    }
  });
  it('next retry request reads the selected model and defaults', async () => {
    const { session, requests } = fixture(
      (_c, _o, n) => (n === 1 ? answer('429', 10, 'error') : answer()),
      {
        retry: { baseDelayMs: 1 },
        modelOptions: { small: { temperature: 0.1 }, large: { temperature: 0.7 } },
      },
    );
    session.subscribe((e) => {
      if ((e.type as string) === 'retry') session.setModel('large');
    });
    try {
      await session.send('continue');
      expect(requests.map((r) => [r.model, r.options.temperature])).toEqual([
        ['small', 0.1],
        ['large', 0.7],
      ]);
    } finally {
      await session.dispose();
    }
  });
  it('[fault: torn-state] default backoff is abortable', async () => {
    const stopped = fixture(() => answer('429', 10, 'error'));
    let delay = 0;
    stopped.session.subscribe((e) => {
      if ((e.type as string) === 'retry') {
        delay = (e as unknown as { delayMs: number }).delayMs || delay;
        void stopped.session.stop();
      }
    });
    try {
      await stopped.session.send('continue');
      expect(delay).toBe(2000);
      expect(stopped.requests).toHaveLength(1);
      expect(stopped.session.status()).toBe('aborted');
    } finally {
      await stopped.session.dispose();
    }
  });
  it('[fault: torn-state] retries after a completed tool without replaying its effect', async () => {
    let effects = 0;
    const { session, requests } = fixture(
      (_c, _o, n) => {
        if (n === 1)
          return {
            ...answer('', 10, 'toolUse'),
            content: [{ type: 'toolCall', id: 'one', name: 'effect', arguments: {} }],
          };
        return n === 2 ? answer('503', 10, 'error') : answer();
      },
      {
        retry: { baseDelayMs: 1 },
        tools: [
          {
            name: 'effect',
            label: 'Effect',
            description: 'External effect',
            parameters: Type.Object({}),
            async execute() {
              effects++;
              return { content: [{ type: 'text', text: 'effect settled' }], details: undefined };
            },
          },
        ],
      },
    );
    try {
      await session.send('do work');
      expect(session.status()).toBe('done');
      expect(effects).toBe(1);
      expect(requests).toHaveLength(3);
      expect(requests[2]?.context.messages).toEqual(requests[1]?.context.messages);
    } finally {
      await session.dispose();
    }
  });
  it('compacts restored history with native defaults; summary survives JSON restore and model switch', async () => {
    const { session, requests } = fixture(
      (c) => answer(summaryRequest(c) ? 'Saved old context' : 'Done'),
      { initialMessages: history() },
    );
    try {
      await session.send('continue');
      expect(requests.map((r) => summaryRequest(r.context))).toEqual([true, false]);
      const trace = await session.exportTrace();
      expect(trace.transcript[0]).toMatchObject({
        role: 'compactionSummary',
        summary: 'Saved old context',
      });
      expect(JSON.stringify(requests[1]?.context.messages)).toContain('Saved old context');
      expect(trace.restoredMessageCount).toBe(6);
      expect(trace.usage.totalTokens).toBe(24);
      expect(trace.config).toMatchObject({
        compaction: { enabled: true, reserveTokens: 16384, keepRecentTokens: 20000 },
      });
      const resumed = fixture(() => answer(), {
        model: 'large',
        initialMessages: JSON.parse(JSON.stringify(trace.transcript)),
      });
      try {
        await resumed.session.send('next');
        expect(JSON.stringify(resumed.requests[0]?.context.messages)).toContain(
          'Saved old context',
        );
        expect((await resumed.session.exportTrace()).usage.totalTokens).toBe(12);
        resumed.session.reset();
        expect((await resumed.session.exportTrace()).usage.totalTokens).toBe(0);
      } finally {
        await resumed.session.dispose();
      }
    } finally {
      await session.dispose();
    }
  });
  it('[fault: provenance-lie] native no-usage estimate is marked in the compaction event', async () => {
    const zero = answer().usage;
    zero.input = 0;
    zero.output = 0;
    zero.totalTokens = 0;
    const seed = history().map((m) => (m.role === 'assistant' ? { ...m, usage: zero } : m));
    const { session } = fixture((c) => answer(summaryRequest(c) ? 'Saved context' : 'Done'), {
      initialMessages: seed,
    });
    try {
      await session.send('continue');
      const ends = (await session.exportTrace()).events
        .map(({ event }) => event)
        .filter(
          (e) =>
            (e.type as string) === 'compaction' &&
            (e as unknown as { phase: string }).phase === 'end',
        );
      expect(ends[0]).toMatchObject({
        reason: 'threshold',
        success: true,
        source: 'estimate',
        tokensBefore: expect.any(Number),
        tokensAfter: expect.any(Number),
      });
    } finally {
      await session.dispose();
    }
  });
  it('compaction can be disabled without pruning history', async () => {
    const { session, requests } = fixture(() => answer(), {
      initialMessages: history(),
      compaction: { enabled: false },
    });
    try {
      await session.send('continue');
      expect(requests).toHaveLength(1);
      expect((await session.exportTrace()).transcript).toHaveLength(8);
    } finally {
      await session.dispose();
    }
  });
  it('[fault: torn-state] summary failure leaves history; overflow gets one separate native recovery attempt', async () => {
    const { session, requests } = fixture(
      (c) =>
        answer(
          summaryRequest(c) ? 'invalid credentials' : 'maximum context length is 5000 tokens',
          10,
          'error',
        ),
      { initialMessages: history() },
    );
    try {
      await session.send('continue');
      expect(requests.map((r) => summaryRequest(r.context))).toEqual([true, false, true]);
      expect(session.status()).toBe('context-exceeded');
      expect((await session.exportTrace()).transcript.slice(0, 6)).toEqual(history());
    } finally {
      await session.dispose();
    }
  });
  it('[fault: unbounded-read] overflow recovery compacts once and preserves completed history', async () => {
    const lowUsage = history().map((m) =>
      m.role === 'assistant' ? { ...m, usage: answer().usage } : m,
    );
    const { session, requests } = fixture(
      (c) =>
        summaryRequest(c)
          ? answer('Saved old context')
          : answer('maximum context length is 5000 tokens', 10, 'error'),
      { initialMessages: lowUsage },
    );
    try {
      await session.send('continue');
      expect(requests.map((r) => summaryRequest(r.context))).toEqual([false, true, false]);
      expect(session.status()).toBe('context-exceeded');
      expect((await session.exportTrace()).transcript[0]?.role).toBe('compactionSummary');
    } finally {
      await session.dispose();
    }
  });
  it('[fault: torn-state] stop during summary installs no partial summary or later request', async () => {
    let entered!: () => void;
    const started = new Promise<void>((r) => {
      entered = r;
    });
    const { session, requests } = fixture(
      async (_c, options) => {
        entered();
        await new Promise<void>((resolve) =>
          options.signal?.addEventListener('abort', () => resolve(), { once: true }),
        );
        return answer('partial summary', 10, 'aborted');
      },
      { initialMessages: history() },
    );
    try {
      const run = session.send('continue');
      await started;
      await session.stop();
      await run;
      expect(session.status()).toBe('aborted');
      expect(requests).toHaveLength(1);
      expect(summaryRequest(requests[0]!.context)).toBe(true);
      expect(
        (await session.exportTrace()).transcript.some((m) => m.role === 'compactionSummary'),
      ).toBe(false);
    } finally {
      await session.dispose();
    }
  });
});
