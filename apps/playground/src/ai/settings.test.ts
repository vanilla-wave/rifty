import { describe, expect, it } from 'vitest';
import { type ChatSettings, newModel, sessionCatalog } from './settings.ts';

const settings = (headers: Record<string, string>): ChatSettings => ({
  models: [{ ...newModel('first', 'https://model.invalid/v1'), headers }],
  model: 'first',
  apiKeys: {},
  maxToolCalls: 100,
  runTimeoutMs: 600_000,
});

describe('sessionCatalog secrets', () => {
  it('declares credential-named header values, raw and as the bare Bearer token', () => {
    const { secrets } = sessionCatalog(
      settings({
        Authorization: 'Bearer auth-token',
        'X-Api-Key': 'bearer api-key-value',
        api_key: 'underscore-key',
        'X-Auth-Token': 'plain-token',
        'X-Client-Secret': 'client-secret',
      }),
    );
    expect(new Set(secrets)).toEqual(
      new Set([
        'Bearer auth-token',
        'auth-token',
        'bearer api-key-value',
        'api-key-value',
        'underscore-key',
        'plain-token',
        'client-secret',
      ]),
    );
  });

  it('ordinary headers are not secrets', () => {
    const { secrets } = sessionCatalog(
      settings({ 'X-Title': 'rifty', 'HTTP-Referer': 'https://rifty.invalid', 'X-Edit': 'edit' }),
    );
    expect(secrets).toEqual([]);
  });
});
