import { expect, test } from '@playwright/test';
import {
  expectTerminalContains,
  pickStarter,
  runTerminalLineSettled,
  terminalBuffer,
} from '../e2e/helpers/playground.ts';

function occurrences(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

test.describe('production build — admitted nodemon terminal outcome', () => {
  test('a late --exitcrash peer death drains and settles without a direct-node fallback', async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'workspace owner is COI/SAB-gated — chromium only');
    test.setTimeout(600_000);
    await page.goto('/');
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, {
      timeout: 15_000,
    });
    expect(await page.evaluate(() => globalThis.crossOriginIsolated)).toBe(true);

    await pickStarter(page, 'express-sqlite');
    await expectTerminalContains(
      page,
      '> nodemon --legacy-watch --no-stdin --no-update-notifier src/main.js',
      150_000,
    );
    await expectTerminalContains(page, '[nodemon] starting `node src/main.js`', 120_000);
    await expect(page.locator('.rf-livepill')).toHaveAttribute('data-state', 'running', {
      timeout: 180_000,
    });

    await page.getByRole('tab', { name: 'Express + SQLite scratch', exact: true }).click();
    const terminal = page.locator('.rf-terminal-slot[data-active="true"] [data-testid="terminal"]');
    await terminal.click();
    await page.keyboard.press('Control+c');

    const marker = `PROD_NODEMON_LATE_EXIT_${Date.now()}`;
    await runTerminalLineSettled(
      page,
      `echo "setTimeout(() => { throw new Error('late admitted crash'); }, 750);" > src/exitcrash.js`,
      45_000,
    );
    await runTerminalLineSettled(
      page,
      `echo '{"name":"late-exit","private":true,"type":"module","scripts":{"dev":"nodemon --legacy-watch --no-stdin --no-update-notifier --exitcrash src/exitcrash.js"}}' > package.json`,
      45_000,
    );
    await runTerminalLineSettled(
      page,
      `npm run dev && echo ${marker}_UNEXPECTED || echo ${marker}_SETTLED`,
      90_000,
    );

    const buffer = await terminalBuffer(page, 0);
    expect(occurrences(buffer, `${marker}_SETTLED`)).toBe(2);
    expect(occurrences(buffer, `${marker}_UNEXPECTED`)).toBe(1);
    expect(buffer).toContain('late admitted crash');
    expect(buffer).not.toContain('supervisor exited before Ctrl-C');
  });
});
