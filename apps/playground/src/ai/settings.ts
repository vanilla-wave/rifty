import {
  type OpenAIModel,
  type SimpleStreamOptions,
  createModels,
  createOpenAIProvider,
} from '@riftydev/agent';
import { browserLocalStorage } from '../glue/browser-storage.ts';

export const SETTINGS_KEY = 'rf.ai.v2';
export type ChatModel = OpenAIModel & {
  readonly thinking?: SimpleStreamOptions['reasoning'] | 'off';
  readonly temperature?: number;
};
export interface ChatSettings {
  readonly models: readonly ChatModel[];
  readonly model: string;
  readonly apiKeys: Readonly<Record<string, string>>;
  readonly maxToolCalls: number;
  readonly runTimeoutMs: number;
}

export function newModel(id = '', baseUrl = ''): ChatModel {
  return {
    id,
    name: id,
    api: 'openai-completions',
    provider: 'rifty',
    baseUrl,
    contextWindow: 128_000,
    maxTokens: 8192,
    reasoning: false,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    compat: {},
    thinking: 'off',
  };
}

function object(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new TypeError(`${name} must be an object`);
  return value as Record<string, unknown>;
}

export function readCatalog(value: unknown): ChatModel[] {
  if (!Array.isArray(value) || !value.length)
    throw new TypeError('Catalog must contain at least one model');
  const ids = new Set<string>();
  return value.map((raw, index) => {
    const entry = { ...object(raw, `Model ${index + 1}`) };
    const allowed = [
      'id',
      'name',
      'api',
      'provider',
      'baseUrl',
      'contextWindow',
      'maxTokens',
      'reasoning',
      'input',
      'cost',
      'compat',
      'samplingParams',
      'headers',
      'thinkingLevelMap',
      'thinking',
      'temperature',
    ];
    for (const key of Object.keys(entry))
      if (!allowed.includes(key))
        throw new TypeError(
          `Unknown model field: ${key}; credentials belong in the API key control`,
        );
    for (const field of ['id', 'name', 'provider', 'baseUrl'] as const)
      if (typeof entry[field] !== 'string' || !entry[field].trim())
        throw new TypeError(`Model ${index + 1}: ${field} is required`);
    const originalId = entry.id as string;
    entry.id = originalId.trim();
    entry.baseUrl = (entry.baseUrl as string).trim();
    if (entry.name === originalId) entry.name = entry.id;
    if (entry.api !== 'openai-completions')
      throw new TypeError('Playground transport requires openai-completions');
    const url = new URL(
      entry.baseUrl as string,
      typeof location === 'undefined' ? undefined : location.href,
    );
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
      throw new TypeError('Base URL must use HTTP/HTTPS without embedded credentials');
    if (ids.has(entry.id as string)) throw new TypeError(`Duplicate model id: ${entry.id}`);
    ids.add(entry.id as string);
    if (entry.reasoning !== undefined && typeof entry.reasoning !== 'boolean')
      throw new TypeError('reasoning must be boolean');
    if (
      entry.input !== undefined &&
      (!Array.isArray(entry.input) ||
        !entry.input.length ||
        entry.input.some((kind) => kind !== 'text' && kind !== 'image'))
    )
      throw new TypeError('input must list text and/or image');
    const cost = object(entry.cost, 'cost');
    for (const field of ['input', 'output', 'cacheRead', 'cacheWrite'])
      if (typeof cost[field] !== 'number' || !Number.isFinite(cost[field]) || cost[field] < 0)
        throw new TypeError(`cost.${field} must be a nonnegative number`);
    for (const field of ['compat', 'samplingParams', 'thinkingLevelMap'])
      if (entry[field] !== undefined) object(entry[field], field);
    if (
      entry.headers !== undefined &&
      Object.values(object(entry.headers, 'headers')).some((header) => typeof header !== 'string')
    )
      throw new TypeError('headers must contain strings');
    if (
      entry.temperature !== undefined &&
      (typeof entry.temperature !== 'number' || !Number.isFinite(entry.temperature))
    )
      throw new TypeError('temperature must be a finite number');
    if (
      entry.thinking !== undefined &&
      !['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].includes(
        entry.thinking as string,
      )
    )
      throw new TypeError('Unknown thinking level');
    const model = {
      ...entry,
      reasoning: entry.reasoning ?? false,
      input: entry.input ?? ['text'],
      compat: entry.compat ?? {},
      thinking: entry.thinking ?? 'off',
    } as unknown as ChatModel;
    // Native constructor validates model identity and declared token limits.
    createOpenAIProvider({ id: model.provider, models: [model] });
    return model;
  });
}

export function loadSettings(): ChatSettings {
  let fields: Record<string, unknown> = {};
  try {
    fields = object(JSON.parse(browserLocalStorage()?.getItem(SETTINGS_KEY) ?? '{}'), 'settings');
  } catch {}
  let models: ChatModel[];
  try {
    models = Array.isArray(fields.models)
      ? readCatalog(fields.models).map(({ headers: _headers, ...entry }) => entry)
      : [
          newModel(
            typeof fields.model === 'string' ? fields.model : '',
            typeof fields.baseUrl === 'string' ? fields.baseUrl : '',
          ),
        ];
  } catch {
    models = [newModel()];
  }
  const model =
    typeof fields.model === 'string' && models.some((entry) => entry.id === fields.model)
      ? fields.model
      : models[0]!.id;
  return { models, model, apiKeys: {}, maxToolCalls: 100, runTimeoutMs: 600_000 };
}

export function validateSettings(input: ChatSettings): ChatSettings {
  const models = readCatalog(input.models);
  const model = input.model.trim();
  if (!models.some((entry) => entry.id === model)) throw new TypeError('Select a catalog model');
  for (const [name, value] of [
    ['Tool limit', input.maxToolCalls],
    ['Time limit', input.runTimeoutMs],
  ] as const)
    if (!Number.isSafeInteger(value) || value <= 0)
      throw new Error(`${name} must be a positive integer.`);
  return { ...input, models, model };
}

export function sessionCatalog(settings: ChatSettings) {
  const models = createModels();
  const providers = new Map<string, OpenAIModel[]>();
  const modelOptions: Record<string, Pick<SimpleStreamOptions, 'reasoning' | 'temperature'>> = {};
  for (const { thinking, temperature, ...model } of settings.models) {
    const entries = providers.get(model.provider) ?? [];
    entries.push(model);
    providers.set(model.provider, entries);
    modelOptions[model.id] = {
      ...(thinking && thinking !== 'off' ? { reasoning: thinking } : {}),
      ...(temperature === undefined ? {} : { temperature }),
    };
  }
  for (const [id, entries] of providers)
    models.setProvider(createOpenAIProvider({ id, models: entries, apiKey: settings.apiKeys[id] }));
  return { models, model: settings.model, modelOptions };
}

export function saveSettings(settings: ChatSettings): boolean {
  const storage = browserLocalStorage();
  if (!storage) return false;
  try {
    storage.setItem(
      SETTINGS_KEY,
      JSON.stringify({
        models: settings.models.map(({ headers: _headers, ...model }) => model),
        model: settings.model,
      }),
    );
    return true;
  } catch {
    return false;
  }
}
