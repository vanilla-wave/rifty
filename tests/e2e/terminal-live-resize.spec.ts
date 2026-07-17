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

interface Dimensions {
  readonly cols: number;
  readonly rows: number;
}

function lastDimensions(buffer: string, marker: string): Dimensions | undefined {
  const matches = Array.from(buffer.matchAll(new RegExp(`${marker}:(\\d+)x(\\d+)`, 'gu')));
  const match = matches.at(-1);
  if (!match) return undefined;
  return { cols: Number(match[1]), rows: Number(match[2]) };
}

test('visible xterm resize reaches the real owner child before SIGWINCH', async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', 'workspace owner is COI/SAB-gated — chromium only');
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1100, height: 720 });
  await bootProjectFiles(page);
  await expectViteDevServerReady(page, 5174, 90_000);
  const slot = await openShellTerminal(page);
  await page.evaluate(() => document.fonts.ready);

  const source =
    'process.stdout.write("READY:"+process.stdout.columns+"x"+process.stdout.rows+"\\n");' +
    'process.stdout.on("resize",()=>process.stdout.write("RESIZE:"+process.stdout.columns+"x"+process.stdout.rows+"\\n"));' +
    'process.on("SIGWINCH",()=>process.stdout.write("SIGWINCH:"+process.stdout.columns+"x"+process.stdout.rows+"\\n"));' +
    'setInterval(()=>{},1000);';
  await runTerminalLineSettled(page, `echo '${source}' > terminal-live-resize.js`, 20_000);
  await runTerminalLine(page, 'node terminal-live-resize.js', slot);

  await expect
    .poll(async () => lastDimensions(await terminalBuffer(page, slot), 'READY'), {
      timeout: 20_000,
    })
    .toBeDefined();
  const initial = lastDimensions(await terminalBuffer(page, slot), 'READY');
  if (!initial) throw new Error('Node child did not report initial terminal dimensions');

  await page.setViewportSize({ width: 1500, height: 720 });
  await expect
    .poll(
      async () => {
        const buffer = await terminalBuffer(page, slot);
        const resized = lastDimensions(buffer, 'RESIZE');
        const signaled = lastDimensions(buffer, 'SIGWINCH');
        return (
          resized !== undefined &&
          signaled !== undefined &&
          (resized.cols !== initial.cols || resized.rows !== initial.rows) &&
          resized.cols === signaled.cols &&
          resized.rows === signaled.rows &&
          buffer.lastIndexOf('RESIZE:') < buffer.lastIndexOf('SIGWINCH:')
        );
      },
      { timeout: 20_000 },
    )
    .toBe(true);

  await page.locator('.rf-terminal-slot[data-active="true"] [data-testid="terminal"]').click();
  await page.keyboard.press('Control+c');
  await runTerminalLineSettled(page, 'echo resize-session-recovered', 20_000);
  await expectTerminalContains(page, 'resize-session-recovered', 10_000);
});
