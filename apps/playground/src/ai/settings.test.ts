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
        'Ocp-Apim-Subscription-Key': 'azure-subscription',
        Cookie: 'sid=cookie-session',
        'X-Session-Id': 'session-identifier',
        'X-Key': 'short-key',
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
        'azure-subscription',
        'sid=cookie-session',
        'session-identifier',
        'short-key',
      ]),
    );
  });

  it('values under 8 characters are not declared: masking `5` would corrupt `500: …`', () => {
    const { secrets } = sessionCatalog(
      settings({
        'X-Session-Pool': '5',
        'X-Key': 'short',
        'X-Session-Token': 'abcdefgh',
        Authorization: 'Bearer abc',
      }),
    );
    expect(new Set(secrets)).toEqual(new Set(['abcdefgh', 'Bearer abc']));
  });

  it('ordinary headers are not secrets', () => {
    const { secrets } = sessionCatalog(
      settings({
        'X-Title': 'rifty',
        'HTTP-Referer': 'https://rifty.invalid',
        'Content-Type': 'application/json',
        'X-Edit': 'edit',
      }),
    );
    expect(secrets).toEqual([]);
  });
});
