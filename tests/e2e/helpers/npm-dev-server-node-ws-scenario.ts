import { type Page, expect } from '@playwright/test';
import { expectTerminalContains, openShellTerminal, runTerminalLineSettled } from './playground.ts';

const PORT = 5191;
const PRESET_ID = 'npm-dev-server-node-ws';
const FORBIDDEN_TERMINAL_FAILURE =
  /Invalid Origin|NotImplementedError|EADDRINUSE|SabRing|webpack serve/u;

interface PreviewResponse {
  readonly status: number;
  readonly contentType: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
  readonly error: string;
}

interface ProjectStartFailureRecorder {
  readonly failures: string[];
  readonly observer: MutationObserver;
}

async function installProjectStartFailureRecorder(page: Page): Promise<void> {
  await page.evaluate(() => {
    const global = globalThis as typeof globalThis & {
      __riftyProjectStartFailureRecorder?: ProjectStartFailureRecorder;
    };
    global.__riftyProjectStartFailureRecorder?.observer.disconnect();
    const failures: string[] = [];
    const collect = (): void => {
      for (const node of document.querySelectorAll('.rf-toast[data-tone="error"]')) {
        const message = node.textContent ?? '';
        if (message.includes('Project start failed:') && !failures.includes(message)) {
          failures.push(message);
        }
      }
    };
    const observer = new MutationObserver(collect);
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    global.__riftyProjectStartFailureRecorder = { failures, observer };
    collect();
  });
}

async function projectStartFailures(page: Page): Promise<readonly string[]> {
  return page.evaluate(() => {
    const global = globalThis as typeof globalThis & {
      __riftyProjectStartFailureRecorder?: ProjectStartFailureRecorder;
    };
    return [...(global.__riftyProjectStartFailureRecorder?.failures ?? [])];
  });
}

function shellWord(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

async function fetchPreview(page: Page, path = ''): Promise<PreviewResponse> {
  return page.evaluate(
    async ({ path, port }) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8_000);
      try {
        const response = await fetch(`/preview/${String(port)}/${path}`, {
          cache: 'no-store',
          signal: controller.signal,
        });
        return {
          status: response.status,
          contentType: response.headers.get('content-type') ?? '',
          headers: Object.fromEntries(response.headers.entries()),
          body: await response.text(),
          error: '',
        };
      } catch (error) {
        return {
          status: 0,
          contentType: '',
          headers: {},
          body: '',
          error: error instanceof Error ? error.message : String(error),
        };
      } finally {
        clearTimeout(timer);
      }
    },
    { path, port: PORT },
  );
}

async function allTerminalBuffers(page: Page): Promise<string> {
  return page
    .locator('[data-testid="terminal-buffer"]')
    .evaluateAll((nodes) =>
      nodes
        .map(
          (node, index) =>
            `[terminal ${String(index + 1)}]\n${node.getAttribute('data-terminal-buffer') ?? ''}`,
        )
        .join('\n'),
    );
}

async function expectNoLoudFailure(page: Page, hostProblems: readonly string[]): Promise<void> {
  expect(hostProblems, 'preview page and host console must stay error-free').toEqual([]);
  expect(await allTerminalBuffers(page)).not.toMatch(FORBIDDEN_TERMINAL_FAILURE);
}

/**
 * Hosted-lane class-proof that `kind: 'npm-dev-server'` is not webpack-shaped:
 * deep-link a hidden fixture whose `scripts.dev` is `node server.mjs`, then
 * prove LIVE + HTTP 200 + WS through the generic preview bridge.
 */
export async function runNpmDevServerNodeWsScenario(page: Page): Promise<void> {
  const hostProblems: string[] = [];
  page.on('pageerror', (error) => hostProblems.push(`[pageerror] ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') hostProblems.push(`[console.error] ${message.text()}`);
  });

  await page.goto(`/?preset=${PRESET_ID}`);
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, {
    timeout: 30_000,
  });
  await installProjectStartFailureRecorder(page);

  await expectTerminalContains(page, '> node server.mjs', 120_000);
  expect(await allTerminalBuffers(page)).not.toMatch(/webpack serve/u);

  const livePill = page.locator('.rf-livepill[data-state="running"]', {
    hasText: `LIVE :${String(PORT)}`,
  });
  try {
    await expect(livePill).toBeVisible({ timeout: 120_000 });
  } catch (error) {
    console.log(`[npm-dev-server-node-ws terminals]\n${await allTerminalBuffers(page)}`);
    throw error;
  }
  expect(
    await projectStartFailures(page),
    'empty install must not report a false startup failure',
  ).toEqual([]);

  let home: PreviewResponse = { status: 0, contentType: '', headers: {}, body: '', error: '' };
  try {
    await expect
      .poll(
        async () => {
          home = await fetchPreview(page);
          return home.status;
        },
        {
          message: 'node-ws preview did not reach HTTP 200',
          timeout: 60_000,
          intervals: [250, 500, 1_000, 2_000],
        },
      )
      .toBe(200);
  } catch (error) {
    console.log(
      `[node-ws preview response]\n${JSON.stringify(home)}\n[node-ws host problems]\n${hostProblems.join('\n')}\n[npm-dev-server-node-ws terminals]\n${await allTerminalBuffers(page)}`,
    );
    throw error;
  }
  expect(home.contentType).toContain('text/html');
  expect(home.body).toContain('data-rifty-ws-bridge');
  expect(home.body).not.toMatch(/webpack/i);

  const pageOrigin = await page.evaluate(() => globalThis.location.origin);
  await openShellTerminal(page);
  await runTerminalLineSettled(page, 'grep ALLOWED_ORIGIN server.mjs', 30_000);
  await expectTerminalContains(page, `ALLOWED_ORIGIN = ${JSON.stringify(pageOrigin)}`, 15_000);
  await runTerminalLineSettled(page, 'cat package.json', 30_000);
  await expectTerminalContains(page, /"dev"\s*:\s*"node server\.mjs"/u, 15_000);
  expect(await allTerminalBuffers(page)).not.toMatch(/webpack serve/u);

  const iframe = page.locator(`iframe[title="Preview port ${String(PORT)}"]`);
  const frame = page.frameLocator(`iframe[title="Preview port ${String(PORT)}"]`);
  const frameBody = frame.locator('body');
  await expect(iframe).toHaveCount(1);
  await expect(frame.locator('h1')).toHaveText('node-ws ready', { timeout: 60_000 });
  await expectNoLoudFailure(page, hostProblems);
  await expect(frame.locator('script[data-rifty-ws-bridge]')).toHaveCount(1);
  await expect
    .poll(
      () =>
        frameBody.evaluate(
          () =>
            (globalThis as typeof globalThis & { __riftyWsBridgeOpen?: unknown })
              .__riftyWsBridgeOpen,
        ),
      { timeout: 30_000 },
    )
    .toBe(true);

  const identity = `node-ws-${String(Date.now())}`;
  await iframe.evaluate(
    (element, value) => element.setAttribute('data-e2e-identity', value),
    identity,
  );

  const previewFrame = page
    .frames()
    .find((candidate) => candidate.url().includes(`/preview/${String(PORT)}/`));
  if (previewFrame === undefined) throw new Error(`preview frame for :${String(PORT)} is missing`);
  let previewNavigations = 0;
  page.on('framenavigated', (candidate) => {
    if (candidate === previewFrame) previewNavigations += 1;
  });

  const updatedText = `node-ws-updated-${String(Date.now())}`;
  await runTerminalLineSettled(
    page,
    `printf %s ${shellWord(updatedText)} > public/message.txt`,
    30_000,
  );

  await expect(frame.locator('h1')).toHaveText(updatedText, { timeout: 30_000 });
  await expect(iframe).toHaveAttribute('data-e2e-identity', identity);
  expect(previewNavigations).toBe(0);
  await expectNoLoudFailure(page, hostProblems);
}
