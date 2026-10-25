import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  type Context,
  type Model,
  createAssistantMessageEventStream,
  createProvider,
} from '@earendil-works/pi-ai';
import {
  DefaultResourceLoader,
  type ExtensionFactory,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  createAgentSession,
} from '@earendil-works/pi-coding-agent';
import { getAgentPromptProfile } from '@riftydev/agent';
import { expect, it } from 'vitest';
import { nativeExtension } from './lanes/native-extension.ts';

it('actual native Pi benchmark extension sends the shared v2 recipe on model wire', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'rifty-native-recipe-'));
  const model: Model<'openai-completions'> = {
    id: 'probe',
    name: 'probe',
    provider: 'probe',
    api: 'openai-completions',
    baseUrl: 'https://recipe.invalid',
    contextWindow: 128000,
    maxTokens: 8192,
    reasoning: false,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  };
  const contexts: Context[] = [];
  const stream = (_model: Model<'openai-completions'>, context: Context) => {
    contexts.push({ ...context, messages: structuredClone(context.messages) });
    const events = createAssistantMessageEventStream();
    events.push({
      type: 'done',
      reason: 'stop',
      message: {
        role: 'assistant',
        api: model.api,
        provider: model.provider,
        model: model.id,
        timestamp: Date.now(),
        content: [{ type: 'text', text: 'Done' }],
        stopReason: 'stop',
        usage: {
          input: 10,
          output: 2,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 12,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
      },
    });
    return events;
  };
  try {
    const extensionPath = join(directory, 'bench-extension.mjs');
    await writeFile(
      extensionPath,
      nativeExtension(
        directory,
        { ...model, thinking: 'off' },
        { maxToolCalls: 100, runTimeoutMs: 10000 },
      ),
    );
    const extension = (await import(/* @vite-ignore */ pathToFileURL(extensionPath).href))
      .default as ExtensionFactory;
    const settingsManager = SettingsManager.inMemory(
      { retry: { enabled: false }, compaction: { enabled: false } },
      { projectTrusted: true },
    );
    const resourceLoader = new DefaultResourceLoader({
      cwd: directory,
      agentDir: directory,
      settingsManager,
      noContextFiles: true,
      noSkills: true,
      noPromptTemplates: true,
      noExtensions: true,
      noThemes: true,
      extensionFactories: [extension],
    });
    await resourceLoader.reload();
    expect(resourceLoader.getExtensions().errors).toEqual([]);
    const modelRuntime = await ModelRuntime.create({
      modelsPath: null,
      authPath: join(directory, 'auth.json'),
      modelsStorePath: join(directory, 'models.json'),
      refreshOnCreate: false,
      allowModelNetwork: false,
    });
    modelRuntime.registerNativeProvider(
      createProvider({
        id: 'probe',
        models: [model],
        auth: {
          apiKey: { name: 'test', resolve: async () => ({ auth: { apiKey: 'synthetic' } }) },
        },
        api: { stream, streamSimple: stream },
      }),
    );
    const { session } = await createAgentSession({
      cwd: directory,
      agentDir: directory,
      settingsManager,
      resourceLoader,
      modelRuntime,
      sessionManager: SessionManager.inMemory(directory),
      model: modelRuntime.getModel('probe', 'probe'),
      tools: [],
    });
    try {
      await session.prompt('Inspect the shared workflow.');
      expect(contexts).toHaveLength(1);
      const actual = contexts[0]!.systemPrompt;
      expect(actual).toBe(await readFile(join(directory, 'system-prompt.txt'), 'utf8'));
      const profile = getAgentPromptProfile() as ReturnType<typeof getAgentPromptProfile> & {
        recipe?: string;
      };
      for (const paragraph of [
        profile.intro,
        profile.guidance,
        profile.recovery,
        profile.verification,
      ])
        expect(actual).toContain(paragraph);
      expect(profile.recipe).toBeTruthy();
      expect(actual).toContain(profile.recipe!);
    } finally {
      session.dispose();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
