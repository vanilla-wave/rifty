import {
  type Context,
  type Model,
  type Models,
  type Provider,
  type ProviderRequestOptions,
  createProvider,
} from '@earendil-works/pi-ai';
import { stream, streamSimple } from '@earendil-works/pi-ai/api/openai-completions';

export type OpenAIModel = Omit<Model<'openai-completions'>, 'reasoning' | 'input'> &
  Partial<Pick<Model<'openai-completions'>, 'reasoning' | 'input'>> & {
    /** String-only message content; images are refused before network dispatch. */
    readonly textOnlyContent?: boolean;
  };

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
  const textOnly = new Set<string>();
  const models = options.models.map((entry) => {
    if (entry.provider !== options.id || entry.api !== 'openai-completions')
      throw new TypeError(`Model ${entry.id} does not belong to OpenAI provider ${options.id}`);
    validateModel(entry);
    if (entry.textOnlyContent !== undefined && typeof entry.textOnlyContent !== 'boolean')
      throw new TypeError(`Model ${entry.id}: textOnlyContent must be a boolean`);
    if (entry.textOnlyContent) textOnly.add(entry.id);
    return {
      ...entry,
      baseUrl: new URL(entry.baseUrl, typeof location === 'undefined' ? undefined : location.href)
        .href,
      reasoning: entry.reasoning ?? false,
      input: entry.textOnlyContent ? ['text' as const] : (entry.input ?? ['text' as const]),
    };
  });
  function contentPolicy(
    model: Model<import('@earendil-works/pi-ai').Api>,
    context: Context,
    request: ProviderRequestOptions | undefined,
  ): Pick<ProviderRequestOptions, 'onPayload'> {
    if (!textOnly.has(model.id)) return {};
    return {
      async onPayload(payload, selected) {
        if (
          context.messages.some(
            (message) =>
              Array.isArray(message.content) &&
              message.content.some((part) => part.type === 'image'),
          )
        )
          throw new TypeError(`Model ${model.id} does not accept images in history`);
        const customized = await request?.onPayload?.(payload, selected);
        return stringContentPayload(customized === undefined ? payload : customized);
      },
    };
  }
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
          ...contentPolicy(model, context, request),
          ...(options.fetch ? { fetch: options.fetch } : {}),
          maxRetries: 0,
        }),
      streamSimple: (model, context, request) =>
        streamSimple(model as Model<'openai-completions'>, context, {
          ...request,
          ...contentPolicy(model, context, request),
          ...(options.fetch ? { fetch: options.fetch } : {}),
          maxRetries: 0,
        }),
    },
  });
  providerKeys.set(provider, options.apiKey ? [options.apiKey] : []);
  return provider;
}

function stringContentPayload(payload: unknown): unknown {
  if (!payload || typeof payload !== 'object' || !('messages' in payload))
    throw new TypeError('textOnlyContent requires a message payload');
  const messages = payload.messages;
  if (!Array.isArray(messages)) throw new TypeError('textOnlyContent requires messages');
  return {
    ...payload,
    messages: messages.map((message: unknown) => {
      if (!message || typeof message !== 'object')
        throw new TypeError('textOnlyContent requires message objects');
      const content: unknown = 'content' in message ? message.content : undefined;
      if (content == null || typeof content === 'string')
        return { ...message, content: content ?? '' };
      if (
        !Array.isArray(content) ||
        !content.every(
          (part: unknown) =>
            part !== null &&
            typeof part === 'object' &&
            'type' in part &&
            part.type === 'text' &&
            'text' in part &&
            typeof part.text === 'string',
        )
      )
        throw new TypeError('textOnlyContent refuses non-text message content');
      return { ...message, content: content.map((part: { text: string }) => part.text).join('') };
    }),
  };
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
