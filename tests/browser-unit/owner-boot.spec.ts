import { expect, test } from '@playwright/test';

/**
 * Browser-unit lane (ADR-0196) — owner boot over the thin Playwright harness.
 *
 * Worker-side playground modules are behaviorally testable WITHOUT
 * booting the App: the harness page (apps/playground/unit-harness.html) wires
 * only the worker-URL seams; specs dynamically import the REAL module under
 * test (`/src/glue/realVite.ts` — vite dev transforms TS on the fly) and boot
 * the REAL workspace-owner worker under real COI + real Workers + SAB IPC.
 *
 * Criteria measured:
 *   1. COI on, App NOT mounted (no #app render, no xterm).
 *   2. startWorkspaceOwner → owner `ready` handshake + a real shell exec
 *      round-trip (pwd / echo through the owner-resident shell).
 *   3. Wall-clock timings for import / boot-to-ready / session open / exec.
 */

/** Owner boot + shell round-trip, fully inside the page realm. */
async function bootOwnerAndExec(page: import('@playwright/test').Page) {
  return page.evaluate(async () => {
    const t0 = performance.now();
    // Dynamic import of the REAL owner-boot entry — same URLs the App uses;
    // vite dev serves the transformed TS module graph.
    const [realVite, hiddenEmpty] = await Promise.all([
      import('/src/glue/realVite.ts'),
      import('/src/templates/hidden-empty.ts'),
    ]);
    const tImport = performance.now();

    const logs: string[] = [];
    // Mirrors App.tsx createHiddenEmptyWorkspaceOwner (the lightest REAL boot
    // App performs on every cold page load).
    const handle = realVite.startWorkspaceOwner({
      workspaceId: 'browser-unit-owner-boot',
      root: '/scratch',
      template: hiddenEmpty.HIDDEN_EMPTY_TEMPLATE,
      slug: 'scratch',
      setup: 'instant',
      hiddenEmptyBoot: true,
      onLog: (line: string) => logs.push(line),
    });

    // Diagnosable timeout: owner stdout/stderr routes through onLog (worker
    // console is NOT captured by playwright), so attach the log tail on failure.
    const readyTimeout = new Promise<never>((_, reject) => {
      setTimeout(
        () =>
          reject(
            new Error(`owner ready timed out (60s); owner logs:\n${logs.slice(-40).join('')}`),
          ),
        60_000,
      );
    });
    await Promise.race([handle.ready, readyTimeout]);
    const tReady = performance.now();

    await handle.openSession('bu-1');
    const tOpen = performance.now();

    const execLine = async (line: string) => {
      let out = '';
      const exit = await handle.exec('bu-1', line, {
        cols: 80,
        rows: 24,
        isTTY: false,
        onChunk: (chunk: string) => {
          out += chunk;
        },
      });
      return { exit, out };
    };

    const pwd = await execLine('pwd');
    const tExec1 = performance.now();
    const echo = await execLine('echo browser-unit-roundtrip');
    const tExec2 = performance.now();

    handle.close();
    return {
      ownerAlive: true,
      pwd,
      echo,
      ownerLogLines: logs.length,
      timings: {
        importRealViteMs: Math.round(tImport - t0),
        bootToReadyMs: Math.round(tReady - tImport),
        openSessionMs: Math.round(tOpen - tReady),
        firstExecMs: Math.round(tExec1 - tOpen),
        secondExecMs: Math.round(tExec2 - tExec1),
        totalMs: Math.round(tExec2 - t0),
      },
    };
  });
}

test('criterion 1: harness page is cross-origin isolated and does NOT mount the App', async ({
  page,
}) => {
  const t0 = Date.now();
  await page.goto('/unit-harness.html');
  await expect(page.locator('#browser-unit-harness')).toHaveAttribute('data-status', 'ready');
  const pageLoadMs = Date.now() - t0;

  expect(await page.evaluate(() => globalThis.crossOriginIsolated === true)).toBe(true);
  // SAB IPC actually constructible (the owner gate), not just the COI flag.
  expect(await page.evaluate(() => typeof SharedArrayBuffer === 'function')).toBe(true);

  // No App artifacts: no #app / #root mount, no xterm DOM, no monaco.
  const appArtifacts = await page.evaluate(() => ({
    app: document.querySelector('#app') !== null,
    root: document.querySelector('#root') !== null,
    xterm: document.querySelector('.xterm') !== null,
    monaco: document.querySelector('.monaco-editor') !== null,
  }));
  expect(appArtifacts).toEqual({ app: false, root: false, xterm: false, monaco: false });

  console.log(`[browser-unit] harness page load→ready: ${pageLoadMs}ms`);
});

test('criterion 2+3: real workspace-owner boots from a dynamic import; shell exec round-trips', async ({
  page,
}) => {
  await page.goto('/unit-harness.html');
  await expect(page.locator('#browser-unit-harness')).toHaveAttribute('data-status', 'ready');

  const r = await bootOwnerAndExec(page);

  // Owner→page ready frame arrived, and the owner-resident shell behaves.
  expect(r.pwd.exit).toBe(0);
  expect(r.pwd.out).toContain('/scratch');
  expect(r.echo.exit).toBe(0);
  expect(r.echo.out).toContain('browser-unit-roundtrip');

  console.log(`[browser-unit] owner boot+exec timings: ${JSON.stringify(r.timings)}`);
  console.log(`[browser-unit] owner log lines: ${r.ownerLogLines}`);
});

test('overhead probe: second fresh page+owner boot (marginal per-test cost)', async ({ page }) => {
  const t0 = Date.now();
  await page.goto('/unit-harness.html');
  await expect(page.locator('#browser-unit-harness')).toHaveAttribute('data-status', 'ready');
  const pageLoadMs = Date.now() - t0;

  const r = await bootOwnerAndExec(page);
  expect(r.pwd.exit).toBe(0);
  expect(r.echo.out).toContain('browser-unit-roundtrip');

  console.log(
    `[browser-unit] repeat-boot: pageLoad=${pageLoadMs}ms timings=${JSON.stringify(r.timings)}`,
  );
});
