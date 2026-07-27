/**
 * Fullstack demo — the Express + SQLite node-server template end-to-end in a
 * real cross-origin-isolated browser (see the node-server template ADR).
 *
 * Covers the full chain the demo exists to prove: preset selection boots the
 * worker (live express install + sql.js WASM engine), the SW routes
 * `/preview/3210/*` to the worker's Express app, the static client renders in
 * the preview iframe, and a POST from the page round-trips into SQLite.
 *
 * Like m7-preview-sw, installs from the live registry through the dev proxy —
 * generous polls, network required.
 */
import { expect, test } from '@playwright/test';
import {
  expectTerminalContains,
  openShellTerminal,
  pickStarter,
  runTerminalLine,
  runTerminalLineSettled,
  terminalBuffer,
} from './helpers/playground.ts';

const PORT = 3210;

function occurrences(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

test.describe('Fullstack demo — Express + node:sqlite through the SW preview bridge', () => {
  test('preset boots the server; API and client both round-trip', async ({ page }) => {
    test.setTimeout(420_000);
    page.on('pageerror', (err) => console.log('[pageerror]', err.message));
    page.on('console', (msg) => {
      if (msg.type() === 'error') console.log('[console.error]', msg.text());
    });
    await page.goto('/');

    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, {
      timeout: 15_000,
    });
    // Select the demo preset. ADR-0165 §9 moved the gallery into the launcher
    // modal: pick the card from the first-run launcher. The launcher closes on pick
    // (a fresh scratch from the chosen starter). The real install progress and
    // server/API observations below prove that boot proceeded; the chip now shows
    // the scratch name, not the starter id.
    await pickStarter(page, 'express-sqlite');
    // From-scratch preset (ADR-0135, revised): the visible `npm install` runs in
    // the OWNER realm (which serves the preview), streaming each package to the
    // terminal before the node server boots co-resident in the owner (ADR-0148).
    await expectTerminalContains(page, 'npm: + express@', 120_000);
    await expectTerminalContains(page, 'npm: + nodemon@3.1.14', 120_000);
    await expectTerminalContains(
      page,
      '> nodemon --legacy-watch --no-stdin --no-update-notifier src/main.js',
      45_000,
    );
    await expectTerminalContains(page, '[nodemon] starting `node src/main.js`', 45_000);

    // Express + engine boot behind a live npm install — poll the API route.
    // The predicate demands PARSEABLE JSON: a transient 200 from a non-SW
    // fallback (host SPA HTML) must keep the poll going, not end it.
    const fetchTodos = async () =>
      page.evaluate(async (port: number) => {
        const ac = new AbortController();
        const timer = setTimeout(() => ac.abort(), 4_000);
        try {
          const r = await fetch(`/preview/${port}/api/todos`, {
            cache: 'no-store',
            signal: ac.signal,
          });
          const body = await r.text();
          let rows: unknown;
          try {
            rows = JSON.parse(body);
          } catch {
            rows = null;
          }
          const count = Array.isArray(rows) ? rows.length : -1;
          return { ok: r.ok, status: r.status, count, body };
        } catch (err) {
          return { ok: false, status: 0, count: -1, body: String((err as Error).message ?? err) };
        } finally {
          clearTimeout(timer);
        }
      }, PORT);

    await expect
      .poll(
        async () => {
          const probe = await fetchTodos();
          return probe.ok && probe.status === 200 && probe.count >= 3;
        },
        { timeout: 180_000, intervals: [1_000, 2_000, 4_000] },
      )
      .toBe(true);

    const seeded = JSON.parse((await fetchTodos()).body) as { id: number; title: string }[];
    expect(seeded.length).toBeGreaterThanOrEqual(3);

    // The server program's console.log reaches the playground terminal
    // (kernel-stdio console wiring): boot-time seed log + request logging.
    await expectTerminalContains(page, '[db] CREATE TABLE todos + 3 seed rows', 10_000);
    await expectTerminalContains(page, '[http] GET /api/todos', 10_000);

    // Static client served by express.static through the same SW route.
    const home = await page.evaluate(async (port: number) => {
      const r = await fetch(`/preview/${port}/`, { cache: 'no-store' });
      return {
        status: r.status,
        contentType: r.headers.get('content-type') ?? '',
        etag: r.headers.get('etag') ?? '',
        body: await r.text(),
      };
    }, PORT);
    expect(home.status).toBe(200);
    expect(home.contentType).toContain('text/html');
    expect(home.body).toContain('client.js');
    // Regression: `express.static` derives the static file's ETag from the child
    // remote-fs `fs.statSync` result via `etag(stat)`. A non-Node Stats (missing
    // `ino`/`ctime`/Date `mtime`) makes etag throw "argument entity must be string,
    // Buffer, or fs.Stats" → a 500 served as a broken preview. A present
    // `W/"<size>-<mtime>"` ETag proves etag-over-Stats ran (child fs.stat round-trip holds).
    expect(home.etag, 'static response must carry a Stats-derived ETag').toMatch(/^(W\/)?"[^"]+"$/);

    // POST through the SW lands in SQLite (WASM) and reads back.
    const created = await page.evaluate(async (port: number) => {
      const r = await fetch(`/preview/${port}/api/todos`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'added from the e2e test' }),
      });
      return { status: r.status, body: await r.text() };
    }, PORT);
    expect(created.status).toBe(201);
    expect(JSON.parse(created.body)).toMatchObject({ title: 'added from the e2e test', done: 0 });

    // The preview iframe rendered the client with the seeded rows.
    const frame = page.frameLocator(`iframe[title="Preview port ${PORT}"]`);
    await expect(frame.locator('.row').first()).toBeVisible({ timeout: 60_000 });

    // Add a todo through the IFRAME UI: browser client -> SW -> worker ->
    // express -> sqlite.wasm -> back into the DOM. The client re-fetches the
    // list after the POST, so the API-added row surfaces too.
    await frame.locator('#add-input').fill('typed inside the preview');
    await frame.locator('.add__btn').click();
    await expect(frame.locator('.row__title', { hasText: 'typed inside the preview' })).toBeVisible(
      { timeout: 15_000 },
    );
    await expect(frame.locator('.row__title', { hasText: 'added from the e2e test' })).toBeVisible({
      timeout: 15_000,
    });

    // The write made it into the terminal as a db log line.
    await expectTerminalContains(page, '[db] INSERT todos #', 10_000);

    const restartMarker = `express-nodemon-${Date.now()}`;
    await openShellTerminal(page);
    await runTerminalLineSettled(page, `echo "console.log('${restartMarker}')" >> src/main.js`);
    await expect
      .poll(() => terminalBuffer(page, 0), { timeout: 45_000 })
      .toContain('[nodemon] restarting due to changes');
    await expect.poll(() => terminalBuffer(page, 0), { timeout: 45_000 }).toContain(restartMarker);
    await expect
      .poll(async () => (await fetchTodos()).count, {
        timeout: 45_000,
        intervals: [250, 500, 1_000],
      })
      .toBe(3);
    expect(await terminalBuffer(page, 0)).not.toContain('EADDRINUSE');

    const rapidMarker = `express-rapid-${Date.now()}`;
    const restartsBeforeRapid = (await terminalBuffer(page, 0)).split(
      '[nodemon] restarting due to changes',
    ).length;
    await runTerminalLineSettled(
      page,
      `echo "console.log('rapid-intermediate')" >> src/main.js && echo "console.log('${rapidMarker} pid=' + process.pid + ' ppid=' + process.ppid)" >> src/main.js`,
    );
    await expect
      .poll(
        async () =>
          (await terminalBuffer(page, 0)).split('[nodemon] restarting due to changes').length,
        { timeout: 45_000 },
      )
      .toBeGreaterThan(restartsBeforeRapid);
    await expect.poll(() => terminalBuffer(page, 0), { timeout: 45_000 }).toContain(rapidMarker);
    await expect.poll(async () => (await fetchTodos()).count, { timeout: 45_000 }).toBe(3);
    expect(await terminalBuffer(page, 0)).not.toContain('EADDRINUSE');

    const appIdentity = new RegExp(`${rapidMarker} pid=(\\d+) ppid=(\\d+)`, 'u').exec(
      await terminalBuffer(page, 0),
    );
    expect(appIdentity, 'edited app must expose its real PID/PPID').not.toBeNull();
    const appPid = Number(appIdentity?.[1]);
    const supervisorPid = Number(appIdentity?.[2]);
    await runTerminalLineSettled(page, 'ps -A -o ppid,pid');
    const processRows = [...(await terminalBuffer(page)).matchAll(/^\s*(\d+)\s+(\d+)\s*$/gmu)].map(
      (match) => ({ ppid: Number(match[1]), pid: Number(match[2]) }),
    );
    expect(processRows).toContainEqual({ ppid: supervisorPid, pid: appPid });
    expect(processRows.filter((row) => row.ppid === supervisorPid)).toEqual([
      { ppid: supervisorPid, pid: appPid },
    ]);
    await expect(page.locator(`iframe[title="Preview port ${PORT}"]`)).toHaveCount(1);
    await expect(page.locator(`.rf-preview__switcher option[value="${PORT}"]`)).toHaveCount(1);

    await runTerminalLineSettled(page, `echo 'const = ;' >> src/main.js`);
    await expect
      .poll(() => terminalBuffer(page, 0), { timeout: 45_000 })
      .toContain('Failed to parse ESM source');
    await expect
      .poll(() => terminalBuffer(page, 0), { timeout: 45_000 })
      .toContain('[nodemon] app crashed - waiting for file changes before starting');

    const recoveryMarker = `express-recovered-${Date.now()}`;
    await runTerminalLineSettled(
      page,
      `head -n -1 src/main.js > src/main.fixed && echo "console.log('${recoveryMarker}')" >> src/main.fixed && mv src/main.fixed src/main.js`,
    );
    await expect.poll(() => terminalBuffer(page, 0), { timeout: 45_000 }).toContain(recoveryMarker);
    await expect.poll(async () => (await fetchTodos()).count, { timeout: 45_000 }).toBe(3);
    expect(await terminalBuffer(page, 0)).not.toContain('EADDRINUSE');

    const queuedMarker = `express-queued-after-close-${Date.now()}`;
    await runTerminalLine(page, `echo "console.log('${queuedMarker}')" >> src/main.js`);
    await page.getByRole('tab', { name: 'Express + SQLite scratch', exact: true }).click();
    await page.locator('.rf-terminal-slot[data-active="true"] [data-testid="terminal"]').click();
    await page.keyboard.press('Control+c');
    await expect
      .poll(async () => (await fetchTodos()).ok, {
        timeout: 45_000,
        intervals: [250, 500, 1_000],
      })
      .toBe(false);
    const startsAfterStop = (await terminalBuffer(page, 0)).split('[nodemon] starting').length;
    await page.waitForTimeout(2_000);
    expect((await fetchTodos()).ok).toBe(false);
    expect((await terminalBuffer(page, 0)).split('[nodemon] starting')).toHaveLength(
      startsAfterStop,
    );
    await expect(page.locator(`.rf-preview__switcher option[value="${PORT}"]`)).toHaveCount(0);
    const closeMarker = `PROCESS_TABLE_AFTER_CLOSE_${Date.now()}`;
    await runTerminalLineSettled(page, `echo ${closeMarker} && ps -A -o ppid,pid`);
    const closeTable = (await terminalBuffer(page)).split(closeMarker).at(-1) ?? '';
    const closedPids = new Set([appPid, supervisorPid]);
    expect(
      [...closeTable.matchAll(/^\s*(\d+)\s+(\d+)\s*$/gmu)].some(
        (row) => closedPids.has(Number(row[1])) || closedPids.has(Number(row[2])),
      ),
    ).toBe(false);

    const startsBeforeLaunchFaults = occurrences(
      await terminalBuffer(page, 0),
      '[nodemon] starting',
    );
    const missingMarker = `MISSING_NODEMON_${Date.now()}`;
    await runTerminalLineSettled(
      page,
      'mv node_modules/.bin/nodemon node_modules/.bin/nodemon.saved',
    );
    await runTerminalLineSettled(
      page,
      `npm run dev && echo ${missingMarker}_UNEXPECTED || echo ${missingMarker}_SETTLED`,
      45_000,
    );
    let launchFaultBuffer = await terminalBuffer(page, 0);
    expect(occurrences(launchFaultBuffer, `${missingMarker}_SETTLED`)).toBe(2);
    expect(occurrences(launchFaultBuffer, `${missingMarker}_UNEXPECTED`)).toBe(1);
    expect(occurrences(launchFaultBuffer, '[nodemon] starting')).toBe(startsBeforeLaunchFaults);
    expect((await fetchTodos()).ok).toBe(false);

    const corruptMarker = `CORRUPT_NODEMON_${Date.now()}`;
    await runTerminalLineSettled(
      page,
      `echo 'this is not a valid node launcher' > node_modules/.bin/nodemon`,
    );
    await runTerminalLineSettled(
      page,
      `npm run dev && echo ${corruptMarker}_UNEXPECTED || echo ${corruptMarker}_SETTLED`,
      45_000,
    );
    launchFaultBuffer = await terminalBuffer(page, 0);
    expect(occurrences(launchFaultBuffer, `${corruptMarker}_SETTLED`)).toBe(2);
    expect(occurrences(launchFaultBuffer, `${corruptMarker}_UNEXPECTED`)).toBe(1);
    expect(occurrences(launchFaultBuffer, '[nodemon] starting')).toBe(startsBeforeLaunchFaults);
    expect((await fetchTodos()).ok).toBe(false);
  });
});
