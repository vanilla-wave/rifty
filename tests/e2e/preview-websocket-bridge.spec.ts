/**
 * Non-vite WebSocket through the generic preview bridge (ADR-0189, backlog
 * net/preview-websocket-bridge).
 *
 * A bare npm `ws` echo server rides an untouched node:http server (socket-lab
 * preset); the PREVIEW page opens a plain browser
 * `new WebSocket('ws://localhost:<port>/ws')` — an EXPLICIT loopback URL, not
 * location.host — and round-trips a message. Proves the two generic halves
 * with zero per-tool glue: text/html script injection at the cross-realm
 * preview path, and the guest-port remap from the /preview/<port>/ prefix
 * (the discovery channel keys on the prefix port regardless of the URL port).
 */
import { expect, test } from '@playwright/test';
import { expectTerminalContains, pickStarter } from './helpers/playground.ts';

const PORT = 3220;

test.describe('preview WebSocket bridge — non-vite ws echo', () => {
  test('preview page round-trips an explicit ws://localhost URL through the injected bridge', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    page.on('pageerror', (err) => console.log('[pageerror]', err.message));
    await page.goto('/');
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, {
      timeout: 15_000,
    });
    await pickStarter(page, 'socket-lab');
    await expectTerminalContains(page, `socket lab listening on port ${PORT}`, 180_000);

    const frame = page.frameLocator(`iframe[title="Preview port ${PORT}"]`);
    await expect(frame.locator('h1')).toHaveText('Socket capability matrix', { timeout: 60_000 });
    // Generic injection: marker-guarded head-prepend into every text/html doc.
    await expect(frame.locator('script[data-rifty-ws-bridge]')).toHaveCount(1, {
      timeout: 30_000,
    });

    // One connection, full lifecycle: echo round-trip, then a SERVER-initiated
    // close(code, reason) whose CloseEvent must arrive faithful through the
    // bridge (backlog parity case 2 extended to the preview path).
    const result = await frame.locator('body').evaluate(
      (_el, port) =>
        new Promise<{ echo: string; code: number; reason: string; wasClean: boolean }>(
          (resolve, reject) => {
            const ws = new WebSocket(`ws://localhost:${port}/ws`);
            let echo = '';
            const timer = setTimeout(() => {
              ws.close();
              reject(new Error(echo === '' ? 'no echo within 15s' : 'no close event within 15s'));
            }, 15_000);
            ws.onopen = () => ws.send('bridge-probe');
            ws.onmessage = (event) => {
              echo = String(event.data);
              ws.send('close:4321:e2e-close');
            };
            ws.onerror = () => {
              clearTimeout(timer);
              reject(new Error('websocket error before echo'));
            };
            ws.onclose = (event) => {
              clearTimeout(timer);
              if (echo === '') {
                reject(new Error(`closed before echo: code=${event.code}`));
                return;
              }
              resolve({
                echo,
                code: event.code,
                reason: event.reason,
                wasClean: event.wasClean,
              });
            };
          },
        ),
      PORT,
    );
    expect(result.echo).toBe('echo:bridge-probe');
    expect(result.code).toBe(4321);
    expect(result.reason).toBe('e2e-close');
    expect(result.wasClean).toBe(true);
  });
});
