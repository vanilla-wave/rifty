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

it.each([true, false])(
  'keeps consumer payload private at the artifact boundary without masking ordinary headers (credential: %s)',
  async (credential) => {
    const wire = scriptedProvider([[{ name: 'header_info', args: {} }], 'Done.']);
    const endpoint = catalogEndpoint(
      'https://bench.invalid/v1',
      credential ? { headers: { 'X-Key': 'assistant' } } : {},
    );
    const models = createModels();
    models.setProvider(
      createOpenAIProvider({ id: 'bench', models: [endpoint], fetch: wire.fetch }),
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
            details: {
              headers: { role: 'assistant', type: 'assistant', 'Content-Type': 'text/plain' },
              data: { 'assistant.txt': 'body' },
            },
          }),
        },
      ],
    });
    try {
      await session.send('Inspect headers');
      const trace = await session.exportTrace();
      expect(trace.status).toBe('done');
      const payload = (masked: boolean) => ({
        role: 'toolResult',
        details: {
          headers: {
            role: masked ? '[REDACTED]' : 'assistant',
            type: masked ? '[REDACTED]' : 'assistant',
            'Content-Type': 'text/plain',
          },
          data: { [masked ? '[REDACTED].txt' : 'assistant.txt']: 'body' },
        },
      });
      const toolResult = (value: typeof trace) =>
        value.transcript.find((message) => message.role === 'toolResult');
      // The agent scrubs provider error text only; the bench artifact masks payload.
      expect(toolResult(trace)).toMatchObject(payload(false));
      const artifact = JSON.parse(redactJson(trace, secretValues(endpoint))) as typeof trace;
      expect(toolResult(artifact)).toMatchObject(payload(credential));
    } finally {
      await session.dispose();
    }
  },
);

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
      // Headers are not implicit agent secrets; a private one is declared.
      secrets: [secret],
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

it('redacts payload dictionary keys as well as values, preserving nonsecret bytes', () => {
  const files = { 'HEADER_PATH_SECRET.txt': 'echo HEADER_PATH_SECRET', 'other.txt': 'untouched' };
  expect(JSON.parse(redactJson(files, ['HEADER_PATH_SECRET'], undefined, 'payload'))).toEqual({
    '[REDACTED].txt': 'echo [REDACTED]',
    'other.txt': 'untouched',
  });
});
