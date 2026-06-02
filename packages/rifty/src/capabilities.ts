import {
  type Capabilities,
  type CapabilityCheck,
  detectCapabilities,
} from '@rifty/runtime-js/env/capabilities';

export type { Capabilities, CapabilityCheck };

/**
 * Probe the current realm for the Web-platform features rifty needs:
 * cross-origin isolation, `SharedArrayBuffer`, `Atomics.waitAsync`, OPFS sync
 * access handles, `ServiceWorker`, and `Worker`. Pure — no side effects.
 *
 * Use it as a preflight gate before {@link createSandbox}: render a "your
 * browser is missing X" notice when `check.sufficient` is false instead of
 * letting boot throw (EPIC B / B3). Thin wrapper over runtime-js
 * `detectCapabilities`, surfaced here so the umbrella is the single import
 * surface a consumer reaches for.
 */
export function checkCapabilities(): CapabilityCheck {
  return detectCapabilities();
}
