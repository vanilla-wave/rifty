import { Type } from '@earendil-works/pi-ai';
import { expect, it } from 'vitest';
import {
  createAgentSession,
  createModels,
  createOpenAIProvider,
} from '../../../packages/agent/src/index.ts';
import { scriptedProvider } from '../../../tests/integration/fixtures/workbench-vite-consumer/src/agent-scripted-provider.ts';
import { catalogEndpoint } from '../tests/catalog-endpoint.ts';
import { redactJson, secretValues } from './config.ts';

it('keeps echoed headers private inside a real consumer tool result', async () => {
  const wire = scriptedProvider([[{ name: 'header_info', args: {} }], 'Done.']);
  const models = createModels();
  models.setProvider(
    createOpenAIProvider({
      id: 'bench',
      models: [catalogEndpoint('https://bench.invalid/v1', { headers: { 'X-Key': 'assistant' } })],
      fetch: wire.fetch,
    }),
  );
  const session = createAgentSession({
    models,
    model: 'scripted',
    host: {
      root: '/',
      capabilities: () => ({}),
      async close() {},
    },
    tools: [
      {
        name: 'header_info',
        label: 'header_info',
        description: 'Return header metadata',
        parameters: Type.Object({}),
        execute: async () => ({
          content: [{ type: 'text', text: 'Headers received' }],
          details: { headers: { role: 'assistant', type: 'assistant' } },
        }),
      },
    ],
  });
  try {
    await session.send('Inspect headers');
    const trace = await session.exportTrace();
    expect(trace.status).toBe('done');
    expect(trace.transcript.find((message) => message.role === 'toolResult')).toMatchObject({
      role: 'toolResult',
      details: { headers: { role: '[redacted]', type: '[redacted]' } },
    });
  } finally {
    await session.dispose();
  }
});

it('redacts header values even when header names and values resemble protocol tags', () => {
  expect(
    JSON.parse(
      redactJson({ headers: { type: 'error', role: 'assistant' } }, ['error', 'assistant']),
    ),
  ).toEqual({ headers: { type: '[REDACTED]', role: '[REDACTED]' } });
});

it.each(['1', '"', '\\', 'error'])(
  'keeps JSON valid and observed fields exact for header %j',
  (secret) => {
    const source = {
      header: { endpoint: { headers: { 'X-Test': secret } } },
      runs: [{ runIndex: 1, inputTokens: 10, agentStatus: 'error', outcome: 'fail' }],
      event: { type: 'message_end', message: { role: 'assistant', stopReason: 'error' } },
      payload: `Provider echoed ${secret}`,
    };
    const secrets = secretValues({
      ...catalogEndpoint('https://bench.invalid/v1'),
      headers: { 'X-Test': secret },
    });

    const observed = JSON.parse(redactJson(source, secrets));
    expect(observed.runs).toEqual(source.runs);
    expect(observed.event).toEqual(source.event);
    expect(observed.header.endpoint.headers['X-Test']).toBe('[REDACTED]');
    expect(observed.payload).toBe('Provider echoed [REDACTED]');
  },
);

it.each(['error', 'assistant', 'agent_end', 'status'])(
  'preserves native trace tags for header %s',
  async (secret) => {
    const models = createModels();
    models.setProvider(
      createOpenAIProvider({
        id: 'bench',
        models: [catalogEndpoint('https://bench.invalid/v1', { headers: { 'X-Tag': secret } })],
        fetch: async () =>
          new Response(JSON.stringify({ error: { message: `Private echo: ${secret}` } }), {
            status: 400,
            headers: { 'content-type': 'application/json' },
          }),
      }),
    );
    const session = createAgentSession({
      models,
      model: 'scripted',
      host: {
        root: '/',
        capabilities: () => ({}),
        async close() {},
      },
    });
    try {
      await session.send('Probe');
      expect(session.status()).toBe('error');
      const trace = await session.exportTrace();
      expect(trace.status).toBe('error');
      const last = trace.transcript.at(-1);
      expect(last).toMatchObject({ role: 'assistant', stopReason: 'error' });
      if (last?.role !== 'assistant') throw new Error('Assistant missing');
      expect(last.errorMessage).toContain('Private echo: [redacted]');
      expect(trace.events.at(-1)?.event).toMatchObject({ type: 'status', status: 'error' });
      expect(
        trace.events.filter(
          ({ event }) => event.type === 'agent' && event.event.type === 'agent_end',
        ),
      ).toHaveLength(1);
      const exported = JSON.parse(redactJson({ agentStatus: trace.status, trace }, [secret]));
      expect(exported.agentStatus).toBe('error');
      expect(exported.trace.status).toBe('error');
      expect(exported.trace.transcript.at(-1).stopReason).toBe('error');
    } finally {
      await session.dispose();
    }
  },
);
