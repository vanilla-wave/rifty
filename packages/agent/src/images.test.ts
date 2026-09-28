import { Agent } from '@earendil-works/pi-agent-core';
import { expect, it } from 'vitest';
import { scriptedProvider } from '../../../tests/integration/fixtures/workbench-vite-consumer/src/agent-scripted-provider.ts';
import {
  type AgentSession,
  type ImageContent,
  createAgentSession,
  createModels,
  createOpenAIProvider,
} from './index.ts';

const png: ImageContent = {
  type: 'image',
  mimeType: 'image/png',
  data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a4H8AAAAASUVORK5CYII=',
};
function setup(vision = true) {
  const wire = scriptedProvider(['Seen.']);
  const models = createModels();
  models.setProvider(
    createOpenAIProvider({
      id: 'local',
      fetch: wire.fetch,
      models: [
        {
          id: vision ? 'vision' : 'text-only',
          name: 'Test',
          provider: 'local',
          api: 'openai-completions',
          baseUrl: 'https://images.invalid/v1',
          contextWindow: 32768,
          maxTokens: 4096,
          input: vision ? ['text', 'image'] : ['text'],
          reasoning: false,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        },
      ],
    }),
  );
  const model = models.getModels()[0]!;
  return { models, model, wire };
}
const host = { root: '/', capabilities: () => ({}), async close() {} };
function send(session: AgentSession, prompt: string, images: unknown) {
  return (session.send as (prompt: string, images?: unknown) => Promise<void>)(prompt, images);
}

it.each(['Inspect this image.', ''])('image prompt matches native pi: %j', async (prompt) => {
  const actual = setup();
  const reference = setup();
  const session = createAgentSession({ host, models: actual.models, model: actual.model.id });
  const oracle = new Agent({
    initialState: { model: reference.model },
    streamFn: (model, context, options) => reference.models.streamSimple(model, context, options),
  });
  try {
    await oracle.prompt(prompt, [png]);
    await send(session, prompt, [png]);
    expect(session.status()).toBe('done');
    const user = (wire: typeof actual.wire) =>
      wire.requests[0]?.body.messages.find((message) => message.role === 'user');
    expect(user(actual.wire)).toEqual(user(reference.wire));
    expect(JSON.stringify(user(actual.wire))).toContain(`data:image/png;base64,${png.data}`);
    expect((await session.exportTrace()).transcript[0]).toMatchObject({
      role: 'user',
      content: expect.arrayContaining([png]),
    });
  } finally {
    await session.dispose();
  }
});

it('rejects images for a text-only entry before dispatch, naming that entry', async () => {
  const f = setup(false);
  const session = createAgentSession({ host, models: f.models, model: f.model.id });
  try {
    await expect(send(session, 'look', [png])).rejects.toThrow(/text-only/);
    expect(f.wire.requests).toHaveLength(0);
    expect(session.status()).toBe('idle');
  } finally {
    await session.dispose();
  }
});

it.each(
  [
    [{ type: 'file', mimeType: 'application/pdf', data: 'JVBERg==' }],
    [{ type: 'image', mimeType: 'application/pdf', data: 'JVBERg==' }],
    new Uint8Array([0, 255, 1]),
  ].map((binary) => ({ binary })),
)('non-image binary input fails loudly: %j', async ({ binary }) => {
  const f = setup();
  const session = createAgentSession({ host, models: f.models, model: f.model.id });
  try {
    await expect(send(session, 'look', binary)).rejects.toThrow('agent.prompt-binary-input');
    expect(f.wire.requests).toHaveLength(0);
  } finally {
    await session.dispose();
  }
});
