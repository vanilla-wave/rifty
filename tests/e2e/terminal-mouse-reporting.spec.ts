import { test } from '@playwright/test';

test.describe('Terminal mouse reporting', () => {
  test.skip('raw-mode foreground ownership and mouse reporting are not implemented', async () => {
    // ADR-0230 wires cooked chunk input; ADR-0122 keeps raw mode/mouse separate.
  });
});
