import { readFile } from 'node:fs/promises';

export interface Endpoint {
  baseUrl: string;
  model: string;
  envKey?: string;
}
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
  return value;
}
export async function loadConfig(path?: string): Promise<Config> {
  const raw = record(path ? JSON.parse(await readFile(path, 'utf8')) : {}, 'config');
  keys(raw, ['endpoint', 'limits', 'runsPerTask', 'playgroundPort']);
  const limits = raw.limits === undefined ? {} : record(raw.limits, 'limits');
  keys(limits, ['maxToolCalls', 'runTimeoutMs']);
  let endpoint: Endpoint | undefined;
  if (raw.endpoint !== undefined) {
    const value = record(raw.endpoint, 'endpoint');
    keys(value, ['baseUrl', 'model', 'envKey']);
    const baseUrl = text(value.baseUrl, 'endpoint.baseUrl');
    const url = new URL(baseUrl);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
      throw new Error('Endpoint requires an HTTP URL without credentials');
    endpoint = {
      baseUrl,
      model: text(value.model, 'endpoint.model'),
      ...(value.envKey === undefined ? {} : { envKey: text(value.envKey, 'endpoint.envKey') }),
    };
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
export function redact(text: string, key?: string): string {
  return key ? text.replaceAll(key, '[REDACTED]') : text;
}
