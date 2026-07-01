import { expect, test } from '@playwright/test';
import {
  bootProjectFiles,
  expectTerminalContains,
  expectViteDevServerReady,
  openShellTerminal,
  runTerminalLine,
  runTerminalLineSettled,
  terminalBuffer,
} from './helpers/playground.ts';

test.describe('honest vite command dispatch', () => {
  test('vite resolves to the installed binary and loads real config', async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'workspace owner is COI/SAB-gated - chromium only');
    test.setTimeout(240_000);

    await bootProjectFiles(page);
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, {
      timeout: 15_000,
    });
    await expectViteDevServerReady(page, 5174, 90_000);

    await openShellTerminal(page);
    await runTerminalLine(page, 'which vite');
    await expectTerminalContains(page, '/scratch/node_modules/.bin/vite', 20_000);

    await runTerminalLine(page, 'vite --help');
    await expectTerminalContains(page, /Usage:\s+\$ vite \[root\]/, 20_000);
    expect(await terminalBuffer(page)).not.toContain('not supported in rifty yet');
    expect(await terminalBuffer(page)).not.toContain('vite.config-loading');

    await runTerminalLine(
      page,
      `printf "export default { define: { __RIFTY_CONFIG_MARKER__: JSON.stringify('from-config') } }\\n" > /scratch/vite.config.js`,
    );
    await runTerminalLine(
      page,
      `printf "document.getElementById('app').textContent = __RIFTY_CONFIG_MARKER__;\\n" > /scratch/src/main.js`,
    );
    await runTerminalLineSettled(page, 'vite build', 120_000);
    await runTerminalLine(page, 'grep from-config dist/assets/*.js');
    await expectTerminalContains(page, 'from-config', 20_000);
  });
});
