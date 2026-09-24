import {
  type AssistantMessage,
  type Context,
  createAssistantMessageEventStream,
} from '@earendil-works/pi-ai';
import { describe, expect, it } from 'vitest';
import { type AgentMessage, type AgentSessionOptions, Type, createAgentSession } from './index.ts';

function assistant(
  content: AssistantMessage['content'] = [{ type: 'text', text: 'remembered' }],
): AssistantMessage {
  return {
    role: 'assistant',
    content,
    api: 'openai-completions',
    provider: 'rifty',
    model: 'old-model',
    usage: {
      input: 2,
      output: 3,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 5,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: content.some((block) => block.type === 'toolCall') ? 'toolUse' : 'stop',
    timestamp: 1,
  };
}
const call = () => assistant([{ type: 'toolCall', id: 'old-call', name: 'action', arguments: {} }]);
const result = (): AgentMessage => ({
  role: 'toolResult',
  toolCallId: 'old-call',
  toolName: 'action',
  content: [{ type: 'text', text: 'written' }],
  isError: false,
  timestamp: 2,
});
const history = (): AgentMessage[] => [
  { role: 'user', content: 'remember project', timestamp: 0 },
  call(),
  result(),
  assistant(),
];
function setup(initialMessages: readonly AgentMessage[] = [], replies = [assistant()]) {
  const contexts: Context[] = [];
  let executions = 0;
  let capabilities = 0;
  const options = {
    initialMessages,
    host: {
      root: '/',
      capabilities: () => {
        capabilities++;
        return {};
      },
      async close() {},
    },
    maxToolCalls: 1,
    runTimeoutMs: 1000,
    tools: [
      {
        name: 'action',
        label: 'Action',
        description: 'Consumer action',
        parameters: Type.Object({}),
        async execute() {
          executions++;
          return { content: [{ type: 'text' as const, text: 'new result' }], details: {} };
        },
      },
    ],
    streamFn: (_model: unknown, context: Context) => {
      contexts.push({ ...context, messages: structuredClone(context.messages) });
      const message = replies.shift() ?? assistant();
      const stream = createAssistantMessageEventStream();
      stream.push({ type: 'done', reason: message.stopReason as 'stop' | 'toolUse', message });
      return stream;
    },
  };
  return {
    options,
    contexts,
    executions: () => executions,
    capabilities: () => capabilities,
    create: () => createAgentSession(options as AgentSessionOptions),
  };
}

describe('restored native agent history', () => {
  it('copies history, continues it without replay, traces provenance and resets', async () => {
    const seed = history();
    const expected = structuredClone(seed);
    const run = setup(seed);
    const session = run.create();
    try {
      seed[0] = { role: 'user', content: 'mutated', timestamp: 9 };
      const before = await session.exportTrace();
      expect(before.transcript).toEqual(expected);
      expect(before).toHaveProperty('restoredMessageCount', expected.length);
      expect(before.timings).toEqual([]);
      expect(before.usage.totalTokens).toBe(0);
      expect(before.events.some(({ event }) => event.type === 'agent')).toBe(false);
      await session.send('continue');
      expect(session.status(), session.detail()).toBe('done');
      expect(run.contexts[0]?.messages.slice(0, expected.length)).toEqual(expected);
      expect(run.executions()).toBe(0);
      const trace = await session.exportTrace();
      expect(trace.usage.totalTokens).toBe(5);
      expect(trace.timings).toHaveLength(1);
      expect(trace).toHaveProperty('restoredMessageCount', expected.length);
      session.reset();
      expect(await session.exportTrace()).toMatchObject({
        transcript: [],
        restoredMessageCount: 0,
        timings: [],
        usage: { totalTokens: 0 },
      });
      await session.send('fresh');
      expect(run.contexts[1]?.messages).toEqual([
        expect.objectContaining({ role: 'user', content: [{ type: 'text', text: 'fresh' }] }),
      ]);
    } finally {
      await session.dispose();
    }
  });

  it('isolates nested input mutations and independent sessions', async () => {
    const seed = history();
    const first = setup(seed).create();
    const second = setup(seed).create();
    try {
      const message = seed[1];
      if (message?.role === 'assistant') message.content.length = 0;
      await first.send('first only');
      const trace = await second.exportTrace();
      expect(trace.transcript).toEqual(history());
      expect(trace.timings).toEqual([]);
    } finally {
      await first.dispose();
      await second.dispose();
    }
  });

  it('counts tool calls and elapsed time only in new runs', async () => {
    const run = setup(history(), [call(), assistant(), call(), assistant()]);
    const session = run.create();
    try {
      await session.send('new action');
      expect(session.status(), session.detail()).toBe('done');
      await session.send('another action');
      expect(session.status(), session.detail()).toBe('done');
      expect(run.executions()).toBe(2);
      expect((await session.exportTrace()).transcript.slice(0, 4)).toEqual(history());
    } finally {
      await session.dispose();
    }
  });

  it.each(
    [
      [call()],
      [call(), { role: 'user', content: 'continue', timestamp: 2 }],
      [result()],
      [call(), result(), result()],
      [call(), { ...result(), toolName: 'other' }],
      [{ role: 'system', content: 'invalid role', timestamp: 1 }],
      [{ role: 'user', content: 'missing timestamp' }],
    ].map((seed) => [seed]),
  )('rejects incomplete or malformed history before host work: %j', (seed) => {
    const run = setup(seed as AgentMessage[]);
    expect(run.create).toThrow(/initialMessages/i);
    expect(run.capabilities()).toBe(0);
  });

  it('starts fresh when initialMessages is absent', async () => {
    const run = setup();
    const { initialMessages: _seed, ...options } = run.options;
    const session = createAgentSession(options);
    try {
      expect(await session.exportTrace()).toMatchObject({
        transcript: [],
        restoredMessageCount: 0,
      });
      await session.send('fresh');
      expect(session.status(), session.detail()).toBe('done');
      expect(run.contexts[0]?.messages).toEqual([
        expect.objectContaining({ role: 'user', content: [{ type: 'text', text: 'fresh' }] }),
      ]);
    } finally {
      await session.dispose();
    }
  });

  it('accepts a host-supplied error result and an empty history', async () => {
    for (const seed of [[call(), { ...result(), isError: true }], []]) {
      const run = setup(seed as AgentMessage[]);
      const session = run.create();
      try {
        await session.send('continue');
        expect(session.status(), session.detail()).toBe('done');
        expect(run.contexts[0]?.messages.slice(0, seed.length)).toEqual(seed);
        expect((await session.exportTrace()).transcript.slice(0, seed.length)).toEqual(seed);
        expect(run.executions()).toBe(0);
      } finally {
        await session.dispose();
      }
    }
  });
});
