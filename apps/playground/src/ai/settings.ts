import { browserLocalStorage } from '../glue/browser-storage.ts';

export const SETTINGS_KEY = 'rf.ai.v2';
export interface ChatSettings {
  readonly baseUrl: string;
  readonly model: string;
  readonly apiKey: string;
  readonly maxToolCalls: number;
  readonly runTimeoutMs: number;
}

export function loadSettings(): ChatSettings {
  let stored: unknown;
  try {
    stored = JSON.parse(browserLocalStorage()?.getItem(SETTINGS_KEY) ?? 'null');
  } catch {
    stored = null;
  }
  const fields =
    stored !== null && typeof stored === 'object' ? (stored as Record<string, unknown>) : {};
  return {
    baseUrl: typeof fields.baseUrl === 'string' ? fields.baseUrl : '',
    model: typeof fields.model === 'string' ? fields.model : '',
    apiKey: '',
    maxToolCalls: 100,
    runTimeoutMs: 180_000,
  };
}

export function validateSettings(input: ChatSettings): ChatSettings {
  const baseUrl = input.baseUrl.trim();
  const model = input.model.trim();
  if (!baseUrl || !model) throw new Error('Enter a Base URL and model in Settings.');
  const url = new URL(baseUrl, location.href);
  if (url.protocol !== 'http:' && url.protocol !== 'https:')
    throw new Error('Base URL must use HTTP or HTTPS.');
  for (const [name, value] of [
    ['Tool limit', input.maxToolCalls],
    ['Time limit', input.runTimeoutMs],
  ] as const)
    if (!Number.isSafeInteger(value) || value <= 0)
      throw new Error(`${name} must be a positive integer.`);
  return { ...input, baseUrl, model };
}

export function saveSettings(settings: ChatSettings): boolean {
  const storage = browserLocalStorage();
  if (!storage) return false;
  try {
    storage.setItem(
      SETTINGS_KEY,
      JSON.stringify({ baseUrl: settings.baseUrl, model: settings.model }),
    );
    return true;
  } catch {
    return false;
  }
}
