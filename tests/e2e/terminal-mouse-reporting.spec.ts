import { test } from '@playwright/test';

test.describe('Terminal mouse reporting', () => {
  test.skip('foreground stdin is not wired through the visible multi-terminal shell yet', async () => {
    // ADR-0122 keeps raw stdin/mouse ownership separate from the line-mode shell.
  });
});
