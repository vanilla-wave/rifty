import { expect, it } from 'vitest';
import { scriptedProvider } from '../../../tests/integration/fixtures/workbench-vite-consumer/src/agent-scripted-provider.ts';
import { MemoryVfs } from '../../vfs/src/index.ts';
import {
  type AgentMessage,
  createAgentSession,
  createModels,
  createOpenAIProvider,
} from './index.ts';

function setup(textOnlyContent: boolean, initialMessages?: readonly AgentMessage[]) {
  const wire = scriptedProvider([
    [{ name: 'read_file', args: { path: 'hello.txt' } }],
    'Read.',
    'Switched.',
    'Returned.',
  ]);
  const rejected: unknown[] = [];
  const models = createModels();
  const entry = (id: string, flag: boolean) => ({
    id,
    name: id,
    provider: 'local',
    api: 'openai-completions' as const,
    baseUrl: 'https://text-only.invalid/v1',
    contextWindow: 32768,
    maxTokens: 4096,
    input: ['text', 'image'] as ('text' | 'image')[],
    textOnlyContent: flag,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  });
  const transport: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    const body = (await request.clone().json()) as {
      model: string;
      messages: { content: unknown }[];
    };
    if (
      body.model === 'strict' &&
      body.messages.some((message) => typeof message.content !== 'string')
    ) {
      rejected.push(body);
      return Response.json(
        { error: { message: 'All message content must be strings' } },
        { status: 400 },
      );
    }
    return wire.fetch(request);
  };
  models.setProvider(
    createOpenAIProvider({
      id: 'local',
      fetch: transport,
      models: [entry('strict', textOnlyContent), entry('ordinary', false)],
    }),
  );
  const vfs = new MemoryVfs();
  const session = createAgentSession({
    models,
    model: 'strict',
    contextFiles: false,
    skills: false,
    initialMessages,
    host: {
      root: '/',
      async close() {},
      capabilities: () => ({
        files: {
          read: (path: string) => vfs.readFileText(path),
          list: async (path: string) =>
            (await vfs.readdir(path)).map((e) => ({
              path: `/${e.name}`,
              kind: e.isDirectory ? ('dir' as const) : ('file' as const),
            })),
          async change(path: string, transform: (current: string | null) => string | null) {
            const value = transform((await vfs.exists(path)) ? await vfs.readFileText(path) : null);
            if (value === null) await vfs.rm(path);
            else await vfs.writeFile(path, value);
          },
        },
      }),
    },
  });
  return { wire, rejected, vfs, session };
}

it('flagged catalog entry completes tools and switches with string-only content and retained history', async () => {
  const f = setup(true);
  await f.vfs.writeFile('/hello.txt', 'real file bytes');
  try {
    await f.session.send('Read hello.txt');
    expect(f.session.status()).toBe('done');
    expect(f.rejected).toEqual([]);
    expect(f.wire.requests[1]?.body.messages.find((m) => m.role === 'tool')?.content).toContain(
      'real file bytes',
    );
    f.session.setModel('ordinary');
    await f.session.send('Switch');
    expect(f.session.status()).toBe('done');
    expect(f.wire.requests[2]?.body.messages.some((m) => Array.isArray(m.content))).toBe(true);
    f.session.setModel('strict');
    await f.session.send('Return');
    expect(f.session.status()).toBe('done');
    for (const index of [0, 1, 3])
      expect(
        f.wire.requests[index]?.body.messages.every((m) => typeof m.content === 'string'),
      ).toBe(true);
    expect(JSON.stringify(f.wire.requests[3]?.body.messages)).toContain('real file bytes');
  } finally {
    await f.session.dispose();
  }
});

it('unflagged entry preserves native parts and endpoint refusal', async () => {
  const f = setup(false);
  try {
    await f.session.send('Hello');
    expect(f.session.status()).toBe('error');
    expect(f.rejected).toHaveLength(1);
    expect(f.wire.requests).toHaveLength(0);
  } finally {
    await f.session.dispose();
  }
});

it('flagged vision-capable entry refuses images before a request', async () => {
  const f = setup(true);
  try {
    await expect(
      f.session.send('Look', [{ type: 'image', mimeType: 'image/png', data: 'eA==' }]),
    ).rejects.toThrow(/strict.*image/);
    expect(f.rejected).toEqual([]);
    expect(f.wire.requests).toHaveLength(0);
    expect(f.session.status()).toBe('idle');
  } finally {
    await f.session.dispose();
  }
});

it('flagged entry refuses restored image history before network instead of dropping it', async () => {
  const f = setup(true, [
    {
      role: 'user',
      content: [{ type: 'image', mimeType: 'image/png', data: 'eA==' }],
      timestamp: 1,
    },
  ]);
  try {
    await f.session.send('Describe the earlier image');
    expect(f.session.status()).toBe('error');
    expect(f.session.detail()).toMatch(/image/i);
    expect(f.rejected).toEqual([]);
    expect(f.wire.requests).toHaveLength(0);
  } finally {
    await f.session.dispose();
  }
});

it.each(['complete', 'completeSimple'] as const)(
  'native %s applies the entry flag after caller payload customization',
  async (method) => {
    const wire = scriptedProvider(['Complete.']);
    const models = createModels();
    const entry = {
      id: 'strict',
      name: 'Strict',
      provider: 'local',
      api: 'openai-completions' as const,
      baseUrl: 'https://text-only.invalid/v1',
      contextWindow: 32768,
      maxTokens: 4096,
      textOnlyContent: true,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    };
    models.setProvider(createOpenAIProvider({ id: 'local', fetch: wire.fetch, models: [entry] }));
    const model = models.getModels()[0]!;
    let customizations = 0;
    const result = await models[method](
      model,
      {
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'one' },
              { type: 'text', text: '\ntwo' },
            ],
            timestamp: 1,
          },
        ],
      },
      {
        onPayload(payload) {
          customizations++;
          return { ...(payload as Record<string, unknown>), seed: 42 };
        },
      },
    );
    expect(result.stopReason).toBe('stop');
    expect(customizations).toBe(1);
    expect(wire.requests[0]?.body.messages.find((m) => m.role === 'user')?.content).toBe(
      'one\ntwo',
    );
    expect(wire.requests[0]?.body).toHaveProperty('seed', 42);
  },
);

it('invalid textOnlyContent rejects provider configuration', () => {
  const invalid = {
    id: 'bad',
    name: 'Bad',
    provider: 'local',
    api: 'openai-completions' as const,
    baseUrl: 'https://text-only.invalid/v1',
    contextWindow: 32768,
    maxTokens: 4096,
    textOnlyContent: 'yes',
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  };
  expect(() =>
    createOpenAIProvider({
      id: 'local',
      models: [invalid as unknown as import('./index.ts').OpenAIModel],
    }),
  ).toThrow(/textOnlyContent/);
});
