import { test } from '@playwright/test';
import { expectTerminalContains } from './helpers/playground.ts';

// The `?preset=<id>&autorun=1` deep-link (shareable launch URL + the perf
// harness, docs/backlog/perf/cold-start-and-install-benchmark): a cold tab boots
// straight into the preset and, with autorun=1, runs its boot lines.
//
// `real-vite` is a from-scratch preset → its boot lines run `npm install && npm
// run dev`. The DEFAULT preset (`project-files`, setup:'instant') never installs,
// so `npm install` in the terminal proves BOTH that the deep-link applied
// real-vite AND that autorun fired — i.e. without the deep-link wiring this page
// would boot the default and never print `npm install` (the RED state).
test('?preset=real-vite&autorun=1 cold-boots real-vite and auto-installs', async ({ page }) => {
  await page.goto('/?preset=real-vite&autorun=1');
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, {
    timeout: 20_000,
  });
  await expectTerminalContains(page, /npm install/u, 90_000);
});
