/**
 * AI mode settings (ADR-0190): any OpenAI-compatible endpoint via
 * `baseUrl`/`apiKey`/`model`, persisted under `rf.ai.v1` in localStorage
 * (same safe-storage pattern as {@link ../glue/layout-store.ts}). Plaintext
 * apiKey in localStorage is the accepted MVP risk — the settings UI says so.
 * The key never leaves the browser except in the Authorization header of the
 * user-configured endpoint; {@link aiConfigSnapshot} is the ONLY shape traces
 * and exports may embed.
 */

/** The minimal `localStorage` surface used here (see layout-store). */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const AI_SETTINGS_KEY = 'rf.ai.v1';

export interface AiSettings {
  /** OpenAI-compatible endpoint base, e.g. `https://api.openai.com/v1` or `/ai-proxy/v1`. */
  baseUrl: string;
  apiKey: string;
  /** Model id sent verbatim to the endpoint. */
  model: string;
  /** Context window the loop assumes (compaction sizing); provider is not asked. */
  contextWindow?: number;
  /** Per-run budget: tool calls before the run stops as `budget-exceeded`. */
  maxToolCalls: number;
  /** Per-run budget: wall clock before the run stops as `budget-exceeded`. */
  runTimeoutMs: number;
}

export const AI_SETTINGS_DEFAULTS: AiSettings = {
  baseUrl: '',
  apiKey: '',
  model: '',
  maxToolCalls: 50,
  runTimeoutMs: 10 * 60_000,
};

/** Key-free config slice — the only settings shape allowed into traces/exports. */
export interface AiConfigSnapshot {
  readonly baseUrl: string;
  readonly model: string;
  readonly contextWindow?: number;
  readonly maxToolCalls: number;
  readonly runTimeoutMs: number;
}

export function aiConfigSnapshot(settings: AiSettings): AiConfigSnapshot {
  return {
    baseUrl: settings.baseUrl,
    model: settings.model,
    ...(settings.contextWindow === undefined ? {} : { contextWindow: settings.contextWindow }),
    maxToolCalls: settings.maxToolCalls,
    runTimeoutMs: settings.runTimeoutMs,
  };
}

function positiveNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

/**
 * Load + merge persisted settings over {@link AI_SETTINGS_DEFAULTS}. Any
 * read/parse failure (private mode, malformed JSON, wrong types) yields the
 * defaults — settings are re-enterable, never load-bearing.
 */
export function loadAiSettings(storage: StorageLike | undefined): AiSettings {
  if (!storage) return { ...AI_SETTINGS_DEFAULTS };
  let raw: string | null = null;
  try {
    raw = storage.getItem(AI_SETTINGS_KEY);
  } catch {
    return { ...AI_SETTINGS_DEFAULTS };
  }
  if (!raw) return { ...AI_SETTINGS_DEFAULTS };
  try {
    const parsed = JSON.parse(raw) as Partial<AiSettings>;
    const contextWindow =
      typeof parsed.contextWindow === 'number' &&
      Number.isFinite(parsed.contextWindow) &&
      parsed.contextWindow > 0
        ? { contextWindow: parsed.contextWindow }
        : {};
    return {
      baseUrl: typeof parsed.baseUrl === 'string' ? parsed.baseUrl : AI_SETTINGS_DEFAULTS.baseUrl,
      apiKey: typeof parsed.apiKey === 'string' ? parsed.apiKey : AI_SETTINGS_DEFAULTS.apiKey,
      model: typeof parsed.model === 'string' ? parsed.model : AI_SETTINGS_DEFAULTS.model,
      ...contextWindow,
      maxToolCalls: positiveNumber(parsed.maxToolCalls, AI_SETTINGS_DEFAULTS.maxToolCalls),
      runTimeoutMs: positiveNumber(parsed.runTimeoutMs, AI_SETTINGS_DEFAULTS.runTimeoutMs),
    };
  } catch {
    return { ...AI_SETTINGS_DEFAULTS };
  }
}

/** Persist settings. Swallows quota/private-mode failures (never throws upstream). */
export function saveAiSettings(storage: StorageLike | undefined, settings: AiSettings): void {
  if (!storage) return;
  try {
    storage.setItem(AI_SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // best-effort persistence; the in-memory settings still drive the session.
  }
}

/**
 * Resolve the configured baseUrl for the provider client. A relative baseUrl
 * (`/ai-proxy/v1` — the dev CORS proxy, D-004) resolves against the page
 * origin so the fetch stays same-origin; the openai client requires an
 * absolute URL. An invalid value throws with the offending input named.
 */
export function resolveBaseUrl(baseUrl: string, origin: string): string {
  const trimmed = baseUrl.trim();
  if (trimmed === '') throw new Error('AI settings: baseUrl is empty — configure it in Settings');
  try {
    // Strip a trailing slash: the openai client appends `/chat/completions`.
    return new URL(trimmed, origin).toString().replace(/\/$/, '');
  } catch {
    throw new Error(`AI settings: baseUrl "${trimmed}" is not a valid URL`);
  }
}
