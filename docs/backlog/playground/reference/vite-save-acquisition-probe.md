# Vite Save acquisition probe

Recorded 2026-07-26 on source SHA `21ef860795ae8843ec2d3622020ccdad1dc96534`
(the probe branch changed docs only), Playwright 1.60.0, Chromium
148.0.7778.96, and the checked-in guest Vite 7.3.6 snapshot.

Extract the retained probe into the e2e test directory and run it:

```sh
probe=tests/e2e/.vite-save-acquisition-probe.spec.ts
awk '/^```ts e2e-probe$/{copy=1;next}/^```$/{if(copy) exit}copy' \
  docs/backlog/playground/reference/vite-save-acquisition-probe.md > "$probe"
pnpm exec playwright test "$probe" --project=chromium-light --workers=1
rm "$probe"
```

```ts e2e-probe
import { expect, test } from '@playwright/test';
import {
  bootProjectFiles,
  expectViteDevServerReady,
  openShellTerminal,
  readActiveProjectText,
  runTerminalLineSettled,
} from './helpers/playground.ts';

test('records current Save acquisition and exact-tree loss', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'workspace owner is COI/SAB-gated — chromium only');
  test.setTimeout(240_000);

  await bootProjectFiles(page);
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, {
    timeout: 15_000,
  });
  await expectViteDevServerReady(page, 5174, 120_000);
  await openShellTerminal(page);
  await runTerminalLineSettled(
    page,
    "mkdir -p /node_modules/.vite-save-probe && echo exact-before-save > /node_modules/.vite-save-probe/marker.txt",
    30_000,
  );

  const snapshotRequests: string[] = [];
  page.context().on('request', (request) => {
    if (new URL(request.url()).pathname === '/snapshots/vite-node-modules.json.gz') {
      snapshotRequests.push(request.url());
    }
  });

  await page.click('[data-action="open-launcher"]');
  await page.getByRole('button', { name: /^Projects/ }).click();
  await page.locator('[data-action="save-scratch"]').click();
  const dialog = page.locator('.rf-dialog[role="dialog"]');
  await dialog.locator('input.rf-dialog__input').fill(`Probe-${String(Date.now())}`);
  await dialog.getByRole('button', { name: 'Save project' }).click();
  await expect(dialog).toHaveCount(0, { timeout: 120_000 });
  await page.locator('.rf-launcher__close').click();
  await expectViteDevServerReady(page, 5174, 120_000);

  await openShellTerminal(page);
  const marker = await readActiveProjectText(
    page,
    'node_modules/.vite-save-probe/marker.txt',
    30_000,
  );
  console.log(
    `SAVE_PROBE ${JSON.stringify({
      snapshotRequests: snapshotRequests.map((url) => new URL(url).pathname),
      marker,
    })}`,
  );

  expect(snapshotRequests.map((url) => new URL(url).pathname)).toEqual([
    '/snapshots/vite-node-modules.json.gz',
  ]);
  expect(marker).toEqual({ exists: false, text: '' });
});
```

Observed output:

```text
SAVE_PROBE {"snapshotRequests":["/snapshots/vite-node-modules.json.gz"],"marker":{"exists":false,"text":""}}
1 passed
```

The request listener starts only after the first Vite LIVE state, so the
captured snapshot request belongs to Scratch→named Save. The unique ordinary
`node_modules` marker exists immediately before Save and is absent afterward:
the copied target is reacquired rather than reused exactly.
