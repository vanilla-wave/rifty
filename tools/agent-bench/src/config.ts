import { readFile } from 'node:fs/promises';
import { type OpenAIModel, type SimpleStreamOptions, createOpenAIProvider } from '@riftydev/agent';

export type Endpoint = OpenAIModel & {
  thinking: SimpleStreamOptions['reasoning'] | 'off';
  temperature?: number;
  envKey?: string;
};
export interface Limits {
  maxToolCalls: number;
  runTimeoutMs: number;
}
export interface Config {
  endpoint?: Endpoint;
  limits: Limits;
  runsPerTask: number;
  playgroundPort: number;
}
export const taskSet = 'trackline-300+hono-v1';
export function positive(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0)
    throw new Error(`${name} must be a positive integer`);
  return value;
}
function record(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${name} must be an object`);
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, allowed: string[]) {
  for (const key of Object.keys(value))
    if (!allowed.includes(key)) throw new Error(`Unknown config field ${key}`);
}
function text(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim())
    throw new Error(`${name} must be a nonempty string`);
  return value.trim();
}
export async function loadConfig(path?: string): Promise<Config> {
  const raw = record(path ? JSON.parse(await readFile(path, 'utf8')) : {}, 'config');
  keys(raw, ['endpoint', 'limits', 'runsPerTask', 'playgroundPort']);
  const limits = raw.limits === undefined ? {} : record(raw.limits, 'limits');
  keys(limits, ['maxToolCalls', 'runTimeoutMs']);
  let endpoint: Endpoint | undefined;
  if (raw.endpoint !== undefined) {
    const value = record(raw.endpoint, 'endpoint');
    keys(value, [
      'id',
      'name',
      'api',
      'provider',
      'baseUrl',
      'input',
      'reasoning',
      'contextWindow',
      'maxTokens',
      'compat',
      'cost',
      'samplingParams',
      'headers',
      'thinkingLevelMap',
      'thinking',
      'temperature',
      'envKey',
    ]);
    const baseUrl = text(value.baseUrl, 'endpoint.baseUrl');
    const url = new URL(baseUrl);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
      throw new Error('Endpoint requires an HTTP URL without credentials');
    if (value.api !== 'openai-completions')
      throw new Error('Benchmark requires an OpenAI-compatible catalog endpoint');
    const thinking = value.thinking ?? 'off';
    if (!['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].includes(String(thinking)))
      throw new Error('Invalid endpoint.thinking');
    if (
      value.temperature !== undefined &&
      (typeof value.temperature !== 'number' || !Number.isFinite(value.temperature))
    )
      throw new Error('endpoint.temperature must be finite');
    const cost = record(value.cost, 'endpoint.cost');
    for (const field of ['input', 'output', 'cacheRead', 'cacheWrite'])
      if (typeof cost[field] !== 'number' || !Number.isFinite(cost[field]) || cost[field] < 0)
        throw new Error(`endpoint.cost.${field} must be nonnegative`);
    if (
      value.input !== undefined &&
      (!Array.isArray(value.input) ||
        !value.input.length ||
        value.input.some((kind) => kind !== 'text' && kind !== 'image'))
    )
      throw new Error('endpoint.input must list text/image');
    if (value.reasoning !== undefined && typeof value.reasoning !== 'boolean')
      throw new Error('endpoint.reasoning must be boolean');
    for (const field of ['compat', 'samplingParams', 'thinkingLevelMap'])
      if (value[field] !== undefined) record(value[field], `endpoint.${field}`);
    if (
      value.headers !== undefined &&
      Object.values(record(value.headers, 'endpoint.headers')).some(
        (header) => typeof header !== 'string',
      )
    )
      throw new Error('endpoint.headers must contain strings');
    endpoint = {
      ...value,
      id: text(value.id, 'endpoint.id'),
      name: text(value.name, 'endpoint.name'),
      provider: text(value.provider, 'endpoint.provider'),
      api: 'openai-completions',
      baseUrl,
      contextWindow: positive(value.contextWindow, 'endpoint.contextWindow'),
      maxTokens: positive(value.maxTokens, 'endpoint.maxTokens'),
      reasoning: value.reasoning ?? false,
      input: value.input ?? ['text'],
      compat: value.compat ?? {},
      thinking,
      ...(value.envKey === undefined ? {} : { envKey: text(value.envKey, 'endpoint.envKey') }),
    } as Endpoint;
    createOpenAIProvider({ id: endpoint.provider, models: [endpoint] });
  }
  return {
    endpoint,
    limits: {
      maxToolCalls: positive(limits.maxToolCalls ?? 40, 'maxToolCalls'),
      runTimeoutMs: positive(limits.runTimeoutMs ?? 600000, 'runTimeoutMs'),
    },
    runsPerTask: positive(raw.runsPerTask ?? 3, 'runsPerTask'),
    playgroundPort: positive(raw.playgroundPort ?? 5289, 'playgroundPort'),
  };
}
export function readKey(endpoint: Endpoint): string | undefined {
  if (!endpoint.envKey) return undefined;
  const key = process.env[endpoint.envKey];
  if (!key) throw new Error(`Configured endpoint.envKey ${endpoint.envKey} is missing`);
  return key;
}
export function secretValues(endpoint: Endpoint, key?: string): string[] {
  return [key, ...Object.values(endpoint.headers ?? {})]
    .flatMap((value) =>
      value ? [value, value.trim(), value.trim().replace(/^Bearer\s+/i, '')] : [],
    )
    .filter(Boolean);
}
export function redact(text: string, keys?: string | readonly string[]): string {
  let result = text;
  for (const key of typeof keys === 'string' ? [keys] : (keys ?? [])) {
    result = result
      .replaceAll(JSON.stringify(key).slice(1, -1), '[REDACTED]')
      .replaceAll(key, '[REDACTED]');
  }
  return result;
}
