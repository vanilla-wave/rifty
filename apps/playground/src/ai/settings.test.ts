import { describe, expect, it } from 'vitest';
import {
  AI_SETTINGS_DEFAULTS,
  AI_SETTINGS_KEY,
  type AiSettings,
  type StorageLike,
  aiConfigSnapshot,
  loadAiSettings,
  resolveBaseUrl,
  saveAiSettings,
} from './settings.ts';

function fakeStorage(
  initial: Record<string, string> = {},
): StorageLike & { map: Map<string, string> } {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      map.set(k, v);
    },
  };
}

describe('loadAiSettings / saveAiSettings', () => {
  it('returns defaults when storage is empty or absent', () => {
    expect(loadAiSettings(fakeStorage())).toEqual(AI_SETTINGS_DEFAULTS);
    expect(loadAiSettings(undefined)).toEqual(AI_SETTINGS_DEFAULTS);
  });

  it('round-trips saved settings under rf.ai.v1', () => {
    const storage = fakeStorage();
    const settings: AiSettings = {
      baseUrl: '/ai-proxy/v1',
      apiKey: 'sk-secret',
      model: 'gpt-4.1-mini',
      contextWindow: 64_000,
      maxToolCalls: 10,
      runTimeoutMs: 30_000,
    };
    saveAiSettings(storage, settings);
    expect(storage.map.has(AI_SETTINGS_KEY)).toBe(true);
    expect(loadAiSettings(storage)).toEqual(settings);
  });

  it('falls back to defaults on malformed JSON and wrong types', () => {
    expect(loadAiSettings(fakeStorage({ [AI_SETTINGS_KEY]: '{nope' }))).toEqual(
      AI_SETTINGS_DEFAULTS,
    );
    const typed = loadAiSettings(
      fakeStorage({
        [AI_SETTINGS_KEY]: JSON.stringify({ baseUrl: 42, maxToolCalls: -1, contextWindow: 'x' }),
      }),
    );
    expect(typed).toEqual(AI_SETTINGS_DEFAULTS);
  });

  it('never throws on a blocked storage (private mode)', () => {
    const throwing: StorageLike = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(loadAiSettings(throwing)).toEqual(AI_SETTINGS_DEFAULTS);
    expect(() => saveAiSettings(throwing, AI_SETTINGS_DEFAULTS)).not.toThrow();
  });
});

describe('aiConfigSnapshot', () => {
  it('carries no apiKey — the only settings shape traces may embed', () => {
    const snapshot = aiConfigSnapshot({
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'sk-super-secret',
      model: 'm',
      maxToolCalls: 5,
      runTimeoutMs: 1_000,
    });
    expect(JSON.stringify(snapshot)).not.toContain('sk-super-secret');
    expect(Object.keys(snapshot)).not.toContain('apiKey');
    expect(snapshot).toEqual({
      baseUrl: 'https://api.example.com/v1',
      model: 'm',
      maxToolCalls: 5,
      runTimeoutMs: 1_000,
    });
  });
});

describe('resolveBaseUrl', () => {
  it('keeps absolute URLs and strips a trailing slash', () => {
    expect(resolveBaseUrl('https://api.openai.com/v1/', 'http://localhost:5273')).toBe(
      'https://api.openai.com/v1',
    );
  });

  it('resolves a relative baseUrl against the page origin (dev proxy stays same-origin)', () => {
    expect(resolveBaseUrl('/ai-proxy/v1', 'http://localhost:5273')).toBe(
      'http://localhost:5273/ai-proxy/v1',
    );
  });

  it('throws loudly on empty or invalid input', () => {
    expect(() => resolveBaseUrl('', 'http://localhost')).toThrow(/baseUrl is empty/);
    // `http://` has no host — unparseable even against a base.
    expect(() => resolveBaseUrl('http://', 'http://localhost')).toThrow(/not a valid URL/);
  });
});
