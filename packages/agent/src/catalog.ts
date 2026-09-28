import {
  type Model,
  type Models,
  type Provider,
  type ProviderRequestOptions,
  createProvider,
} from '@earendil-works/pi-ai';
import { stream, streamSimple } from '@earendil-works/pi-ai/api/openai-completions';

export type OpenAIModel = Omit<Model<'openai-completions'>, 'reasoning' | 'input'> &
  Partial<Pick<Model<'openai-completions'>, 'reasoning' | 'input'>>;

export interface OpenAIProviderOptions {
  readonly id: string;
  readonly models: readonly OpenAIModel[];
  readonly apiKey?: string;
  readonly fetch?: ProviderRequestOptions['fetch'];
}

const providerKeys = new WeakMap<Provider, readonly string[]>();

export function isOpenAIProvider(provider: Provider | undefined): boolean {
  return provider !== undefined && providerKeys.has(provider);
}

/** Native pi provider; consumers register it in their own Models collection. */
export function createOpenAIProvider(
  options: OpenAIProviderOptions,
): Provider<'openai-completions'> {
  const models = options.models.map((entry) => {
    if (entry.provider !== options.id || entry.api !== 'openai-completions')
      throw new TypeError(`Model ${entry.id} does not belong to OpenAI provider ${options.id}`);
    validateModel(entry);
    return {
      ...entry,
      baseUrl: new URL(entry.baseUrl, typeof location === 'undefined' ? undefined : location.href)
        .href,
      reasoning: entry.reasoning ?? false,
      input: entry.input ?? ['text' as const],
    };
  });
  const provider = createProvider({
    id: options.id,
    models,
    auth: {
      apiKey: {
        name: options.id,
        async resolve() {
          return {
            auth: {
              apiKey: options.apiKey || 'unused-no-auth-sentinel',
              ...(options.apiKey ? {} : { headers: { Authorization: null } }),
            },
          };
        },
      },
    },
    api: {
      stream: (model, context, request) =>
        stream(model as Model<'openai-completions'>, context, {
          ...request,
          ...(options.fetch ? { fetch: options.fetch } : {}),
          maxRetries: 0,
        }),
      streamSimple: (model, context, request) =>
        streamSimple(model as Model<'openai-completions'>, context, {
          ...request,
          ...(options.fetch ? { fetch: options.fetch } : {}),
          maxRetries: 0,
        }),
    },
  });
  providerKeys.set(provider, options.apiKey ? [options.apiKey] : []);
  return provider;
}

function validateModel(
  model: Pick<Model<'openai-completions'>, 'id' | 'contextWindow' | 'maxTokens'>,
): void {
  if (!model.id?.trim()) throw new TypeError('Catalog model id is required');
  for (const key of ['contextWindow', 'maxTokens'] as const)
    if (!Number.isSafeInteger(model[key]) || model[key] <= 0)
      throw new TypeError(`Model ${model.id}: ${key} must be a positive safe integer`);
}

export function selectModel(
  models: Models,
  id: string,
): Model<import('@earendil-works/pi-ai').Api> {
  const matches = models.getModels().filter((model) => model.id === id);
  if (matches.length !== 1)
    throw new TypeError(`Catalog model ${id}: ${matches.length ? 'ambiguous id' : 'not found'}`);
  const selected = matches[0]!;
  validateModel(selected);
  return { ...selected, reasoning: selected.reasoning ?? false, input: selected.input ?? ['text'] };
}

/** apiKeys of built-in providers currently registered; headers are not implicit secrets. */
export function builtInApiKeys(models: Models): string[] {
  return models.getProviders().flatMap((provider) => providerKeys.get(provider) ?? []);
}
