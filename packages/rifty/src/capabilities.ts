import {
  type Capabilities,
  type CapabilityCheck,
  detectCapabilities,
} from '@riftydev/runtime-js/env/capabilities';

export type { Capabilities, CapabilityCheck };

/**
 * Pure synchronous current-realm presence report. `sufficient` means only
 * Worker + ServiceWorker globals exist; permissions, CSP, owner-realm storage
 * and successful startup are unproved. For active COI Workbench / non-COI
 * toolchain prerequisites, use `checkSandboxSupport` from @riftydev/workbench.
 */
export function checkCapabilities(): CapabilityCheck {
  return detectCapabilities();
}
