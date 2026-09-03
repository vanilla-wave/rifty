import { type Page, expect } from '@playwright/test';
import {
  expectTerminalContains,
  openShellTerminal,
  pickStarter,
  runTerminalLineSettled,
  terminalBuffer,
} from './playground.ts';

const PORT = 5184;
const FORBIDDEN_TERMINAL_FAILURE =
  /Invalid Host\/Origin|NotImplementedError|EADDRINUSE|Watchpack Error|SabRing/u;

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
 * Same black-box journey under the development host and the emitted production
 * artifact. Each Playwright test gets a fresh isolated browser context; the
 * from-scratch starter must therefore perform a visible real npm install before
 * webpack can serve or open its stock HMR WebSocket.
 */
export async function runWebpackDevServerScenario(page: Page): Promise<void> {
  const hostProblems: string[] = [];
  page.on('pageerror', (error) => hostProblems.push(`[pageerror] ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') hostProblems.push(`[console.error] ${message.text()}`);
  });

  await page.goto('/');
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, {
    timeout: 30_000,
  });
  await installProjectStartFailureRecorder(page);
  await pickStarter(page, 'webpack-dev-server');

  await expectTerminalContains(page, 'npm: + webpack@', 180_000);
  await expectTerminalContains(page, 'npm: + webpack-dev-server@', 180_000);
  await expectTerminalContains(page, '> webpack serve', 120_000);

  const livePill = page.locator('.rf-livepill[data-state="running"]', {
    hasText: `LIVE :${String(PORT)}`,
  });
  try {
    await expect(livePill).toBeVisible({ timeout: 180_000 });
  } catch (error) {
    console.log(`[webpack-dev-server terminals]\n${await allTerminalBuffers(page)}`);
    throw error;
  }
  expect(
    await projectStartFailures(page),
    'cold install must not report a false startup failure',
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
          message: 'webpack preview did not reach HTTP 200',
          timeout: 120_000,
          intervals: [250, 500, 1_000, 2_000],
        },
      )
      .toBe(200);
  } catch (error) {
    console.log(
      `[webpack preview response]\n${JSON.stringify(home)}\n[webpack host problems]\n${hostProblems.join('\n')}\n[webpack-dev-server terminals]\n${await allTerminalBuffers(page)}`,
    );
    throw error;
  }
  expect(home.contentType).toContain('text/html');
  expect(home.body).toContain('main.js');
  expect(home.body).toContain('data-rifty-ws-bridge');

  const iframe = page.locator(`iframe[title="Preview port ${String(PORT)}"]`);
  const frame = page.frameLocator(`iframe[title="Preview port ${String(PORT)}"]`);
  const frameBody = frame.locator('body');
  await expect(iframe).toHaveCount(1);
  try {
    await expect(frame.locator('h1')).toHaveText('Create App style project', {
      timeout: 120_000,
    });
  } catch (error) {
    const mainScript = await fetchPreview(page, 'main.js');
    console.log(
      `[webpack main.js response]\n${JSON.stringify(mainScript)}\n[webpack host problems]\n${hostProblems.join('\n')}\n[webpack-dev-server terminals]\n${await allTerminalBuffers(page)}`,
    );
    throw error;
  }
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

  const identity = `webpack-hmr-${String(Date.now())}`;
  await iframe.evaluate(
    (element, value) => element.setAttribute('data-e2e-identity', value),
    identity,
  );
  await frameBody.evaluate((_, value) => {
    const global = globalThis as typeof globalThis & {
      __riftyWebpackDocumentIdentity?: string;
      __riftyWebpackMessages?: unknown[];
    };
    global.__riftyWebpackDocumentIdentity = value;
    global.__riftyWebpackMessages = [];
    sessionStorage.removeItem('__riftyWebpackBeforeUnload');
    globalThis.addEventListener('beforeunload', () => {
      sessionStorage.setItem('__riftyWebpackBeforeUnload', '1');
    });
    globalThis.addEventListener('rifty:ws:message', (event: Event) => {
      global.__riftyWebpackMessages?.push((event as CustomEvent<unknown>).detail);
    });
  }, identity);

  const previewFrame = page
    .frames()
    .find((candidate) => candidate.url().includes(`/preview/${String(PORT)}/`));
  if (previewFrame === undefined) throw new Error(`preview frame for :${String(PORT)} is missing`);
  let previewNavigations = 0;
  page.on('framenavigated', (candidate) => {
    if (candidate === previewFrame) previewNavigations += 1;
  });

  const updatedText = 'Webpack HMR updated';
  const updatedSource = `import './styles.css';

export function render() {
  const app = document.getElementById('app');
  if (!app) throw new Error('Missing #app root');
  app.innerHTML = '<main class="app-shell"><p class="eyebrow">webpack-dev-server</p><h1>${updatedText}</h1></main>';
}

render();

if (import.meta.webpackHot) {
  import.meta.webpackHot.accept();
}
`;
  await openShellTerminal(page);
  await runTerminalLineSettled(
    page,
    `printf %s ${shellWord(updatedSource)} > src/index.js`,
    60_000,
  );

  await expect(frame.locator('h1')).toHaveText(updatedText, { timeout: 120_000 });
  await expect(iframe).toHaveAttribute('data-e2e-identity', identity);
  expect(previewNavigations).toBe(0);
  expect(
    await frameBody.evaluate(
      () =>
        (globalThis as typeof globalThis & { __riftyWebpackDocumentIdentity?: string })
          .__riftyWebpackDocumentIdentity,
    ),
  ).toBe(identity);
  expect(
    await frameBody.evaluate(() => sessionStorage.getItem('__riftyWebpackBeforeUnload')),
  ).toBeNull();
  const webpackMessages = await frameBody.evaluate(
    () =>
      (globalThis as typeof globalThis & { __riftyWebpackMessages?: unknown[] })
        .__riftyWebpackMessages ?? [],
  );
  expect(webpackMessages).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ type: 'hash' }),
      expect.objectContaining({ type: 'ok' }),
    ]),
  );
  await expectNoLoudFailure(page, hostProblems);

  const cssMarker = `webpack-css-hmr-${String(Date.now())}`;
  const updatedCss = `body {
  --rifty-webpack-css-hmr: ${cssMarker};
  background: rgb(17, 34, 51);
}
`;
  await runTerminalLineSettled(page, `printf %s ${shellWord(updatedCss)} > src/styles.css`, 60_000);
  await expect
    .poll(
      () =>
        frameBody.evaluate(() =>
          getComputedStyle(document.body).getPropertyValue('--rifty-webpack-css-hmr').trim(),
        ),
      { timeout: 120_000 },
    )
    .toBe(cssMarker);
  await expect(iframe).toHaveAttribute('data-e2e-identity', identity);
  expect(previewNavigations).toBe(0);
  await expectNoLoudFailure(page, hostProblems);

  const preReloadMarker = `webpack-pre-reload-${String(Date.now())}`;
  await runTerminalLineSettled(page, `echo ${preReloadMarker}`, 30_000);
  expect(await terminalBuffer(page)).toContain(preReloadMarker);

  await page.reload();
  await expect(page.locator('.rf-app[data-workspace-owner="workspace"]')).toBeVisible({
    timeout: 90_000,
  });
  await expect(page.locator('[data-testid="launcher"]')).toHaveCount(0);
  await expect
    .poll(() => terminalBuffer(page, 0), { timeout: 180_000 })
    .toMatch(/> webpack serve[\s\S]*compiled successfully/u);
  expect(await allTerminalBuffers(page)).not.toContain(preReloadMarker);
  await expect(
    page.locator('.rf-livepill[data-state="running"]', {
      hasText: `LIVE :${String(PORT)}`,
    }),
  ).toBeVisible({ timeout: 180_000 });
  await expectTerminalContains(page, '> webpack serve', 120_000);
  await expect(
    page.frameLocator(`iframe[title="Preview port ${String(PORT)}"]`).locator('h1'),
  ).toHaveText(updatedText, { timeout: 120_000 });
  await expect
    .poll(
      () =>
        page
          .frameLocator(`iframe[title="Preview port ${String(PORT)}"]`)
          .locator('body')
          .evaluate((body) =>
            getComputedStyle(body).getPropertyValue('--rifty-webpack-css-hmr').trim(),
          ),
      { timeout: 120_000 },
    )
    .toBe(cssMarker);
  await expect(page.locator(`iframe[title="Preview port ${String(PORT)}"]`)).toHaveCount(1);
  await expect(page.locator('.rf-preview__switcher option[value]')).toHaveCount(1);
  await openShellTerminal(page);
  await runTerminalLineSettled(page, 'cat src/index.js', 30_000);
  await expectTerminalContains(page, updatedText, 15_000);
  expect(await terminalBuffer(page, 0)).toContain('> webpack serve');
  await expectNoLoudFailure(page, hostProblems);
}
