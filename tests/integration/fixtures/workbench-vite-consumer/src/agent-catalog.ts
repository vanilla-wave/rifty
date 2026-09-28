import {
  type Provider,
  type StreamFn,
  createModels,
  createOpenAIProvider,
  createProvider,
} from '@riftydev/agent';

/** Fixture setup only: the session always receives a real native pi catalog. */
export function modelCatalog(
  settings: { baseUrl: string; model: string; apiKey?: string } = {
    baseUrl: 'https://scripted.invalid/v1',
    model: 'scripted',
    apiKey: undefined as string | undefined,
  },
  fetch?: typeof globalThis.fetch,
  streamFn?: StreamFn,
) {
  const model = {
    id: settings.model,
    name: settings.model,
    api: 'openai-completions' as const,
    provider: 'rifty',
    baseUrl: settings.baseUrl,
    contextWindow: 128_000,
    maxTokens: 8192,
    reasoning: false,
    input: ['text' as const],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  };
  const models = createModels();
  models.setProvider(
    streamFn
      ? createProvider({
          id: model.provider,
          models: [model],
          auth: {
            apiKey: {
              name: 'Fixture',
              async resolve() {
                return { auth: { apiKey: 'unused' } };
              },
            },
          },
          // Fixture callbacks return native streams synchronously.
          api: {
            stream: streamFn as Provider['streamSimple'],
            streamSimple: streamFn as Provider['streamSimple'],
          },
        })
      : createOpenAIProvider({
          id: model.provider,
          models: [model],
          apiKey: settings.apiKey,
          fetch,
        }),
  );
  return { models, model: model.id };
}
