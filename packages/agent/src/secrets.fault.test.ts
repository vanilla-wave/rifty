import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type { AssistantMessage } from '@earendil-works/pi-ai';
import { describe, expect, it } from 'vitest';
import { scriptedProvider } from '../../../tests/integration/fixtures/workbench-vite-consumer/src/agent-scripted-provider.ts';
import {
  type AgentSessionEvent,
  type AgentSessionOptions,
  type Models,
  type OpenAIModel,
  Type,
  createAgentSession,
  createModels,
  createOpenAIProvider,
} from './index.ts';

const KEY = 'sk-ingress-key-7f3a';
const DECLARED = 'declared-private-token';
// pi formats HTTP error bodies as `<status>: <JSON>`: this key arrives JSON-escaped.
const LATE_KEY = 'sk-late-"quoted"-\\key';
const host = { root: '/', capabilities: () => ({}), async close() {} };

function entry(id: string, provider: string, headers?: Record<string, string>): OpenAIModel {
  return {
    id,
    name: id,
    provider,
    api: 'openai-completions',
    baseUrl: 'https://secrets.invalid/v1',
    contextWindow: 32768,
    maxTokens: 4096,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    ...(headers ? { headers } : {}),
  };
}

function setup(
  replies: Parameters<typeof scriptedProvider>[0],
  overrides: Partial<AgentSessionOptions> = {},
  wrap: (models: Models) => Models = (models) => models,
) {
  const wire = scriptedProvider(replies);
  const models = createModels();
  models.setProvider(
    createOpenAIProvider({
      id: 'local',
      apiKey: KEY,
      fetch: wire.fetch,
      // Undeclared header colliding with a tool name: not a secret.
      models: [entry('small', 'local', { 'X-Edit': 'edit_file' })],
    }),
  );
  const session = createAgentSession({
    host,
    models: wrap(models),
    model: 'small',
    retry: { baseDelayMs: 1 },
    secrets: [DECLARED, ''],
    tools: [
      {
        name: 'edit_file',
        label: 'edit_file',
        description: 'Consumer tool sharing the header value',
        parameters: Type.Object({}),
        async execute() {
          return { content: [{ type: 'text' as const, text: 'edit_file ran' }], details: {} };
        },
      },
    ],
    ...overrides,
  } as AgentSessionOptions);
  const events: AgentSessionEvent[] = [];
  session.subscribe((event) => events.push(structuredClone(event)));
  return { session, events, models, wire };
}

// Raw occurrences of each secret, found through their serialized form.
const leaks = (value: unknown, secrets: readonly string[] = [KEY, DECLARED]) =>
  secrets.filter((secret) => JSON.stringify(value).includes(JSON.stringify(secret).slice(1, -1)));
// Streamed deltas are documented as unscrubbed; the final message_end replaces them.
const settled = (events: readonly AgentSessionEvent[]) =>
  events.filter((event) => !(event.type === 'agent' && event.event.type === 'message_update'));
const messageEnds = (events: readonly AgentSessionEvent[]) =>
  events.flatMap((event) =>
    event.type === 'agent' && event.event.type === 'message_end' ? [event.event.message] : [],
  );
// Everything but model-visible `content`, which ingress never alters.
const outsideContent = (value: unknown): unknown =>
  JSON.parse(JSON.stringify(value, (key, entry) => (key === 'content' ? undefined : entry)));
// Restored history over the default compaction threshold: the next send summarizes first.
function compactableHistory(): AgentMessage[] {
  const answer = (text: string, input: number, timestamp: number): AgentMessage => ({
    role: 'assistant',
    model: 'small',
    provider: 'local',
    api: 'openai-completions',
    content: [{ type: 'text', text }],
    stopReason: 'stop',
    timestamp,
    usage: {
      input,
      output: 2,
      totalTokens: input + 2,
      cacheRead: 0,
      cacheWrite: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
  });
  return [
    { role: 'user', content: 'first '.repeat(10000), timestamp: 0 },
    answer('First answer', 15000, 1),
    { role: 'user', content: 'old '.repeat(30000), timestamp: 2 },
    answer('Old answer', 30000, 2),
    { role: 'user', content: 'Recent question', timestamp: 3 },
    answer('Recent answer', 20000, 4),
  ];
}

describe('provider ingress scrubbing', () => {
  it('[fault: corrupt-input] rejects secrets that are not an array of strings', () => {
    for (const secrets of [[1], 'key', [null]])
      expect(() => setup([], { secrets } as unknown as Partial<AgentSessionOptions>)).toThrow(
        'secrets must be an array of strings',
      );
  });

  it('[fault: sibling-drift] provider error echoes never reach history, status, retry or trace', async () => {
    const { session, events } = setup([
      { error: `rate limit reached for ${KEY} and ${DECLARED}`, status: 429 },
      `Recovered. Key ${KEY}, token ${DECLARED}.`,
      { error: `invalid request from ${KEY} with ${DECLARED}`, status: 400 },
    ]);
    try {
      await session.send('first');
      expect(session.status()).toBe('done');
      const retries = events.filter((event) => event.type === 'retry');
      expect(retries.map((event) => event.phase)).toEqual(['start', 'end']);
      expect(leaks(retries)).toEqual([]);
      expect(JSON.stringify(retries)).toContain('rate limit reached for [redacted] and [redacted]');

      await session.send('second');
      expect(session.status()).toBe('error');
      expect(session.detail()).toContain('invalid request from [redacted] with [redacted]');
      expect(leaks(session.detail())).toEqual([]);
      const status = events.filter((event) => event.type === 'status').at(-1);
      expect(status).toMatchObject({ status: 'error', detail: session.detail() });
      const failure = messageEnds(events).at(-1) as AssistantMessage;
      expect(failure.errorMessage).toContain('invalid request from [redacted] with [redacted]');

      // The successful reply's raw echo lives only in `content` (next test).
      expect(leaks(outsideContent(settled(events)))).toEqual([]);
      const { events: traced, ...trace } = await session.exportTrace();
      expect(leaks(outsideContent(trace))).toEqual([]);
      expect(leaks(outsideContent(settled(traced.map(({ event }) => event))))).toEqual([]);
    } finally {
      await session.dispose();
    }
  });

  it('a successful reply echoing a secret stays raw in history and trace', async () => {
    const text = `Recovered. Key ${KEY}, token ${DECLARED}.`;
    const { session, events } = setup([text]);
    try {
      await session.send('first');
      expect(session.status()).toBe('done');
      // Model context fidelity: pi sends assistant text back on later turns, so masking it
      // would rewrite ordinary text equal to a short key (`lm-studio`, `test`, `1`).
      expect(messageEnds(events).at(-1)).toMatchObject({ content: [{ type: 'text', text }] });
      const trace = await session.exportTrace();
      expect(trace.transcript.at(-1)).toMatchObject({ content: [{ type: 'text', text }] });
      expect(JSON.stringify(trace)).not.toContain('[redacted]');
    } finally {
      await session.dispose();
    }
  });

  it('[fault: sibling-drift] a thrown provider exception naming a key reaches status scrubbed', async () => {
    // pi's catalog turns provider failures into error messages; a consumer Models may throw.
    const { session, events } = setup(
      [],
      {},
      (models) =>
        new Proxy(models, {
          get(target, property) {
            if (property === 'streamSimple')
              return () => {
                throw new TypeError(`fetch failed for key ${KEY} and ${DECLARED}`);
              };
            const value: unknown = Reflect.get(target, property, target);
            return typeof value === 'function' ? value.bind(target) : value;
          },
        }),
    );
    try {
      await session.send('probe');
      expect(session.status()).toBe('error');
      expect(session.detail()).toBe('fetch failed for key [redacted] and [redacted]');
      const status = events.filter((event) => event.type === 'status').at(-1);
      expect(status).toMatchObject({ status: 'error', detail: session.detail() });
      expect(leaks(settled(events))).toEqual([]);
      expect(leaks(await session.exportTrace())).toEqual([]);
    } finally {
      await session.dispose();
    }
  });

  it('undeclared header values stay verbatim, including tool names', async () => {
    const { session, events } = setup([[{ name: 'edit_file', args: {} }], 'Used edit_file.']);
    try {
      await session.send('edit');
      expect(session.status()).toBe('done');
      const trace = await session.exportTrace();
      const result = trace.transcript.find((message) => message.role === 'toolResult');
      expect(result).toMatchObject({ toolName: 'edit_file', isError: false });
      expect(trace.transcript.at(-1)).toMatchObject({
        content: [{ type: 'text', text: 'Used edit_file.' }],
      });
      expect(
        trace.events.flatMap(({ event }) =>
          event.type === 'agent' && event.event.type === 'tool_execution_end'
            ? [event.event.toolName]
            : [],
        ),
      ).toEqual(['edit_file']);
      expect(JSON.stringify(trace)).not.toContain('[redacted]');
      expect(JSON.stringify(events)).not.toContain('[redacted]');
    } finally {
      await session.dispose();
    }
  });

  it('overlapping declared secrets mask longest first, leaving no suffix', async () => {
    const { session, events } = setup([{ error: 'denied sk-key-extended', status: 400 }], {
      secrets: ['sk-key', 'sk-key-extended'],
    });
    try {
      await session.send('probe');
      const failure = messageEnds(events).at(-1) as AssistantMessage;
      expect(failure.errorMessage?.match(/\[redacted\]|-extended/g)).toEqual(['[redacted]']);
    } finally {
      await session.dispose();
    }
  });

  it('[fault: sibling-drift] built-in providers registered after creation are scrubbed too', async () => {
    const { session, events, models } = setup([]);
    const late = scriptedProvider([{ error: `denied ${LATE_KEY}`, status: 400 }]);
    models.setProvider(
      createOpenAIProvider({
        id: 'late',
        apiKey: LATE_KEY,
        fetch: late.fetch,
        models: [entry('late-model', 'late')],
      }),
    );
    try {
      session.setModel('late-model');
      await session.send('probe');
      expect(late.requests[0]?.authorization).toBe(`Bearer ${LATE_KEY}`);
      expect(session.status()).toBe('error');
      expect(session.detail()).toContain('denied [redacted]');
      const escaped = JSON.stringify(LATE_KEY).slice(1, -1);
      expect(leaks(settled(events), [LATE_KEY, escaped])).toEqual([]);
    } finally {
      await session.dispose();
    }
  });

  it('[fault: sibling-drift] compaction summary failure echoing a secret is scrubbed', async () => {
    const { session, events, wire } = setup(
      [{ error: `summary refused for ${DECLARED} ${KEY}`, status: 400 }, 'Done.'],
      { initialMessages: compactableHistory() },
    );
    try {
      await session.send('continue');
      expect(wire.requests).toHaveLength(2);
      const end = events.find((event) => event.type === 'compaction' && event.phase === 'end');
      expect(end).toMatchObject({ success: false });
      expect(end?.type === 'compaction' && end.errorMessage).toContain(
        'summary refused for [redacted] [redacted]',
      );
      expect(leaks(settled(events))).toEqual([]);
    } finally {
      await session.dispose();
    }
  });

  it('[fault: sibling-drift] a thrown compaction summary exception naming a key is scrubbed', async () => {
    // Summary request throws (consumer Models); the main request still answers.
    const { session, events, wire } = setup(
      ['Done.'],
      { initialMessages: compactableHistory() },
      (models) =>
        new Proxy(models, {
          get(target, property) {
            if (property === 'completeSimple')
              return () => {
                throw new Error(`summary backend down for ${KEY} and ${DECLARED}`);
              };
            const value: unknown = Reflect.get(target, property, target);
            return typeof value === 'function' ? value.bind(target) : value;
          },
        }),
    );
    try {
      await session.send('continue');
      expect(session.status()).toBe('done');
      expect(wire.requests).toHaveLength(1);
      const end = events.find((event) => event.type === 'compaction' && event.phase === 'end');
      expect(end).toMatchObject({
        success: false,
        errorMessage: 'summary backend down for [redacted] and [redacted]',
      });
      const surfaced = events.filter((event) =>
        ['retry', 'compaction', 'status'].includes(event.type),
      );
      expect(leaks(surfaced)).toEqual([]);
      expect(leaks(session.detail() ?? '')).toEqual([]);
      expect(leaks(await session.exportTrace())).toEqual([]);
    } finally {
      await session.dispose();
    }
  });

  it('[fault: sibling-drift] a retried compaction summary error echoing a secret is scrubbed', async () => {
    // Retryable: the error reaches only `retry` events, never compaction's own errorMessage.
    const { session, events, wire } = setup(
      [
        { error: `429 rate limit for ${KEY} and ${DECLARED}`, status: 429 },
        'Saved context',
        'Done.',
      ],
      { initialMessages: compactableHistory() },
    );
    try {
      await session.send('continue');
      expect(session.status()).toBe('done');
      expect(wire.requests).toHaveLength(3);
      const retries = events.filter((event) => event.type === 'retry');
      expect(retries).toMatchObject([
        { phase: 'start', source: 'summary' },
        { phase: 'end', source: 'summary', success: true },
      ]);
      expect(JSON.stringify(retries)).toContain('429 rate limit for [redacted] and [redacted]');
      const end = events.find((event) => event.type === 'compaction' && event.phase === 'end');
      expect(end).toMatchObject({ success: true });
      expect(leaks(settled(events))).toEqual([]);
      expect(leaks(session.detail() ?? '')).toEqual([]);
      expect(leaks(await session.exportTrace())).toEqual([]);
    } finally {
      await session.dispose();
    }
  });
});
