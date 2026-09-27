import { Agent } from '@earendil-works/pi-agent-core';
import { type Model, createModels, createProvider } from '@earendil-works/pi-ai';
import { stream, streamSimple } from '@earendil-works/pi-ai/api/openai-completions';
import { describe, expect, it } from 'vitest';
import { scriptedProvider } from '../../../tests/integration/fixtures/workbench-vite-consumer/src/agent-scripted-provider.ts';
import * as publicApi from './index.ts';
import { createAgentSession } from './session.ts';
import type { AgentSessionOptions } from './types.ts';

const host = { root: '/', capabilities: () => ({}), async close() {} };
function entry(id: string, provider = 'local'): Model<'openai-completions'> {
  return {
    id,
    name: id,
    provider,
    api: 'openai-completions',
    baseUrl: 'https://catalog.invalid/v1',
    contextWindow: 32768,
    maxTokens: 4096,
    reasoning: true,
    input: ['text'],
    cost: { input: 0.1, output: 0.5, cacheRead: 0, cacheWrite: 0 },
    compat: { supportsReasoningEffort: true },
    samplingParams: { top_p: 0.95 },
  };
}

function fixture(replies: Parameters<typeof scriptedProvider>[0]) {
  const wire = scriptedProvider(replies);
  const models = createModels();
  for (const provider of ['local', 'alternate']) {
    models.setProvider(
      createProvider({
        id: provider,
        auth: {
          apiKey: {
            name: 'Test key',
            async resolve() {
              return { auth: { apiKey: 'catalog-secret' } };
            },
          },
        },
        models: [entry(provider === 'local' ? 'small' : 'large', provider)],
        api: {
          stream: (model, context, options) =>
            stream(model as Model<'openai-completions'>, context, {
              ...options,
              fetch: wire.fetch,
            }),
          streamSimple: (model, context, options) =>
            streamSimple(model as Model<'openai-completions'>, context, {
              ...options,
              fetch: wire.fetch,
            }),
        },
      }),
    );
  }
  return { models, wire };
}

describe('embedder model catalog', () => {
  it('uses native model parameters and request defaults exactly as pi', async () => {
    const actual = fixture(['ok']);
    const reference = fixture(['ok']);
    const requestDefaults = { small: { reasoning: 'medium' as const, temperature: 1 } };
    const session = createAgentSession({
      host,
      models: actual.models,
      model: 'small',
      modelOptions: requestDefaults,
    } as unknown as AgentSessionOptions);
    const oracle = new Agent({
      initialState: {
        model: reference.models.getModel('local', 'small')!,
        thinkingLevel: 'medium',
      },
      streamFn: (model, context, options) =>
        reference.models.streamSimple(model, context, {
          ...options,
          ...requestDefaults.small,
          maxRetries: 0,
        }),
    });
    try {
      await session.send('hello');
      await oracle.prompt('hello');
      expect(session.status()).toBe('done');
      for (const field of [
        'model',
        'max_completion_tokens',
        'max_tokens',
        'temperature',
        'top_p',
        'reasoning_effort',
      ]) {
        expect(actual.wire.requests[0]?.body).toHaveProperty('model', 'small');
        expect(
          (actual.wire.requests[0]?.body as unknown as Record<string, unknown>)[field],
        ).toEqual((reference.wire.requests[0]?.body as unknown as Record<string, unknown>)[field]);
      }
      const trace = await session.exportTrace();
      expect(trace.config).toMatchObject({
        model: 'small',
        contextWindow: 32768,
        maxTokens: 4096,
        reasoning: true,
        thinking: 'medium',
        temperature: 1,
        samplingParams: { top_p: 0.95 },
      });
      expect(JSON.stringify(trace)).not.toContain('catalog-secret');
    } finally {
      await session.dispose();
    }
  });

  it('switches during a tool turn and preserves results across provider errors and sends', async () => {
    const f = fixture([
      [{ name: 'switch_model', args: {} }],
      { error: 'capacity exhausted' },
      'continued',
    ]);
    const { Type } = await import('@earendil-works/pi-ai');
    const session = createAgentSession({
      host,
      models: f.models,
      model: 'small',
      tools: [
        {
          name: 'switch_model',
          label: 'Switch',
          description: 'User selected another model',
          parameters: Type.Object({}),
          async execute() {
            (session as typeof session & { setModel(id: string): void }).setModel('large');
            return { content: [{ type: 'text' as const, text: 'prior tool result retained' }] };
          },
        },
      ],
    } as unknown as AgentSessionOptions);
    try {
      await session.send('switch');
      expect(session.status()).toBe('error');
      expect(
        f.wire.requests.map((request) => (request.body as unknown as { model: string }).model),
      ).toEqual(['small', 'large']);
      (session as typeof session & { setModel(id: string): void }).setModel('small');
      await session.send('continue');
      expect(session.status()).toBe('done');
      expect(
        f.wire.requests.map((request) => (request.body as unknown as { model: string }).model),
      ).toEqual(['small', 'large', 'small']);
      expect(JSON.stringify(f.wire.requests[2]?.body.messages)).toContain(
        'prior tool result retained',
      );
      expect(
        (await session.exportTrace()).events.filter(
          ({ event }) => (event.type as string) === 'model',
        ),
      ).toHaveLength(2);
    } finally {
      await session.dispose();
    }
  });

  it('rejects removed forms and invalid selections before reading the host', () => {
    const f = fixture([]);
    let reads = 0;
    const guarded = {
      ...host,
      capabilities() {
        reads++;
        return {};
      },
    };
    for (const options of [
      { settings: { baseUrl: 'https://catalog.invalid/v1', model: 'old' } },
      {
        streamFn: () => {
          throw new Error('must not call');
        },
      },
      { models: f.models, model: 'missing' },
    ])
      expect(() =>
        createAgentSession({ host: guarded, ...options } as unknown as AgentSessionOptions),
      ).toThrow(/catalog|model|models/i);
    expect(reads).toBe(0);
  });

  it('redacts provider credentials echoed in errors and retains effective model metadata', async () => {
    const f = fixture([{ error: 'failed catalog-secret header-secret' }]);
    const factory = (
      publicApi as unknown as {
        createOpenAIProvider(options: {
          id: string;
          models: Model<'openai-completions'>[];
          apiKey?: string;
          fetch?: typeof fetch;
        }): ReturnType<typeof createProvider>;
      }
    ).createOpenAIProvider;
    expect(factory).toBeTypeOf('function');
    f.models.setProvider(
      factory({
        id: 'local',
        models: [{ ...entry('small'), headers: { 'X-Api-Key': 'header-secret' } }],
        apiKey: 'catalog-secret',
        fetch: f.wire.fetch,
      }),
    );
    const session = createAgentSession({
      host,
      models: f.models,
      model: 'small',
    } as unknown as AgentSessionOptions);
    try {
      await session.send('fail');
      expect(session.status()).toBe('error');
      const trace = await session.exportTrace();
      expect(JSON.stringify(trace)).not.toContain('catalog-secret');
      expect(JSON.stringify(trace)).not.toContain('header-secret');
      expect(trace.config).toMatchObject({
        model: 'small',
        provider: 'local',
        contextWindow: 32768,
        maxTokens: 4096,
        thinking: 'off',
      });
    } finally {
      await session.dispose();
    }
  });
});
