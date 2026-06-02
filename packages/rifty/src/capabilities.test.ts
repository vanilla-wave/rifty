import { describe, expect, it } from 'vitest';
import { checkCapabilities } from './capabilities.ts';

describe('checkCapabilities', () => {
  it('delegates to detectCapabilities and returns a full CapabilityCheck', () => {
    const check = checkCapabilities();
    // The six probed features must all be present as booleans (no missing key).
    expect(Object.keys(check.capabilities).sort()).toEqual(
      [
        'atomicsWaitAsync',
        'crossOriginIsolated',
        'opfsSyncAccessHandle',
        'serviceWorker',
        'sharedArrayBuffer',
        'worker',
      ].sort(),
    );
    expect(typeof check.sufficient).toBe('boolean');
    expect(typeof check.summary).toBe('string');
    // `missing` is exactly the falsy capabilities (catches a broken wrapper
    // that returns a hand-rolled object instead of the real probe).
    for (const key of check.missing) {
      expect(check.capabilities[key]).toBe(false);
    }
  });
});
