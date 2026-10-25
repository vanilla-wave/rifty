import { expect, test } from '@playwright/test';
import { pickStarter } from './helpers/playground.ts';

test.describe('Preview readiness and physical process state', () => {
  test('[fault: provenance-lie] a failed routed proof keeps the live project stoppable until physical exit', async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'workspace owner is COI/SAB-gated — chromium only');
    test.setTimeout(180_000);

    await page.addInitScript(() => {
      const state = {
        failures: [] as string[],
        rejections: 0,
      };
      Object.defineProperty(globalThis, '__riftyPreviewProbeFault', {
        configurable: true,
        value: state,
      });
      const nativeFetch = globalThis.fetch;
      globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
        const value = typeof input === 'string' || input instanceof URL ? String(input) : input.url;
        const url = new URL(value, globalThis.location.href);
        if (
          state.failures.length === 0 &&
          url.pathname === '/preview/5174/' &&
          init?.cache === 'no-store'
        ) {
          state.rejections += 1;
          return Promise.reject(new Error('injected preview routed-proof failure'));
        }
        return nativeFetch(input, init);
      }) as typeof globalThis.fetch;
      const observeFailures = (): void => {
        const collect = (): void => {
          for (const node of document.querySelectorAll('.rf-toast[data-tone="error"]')) {
            const message = node.textContent ?? '';
            if (message.includes('Project start failed:') && !state.failures.includes(message)) {
              state.failures.push(message);
            }
          }
        };
        new MutationObserver(collect).observe(document.documentElement, {
          childList: true,
          subtree: true,
          characterData: true,
        });
        collect();
      };
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', observeFailures, { once: true });
      } else {
        observeFailures();
      }
    });
    await page.goto('/');
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, {
      timeout: 30_000,
    });

    await pickStarter(page, 'project-files');
    await expect(page.locator('.rf-livepill')).toContainText('LIVE :5174', {
      timeout: 90_000,
    });
    const faultState = await page.evaluate(
      () =>
        (
          globalThis as typeof globalThis & {
            __riftyPreviewProbeFault?: {
              failures: string[];
              rejections: number;
            };
          }
        ).__riftyPreviewProbeFault,
    );
    expect(faultState?.rejections, JSON.stringify(faultState)).toBeGreaterThan(0);
    expect(faultState?.failures, JSON.stringify(faultState)).toContain(
      'Project start failed: injected preview routed-proof failure',
    );
    await page.locator('[data-action="open-palette"]').click();
    const stopProject = page.getByRole('button', { name: 'Stop project', exact: true });
    await expect(stopProject).toBeEnabled();
    await stopProject.click();

    await expect(page.locator('.rf-livepill')).not.toHaveAttribute('data-state', 'running', {
      timeout: 60_000,
    });
  });
});
