import { describe, expect, it } from 'vitest';
import { hostOriginFromLine } from './shadow-asset-cold-packed-host.mjs';

describe('packed shadow-asset cold host readiness', () => {
  it('ignores non-marker output and accepts one exact loopback origin marker', () => {
    expect(hostOriginFromLine('$ pnpm build')).toBeNull();
    expect(
      hostOriginFromLine('RIFTY_SHADOW_ASSET_COLD_HOST={"origin":"http://127.0.0.1:43127"}'),
    ).toBe('http://127.0.0.1:43127');
  });

  it.each([
    'RIFTY_SHADOW_ASSET_COLD_HOST=not-json',
    'RIFTY_SHADOW_ASSET_COLD_HOST={}',
    'RIFTY_SHADOW_ASSET_COLD_HOST={"origin":"data:text/plain,no"}',
  ])('rejects malformed readiness %s', (line) => {
    expect(() => hostOriginFromLine(line)).toThrow(/readiness|origin|http/i);
  });
});
