export interface AiCommandSuggestionConfig {
  readonly url: string;
  readonly key?: string;
}

export type AiCommandSuggestionMode = 'dev' | 'real-vite';

export interface AiCommandSuggestionRequest {
  readonly prompt: string;
  readonly cwd: string;
  readonly mode: AiCommandSuggestionMode;
  readonly commands: readonly string[];
}

export interface AiCommandSuggestionResponse {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
}

export type AiCommandSuggestionFetcher = (
  input: string,
  init: RequestInit,
) => Promise<AiCommandSuggestionResponse>;

export function readAiCommandSuggestionConfig(
  env: Record<string, unknown>,
): AiCommandSuggestionConfig | null {
  const rawUrl = env.VITE_RIFTY_AI_COMMAND_SUGGEST_URL;
  const url = typeof rawUrl === 'string' ? rawUrl.trim() : '';
  if (url.length === 0) return null;
  const rawKey = env.VITE_RIFTY_AI_COMMAND_SUGGEST_KEY;
  const key = typeof rawKey === 'string' ? rawKey.trim() : '';
  return key.length > 0 ? { url, key } : { url };
}

export function extractAiCommandPrompt(line: string): string | null {
  const trimmedStart = line.trimStart();
  if (!trimmedStart.startsWith('#')) return null;
  const prompt = trimmedStart.slice(1).trim();
  return prompt.length > 0 ? prompt : null;
}

export async function suggestAiCommand(
  config: AiCommandSuggestionConfig,
  request: AiCommandSuggestionRequest,
  fetcher: AiCommandSuggestionFetcher = globalThis.fetch.bind(globalThis),
  signal?: AbortSignal,
): Promise<string | null> {
  try {
    const response = await fetcher(config.url, {
      method: 'POST',
      headers: requestHeaders(config),
      body: JSON.stringify({
        prompt: request.prompt,
        cwd: request.cwd,
        mode: request.mode,
        commands: request.commands,
        policy: {
          allowedCommands: request.commands,
          neverAutoRun: true,
          rejectCompoundCommands: true,
        },
      }),
      signal,
    });
    if (!response.ok) return null;
    const payload = await response.json();
    const candidate = commandFromPayload(payload);
    if (!candidate) return null;
    return validateSuggestedCommand(candidate, request.commands);
  } catch {
    return null;
  }
}

function requestHeaders(config: AiCommandSuggestionConfig): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (config.key) headers.Authorization = `Bearer ${config.key}`;
  return headers;
}

function commandFromPayload(payload: unknown): string | null {
  if (!isRecord(payload)) return null;
  const raw = payload.command ?? payload.suggestion;
  return typeof raw === 'string' ? raw : null;
}

function validateSuggestedCommand(command: string, commands: readonly string[]): string | null {
  const normalized = command.trim();
  if (normalized.length === 0 || normalized.length > 512) return null;
  if (/[\r\n]/u.test(normalized)) return null;
  if (/(?:&&|\|\||[;|<>&])/u.test(normalized)) return null;
  const first = /^([A-Za-z0-9._-]+)/u.exec(normalized)?.[1] ?? '';
  if (!commands.includes(first)) return null;
  return normalized;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
