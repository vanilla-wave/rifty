import { test } from '@playwright/test';

test.describe('M10 — dev-mode HMR over cross-realm bridge (ADR-0095)', () => {
  test.skip('dev-hmr preset was retired when playground moved to visible real Vite terminals', async () => {
    // Real Vite HMR remains covered by apps/playground unit tests and the
    // opt-in m10-hmr browser spec (`RIFTY_E2E_HMR=1`).
  });
});
