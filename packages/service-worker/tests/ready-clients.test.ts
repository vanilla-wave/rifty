/**
 * Unit tests for the {@link createReadyClientsRegistry} factory. The full
 * SW state-machine behaviour (queueing, ready timeout, goodbye, mismatch) is
 * exercised end-to-end via `createPreviewInterceptor` in
 * `preview-handshake-sw.test.ts`; this file covers the per-registry concerns
 * that are easier to assert directly — chief among them that each registry
 * instance owns its own outbound request-id counter so parallel interceptors
 * (tests, multi-realm setups) don't share monotonically-increasing state.
 */
import { describe, expect, it } from 'vitest';
import { createReadyClientsRegistry } from '../src/ready-clients.ts';

describe('createReadyClientsRegistry', () => {
  it('allocates request ids starting at 1 and increments per call', () => {
    const registry = createReadyClientsRegistry({ warn: () => {} });
    expect(registry.nextRequestId()).toBe(1);
    expect(registry.nextRequestId()).toBe(2);
    expect(registry.nextRequestId()).toBe(3);
  });

  it('keeps request-id counters independent across registry instances', () => {
    const a = createReadyClientsRegistry({ warn: () => {} });
    const b = createReadyClientsRegistry({ warn: () => {} });
    expect(a.nextRequestId()).toBe(1);
    expect(a.nextRequestId()).toBe(2);
    // `b` must NOT inherit `a`'s counter — otherwise concurrent interceptors
    // would emit overlapping requestIds and the reply correlator would route
    // a response to the wrong handler.
    expect(b.nextRequestId()).toBe(1);
    expect(a.nextRequestId()).toBe(3);
    expect(b.nextRequestId()).toBe(2);
  });
});
