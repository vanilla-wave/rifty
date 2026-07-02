/**
 * Bench config: schema + loader (docs/backlog/distribution/agent-bench-harness.md).
 * The endpoint API key is NEVER stored here — config carries only the NAME of the
 * env var (`envKey`); the pi CLI resolves `$<envKey>` itself at run time.
 */
import { readFileSync } from 'node:fs';

export interface EndpointConfig {
  /** OpenAI-compatible chat-completions base URL (including /v1 when the server expects it). */
  readonly baseUrl: string;
  readonly model: string;
  /** Name of the env var holding the API key (key itself never stored). */
  readonly envKey: string;
}

export interface BenchLimits {
  readonly maxToolCalls: number;
  readonly runTimeoutMs: number;
  readonly toolTimeoutMs: number;
}

export interface BenchConfig {
  /** null until a config file (or --mock-model) provides it; real runs require it. */
  readonly endpoint: EndpointConfig | null;
  readonly limits: BenchLimits;
  readonly runsPerTask: number;
  readonly playgroundPort: number;
  readonly taskSetVersion: string;
}

export const DEFAULT_ENV_KEY = 'OPENAI_API_KEY';

export const DEFAULT_LIMITS: BenchLimits = {
  maxToolCalls: 40,
  runTimeoutMs: 10 * 60_000,
  toolTimeoutMs: 2 * 60_000,
};

export const TASK_SET_VERSION = 'task-set-v1';

const DEFAULT_PLAYGROUND_PORT = 5273;

function fail(msg: string): never {
  throw new Error(`agent-bench config: ${msg}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requirePositiveInt(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    fail(`${path} must be a positive integer, got ${JSON.stringify(value)}`);
  }
  return value;
}

function requireString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    fail(`${path} must be a non-empty string, got ${JSON.stringify(value)}`);
  }
  return value;
}

function rejectUnknownKeys(obj: Record<string, unknown>, allowed: string[], path: string): void {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) fail(`unknown key ${path}${key} (allowed: ${allowed.join(', ')})`);
  }
}

function parseEndpoint(raw: unknown): EndpointConfig {
  if (!isRecord(raw)) fail('endpoint must be an object');
  rejectUnknownKeys(raw, ['baseUrl', 'model', 'envKey'], 'endpoint.');
  return {
    baseUrl: requireString(raw.baseUrl, 'endpoint.baseUrl'),
    model: requireString(raw.model, 'endpoint.model'),
    envKey:
      raw.envKey === undefined ? DEFAULT_ENV_KEY : requireString(raw.envKey, 'endpoint.envKey'),
  };
}

function parseLimits(raw: unknown): BenchLimits {
  if (!isRecord(raw)) fail('limits must be an object');
  rejectUnknownKeys(raw, ['maxToolCalls', 'runTimeoutMs', 'toolTimeoutMs'], 'limits.');
  return {
    maxToolCalls:
      raw.maxToolCalls === undefined
        ? DEFAULT_LIMITS.maxToolCalls
        : requirePositiveInt(raw.maxToolCalls, 'limits.maxToolCalls'),
    runTimeoutMs:
      raw.runTimeoutMs === undefined
        ? DEFAULT_LIMITS.runTimeoutMs
        : requirePositiveInt(raw.runTimeoutMs, 'limits.runTimeoutMs'),
    toolTimeoutMs:
      raw.toolTimeoutMs === undefined
        ? DEFAULT_LIMITS.toolTimeoutMs
        : requirePositiveInt(raw.toolTimeoutMs, 'limits.toolTimeoutMs'),
  };
}

function defaultPlaygroundPort(env: NodeJS.ProcessEnv): number {
  const raw = env.RIFTY_PLAYGROUND_PORT;
  if (raw === undefined || raw === '') return DEFAULT_PLAYGROUND_PORT;
  const port = Number(raw);
  if (!Number.isInteger(port) || port <= 0) {
    fail(`RIFTY_PLAYGROUND_PORT must be a positive integer, got ${JSON.stringify(raw)}`);
  }
  return port;
}

/** Parse a config object (already JSON-decoded). Unknown keys are loud errors. */
export function parseConfig(raw: unknown, env: NodeJS.ProcessEnv = process.env): BenchConfig {
  if (!isRecord(raw)) fail('config root must be a JSON object');
  rejectUnknownKeys(
    raw,
    ['endpoint', 'limits', 'runsPerTask', 'playgroundPort', 'taskSetVersion'],
    '',
  );
  return {
    endpoint: raw.endpoint === undefined ? null : parseEndpoint(raw.endpoint),
    limits: raw.limits === undefined ? DEFAULT_LIMITS : parseLimits(raw.limits),
    runsPerTask:
      raw.runsPerTask === undefined ? 3 : requirePositiveInt(raw.runsPerTask, 'runsPerTask'),
    playgroundPort:
      raw.playgroundPort === undefined
        ? defaultPlaygroundPort(env)
        : requirePositiveInt(raw.playgroundPort, 'playgroundPort'),
    taskSetVersion:
      raw.taskSetVersion === undefined
        ? TASK_SET_VERSION
        : requireString(raw.taskSetVersion, 'taskSetVersion'),
  };
}

/** Load config from a JSON file; no path → all defaults (endpoint absent). */
export function loadConfig(path?: string, env: NodeJS.ProcessEnv = process.env): BenchConfig {
  if (!path) return parseConfig({}, env);
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    fail(`cannot read ${path}: ${(err as Error).message}`);
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (err) {
    fail(`${path} is not valid JSON: ${(err as Error).message}`);
  }
  return parseConfig(json, env);
}
