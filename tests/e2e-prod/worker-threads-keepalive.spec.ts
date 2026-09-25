import { type Page, expect, test } from '@playwright/test';
import {
  bootProjectFiles,
  expectViteDevServerReady,
  openShellTerminal,
  runTerminalLine,
  terminalBuffer,
  terminalHistoryExitCode,
} from '../e2e/helpers/playground.ts';

/**
 * PROD-build acceptance for ADR-0446 / goal I2. In a production build the
 * parent's node-entry bundle, the worker's node-entry bundle and the kernel
 * worker entry each carry their own runtime-js copy (traps: prod-dual-copy-buffer),
 * so the Worker hold, the worker's `parentPort` hold and the worker-thread drain
 * must meet in one realm-shared keepalive. Node v24.16.0 prints, for the same
 * files: `KA|got hi true`, `KA|wexit 0`, `KA|EXIT 0` (keepalive.cjs, the goal's
 * t3.cjs oracle) and `KA|echo ping`, `KA|echo-exit 1` (listener.cjs: a worker
 * with a `parentPort` listener lives until terminate()); both exit 0 —
 * docs/backlog/runtime-js/reference/worker-threads-handle-keepalive-evidence.md
 * §Prod programs.
 */

function echoRe(line: string): RegExp {
  return new RegExp(`> ${line.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
}
// Echo-confirm a typed line (copied from buffer-realm-identity.spec.ts — a
// keystroke landing during a snapshot re-render is silently dropped).
async function runLineConfirmed(page: Page, line: string): Promise<void> {
  const re = echoRe(line);
  const echoed = async (): Promise<boolean> => re.test(await terminalBuffer(page));
  for (let attempt = 0; attempt < 3; attempt++) {
    if (await echoed()) return;
    await runTerminalLine(page, line);
    try {
      await expect.poll(echoed, { timeout: 6_000, intervals: [300, 600, 1_000] }).toBe(true);
      return;
    } catch {
      /* echo dropped in a re-render — retry */
    }
  }
  throw new Error(`command line never echoed after retries: ${line}`);
}

const FILES: readonly (readonly [string, string])[] = [
  [
    'w.cjs',
    'const { parentPort } = require("node:worker_threads"); ' +
      'setTimeout(() => parentPort.postMessage("hi"), 700);',
  ],
  [
    'keepalive.cjs',
    'const { Worker } = require("node:worker_threads"); const t0 = Date.now(); ' +
      'const w = new Worker("./w.cjs"); ' +
      'w.on("message", (m) => console.log("KA|got", m, Date.now() - t0 >= 600)); ' +
      'w.on("exit", (c) => console.log("KA|wexit", c)); ' +
      'process.on("exit", (c) => console.log("KA|EXIT", c));',
  ],
  [
    'echo.cjs',
    'const { parentPort } = require("node:worker_threads"); ' +
      'parentPort.on("message", (m) => parentPort.postMessage("echo " + m));',
  ],
  [
    'listener.cjs',
    'const { Worker } = require("node:worker_threads"); const w = new Worker("./echo.cjs"); ' +
      'w.on("online", () => w.postMessage("ping")); ' +
      'w.on("message", (m) => { console.log("KA|" + m); setTimeout(() => w.terminate(), 400); }); ' +
      'w.on("exit", (c) => console.log("KA|echo-exit", c));',
  ],
];

test.describe('production build — a live worker_threads.Worker holds its parent (ADR-0446)', () => {
  test('node keepalive.cjs / listener.cjs print what Node prints and exit 0', async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'workspace owner is COI/SAB-gated — chromium only');
    test.setTimeout(240_000);
    await bootProjectFiles(page);
    expect(await page.evaluate(() => globalThis.crossOriginIsolated)).toBe(true);
    await expectViteDevServerReady(page, 5173, 120_000);
    await openShellTerminal(page);

    for (const [name, source] of FILES) await runLineConfirmed(page, `echo '${source}' > ${name}`);

    // Program rows only: echoed command lines start with `> `.
    const rows = async (): Promise<string[]> =>
      (await terminalBuffer(page))
        .replaceAll('\r', '')
        .split('\n')
        .filter((line) => /^KA\|[\w-]+( \w+)+$/u.test(line));
    // Wait for each program's last row; the row diff below is the failure.
    const settle = (last: string): Promise<void> =>
      expect
        .poll(async () => (await rows()).some((row) => row.startsWith(last)), { timeout: 30_000 })
        .toBe(true)
        .catch(() => undefined);
    await runLineConfirmed(page, 'node keepalive.cjs');
    await settle('KA|EXIT ');
    await runLineConfirmed(page, 'node listener.cjs');
    await settle('KA|echo-exit ');

    expect(await rows()).toEqual([
      'KA|got hi true',
      'KA|wexit 0',
      'KA|EXIT 0',
      'KA|echo ping',
      'KA|echo-exit 1',
    ]);
    expect(await terminalHistoryExitCode(page, 'node keepalive.cjs')).toBe(0);
    expect(await terminalHistoryExitCode(page, 'node listener.cjs')).toBe(0);
  });
});
