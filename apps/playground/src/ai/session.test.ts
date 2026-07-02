import { describe, expect, it } from 'vitest';
import { explainRunError, modelFromSettings } from './session.ts';
import { AI_SETTINGS_DEFAULTS } from './settings.ts';

describe('explainRunError', () => {
  it('names the dev CORS proxy escape hatch on browser fetch failures', () => {
    const out = explainRunError('Failed to fetch', 'https://api.anthropic.com/v1');
    expect(out).toContain('https://api.anthropic.com/v1');
    expect(out).toContain('RIFTY_AI_PROXY_TARGET');
    expect(out).toContain('/ai-proxy/v1');
  });

  it('passes non-network errors through unchanged', () => {
    expect(explainRunError('401 Unauthorized', 'https://x/v1')).toBe('401 Unauthorized');
  });
});

describe('modelFromSettings', () => {
  it('builds the openai-completions model with a resolved same-origin proxy baseUrl', () => {
    const model = modelFromSettings(
      { ...AI_SETTINGS_DEFAULTS, baseUrl: '/ai-proxy/v1', model: 'llama-3.3-70b' },
      'http://localhost:5273',
    );
    expect(model).toMatchObject({
      id: 'llama-3.3-70b',
      api: 'openai-completions',
      provider: 'custom',
      baseUrl: 'http://localhost:5273/ai-proxy/v1',
      reasoning: false,
    });
  });

  it('throws (via resolveBaseUrl) on an empty baseUrl', () => {
    expect(() =>
      modelFromSettings({ ...AI_SETTINGS_DEFAULTS, model: 'm' }, 'http://localhost'),
    ).toThrow(/baseUrl is empty/);
  });
});
