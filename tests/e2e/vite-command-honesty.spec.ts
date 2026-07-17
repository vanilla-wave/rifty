import { expect, test } from '@playwright/test';
import {
  bootProjectFiles,
  bootStarter,
  expectTerminalContains,
  expectViteDevServerReady,
  openShellTerminal,
  runTerminalLine,
  runTerminalLineSettled,
  terminalBuffer,
} from './helpers/playground.ts';

test.describe('honest vite command dispatch', () => {
  test('fresh rooted Vite does not restart on its config temp file', async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'workspace owner is COI/SAB-gated - chromium only');
    test.setTimeout(180_000);

    await bootStarter(page, 'node-worker');
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, {
      timeout: 15_000,
    });
    await expectViteDevServerReady(page, 5174, 90_000);
    const output = page.locator(
      '.rf-terminal-slot[data-active="true"] [data-testid="terminal-buffer"]',
    );
    const observed = await output.evaluate(
      (element, durationMs) =>
        new Promise<string>((resolve) => {
          const samples: string[] = [];
          const sample = () => samples.push(element.getAttribute('data-terminal-buffer') ?? '');
          sample();
          const observer = new MutationObserver(sample);
          observer.observe(element, {
            attributes: true,
            attributeFilter: ['data-terminal-buffer'],
          });
          globalThis.setTimeout(() => {
            observer.disconnect();
            sample();
            resolve(samples.join('\n'));
          }, durationMs);
        }),
      5_000,
    );

    expect(observed).not.toMatch(
      /vite\.config\.js[^\r\n]*changed, restarting server|server restarted\./u,
    );
  });

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
    await expectTerminalContains(page, '/node_modules/.bin/vite', 20_000);

    await runTerminalLine(page, 'vite --help');
    await expectTerminalContains(page, /Usage:\s+\$ vite \[root\]/, 20_000);
    expect(await terminalBuffer(page)).not.toContain('not supported in rifty yet');
    expect(await terminalBuffer(page)).not.toContain('vite.config-loading');

    await runTerminalLine(
      page,
      `printf "export default { define: { __RIFTY_CONFIG_MARKER__: JSON.stringify('from-config') } }\\n" > vite.config.js`,
    );
    await runTerminalLine(
      page,
      `printf "document.getElementById('app').textContent = __RIFTY_CONFIG_MARKER__;\\n" > src/main.js`,
    );
    await runTerminalLineSettled(page, 'vite build', 120_000);
    await runTerminalLine(page, 'grep from-config dist/assets/*.js');
    await expectTerminalContains(page, 'from-config', 20_000);
  });
});
