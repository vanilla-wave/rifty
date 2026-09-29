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
 * PROD-build acceptance for ADR-0449. In a production build the parent's
 * node-entry bundle, the worker's node-entry bundle and the kernel worker entry
 * each carry their own runtime-js copy (traps: prod-dual-copy-buffer), so the
 * Worker's stdio streams, the node-entry v6 startup options and the child's
 * resolver conditions must meet across those copies. Node v24.16.0 prints, for
 * the same files (`node main.cjs`, exit 0): the rows asserted below —
 * docs/backlog/runtime-js/reference/worker-threads-stdio-streams-empty-exec-argv-evidence.md
 * §Prod program.
 */

function echoRe(line: string): RegExp {
  return new RegExp(`> ${line.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
}
// Echo-confirm a typed line (copied from worker-threads-keepalive.spec.ts — a
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
    'node_modules/cpkg/package.json',
    '{"name":"cpkg","exports":{"custom":"./custom.js","default":"./def.js"}}',
  ],
  ['node_modules/cpkg/custom.js', 'module.exports = "custom";'],
  ['node_modules/cpkg/def.js', 'module.exports = "def";'],
  ['pre.cjs', 'globalThis.__pre = "pre";'],
  ['w-log.cjs', 'console.log("SP|worker default out");'],
  [
    'w-probe.cjs',
    'const { parentPort } = require("node:worker_threads"); parentPort.postMessage([process.execArgv.join(" "), globalThis.__pre, require("cpkg")].join(","));',
  ],
  [
    'f-probe.cjs',
    'process.send([process.execArgv.join(" "), globalThis.__pre, require("cpkg")].join(","));',
  ],
  [
    'main.cjs',
    'const { Worker } = require("node:worker_threads"); const { fork } = require("node:child_process"); const { Readable } = require("node:stream"); const path = require("node:path"); const execArgv = ["--require", "./pre.cjs", "-C", "custom"]; const a = new Worker(path.resolve("w-log.cjs")); a.on("exit", () => { const b = new Worker(path.resolve("w-log.cjs"), { stdout: true }); let out = ""; b.stdout.on("data", (c) => { out += c; }); b.on("exit", () => { console.log("SP|captured " + (b.stdout instanceof Readable) + " " + JSON.stringify(out)); const c = new Worker(path.resolve("w-probe.cjs"), { execArgv }); c.on("message", (m) => console.log("SP|worker " + m)); c.on("exit", () => { const f = fork(path.resolve("f-probe.cjs"), [], { execArgv }); f.on("message", (m) => console.log("SP|fork " + m)); f.on("exit", (code) => console.log("SP|done " + code)); }); }); });',
  ],
];

test.describe('production build — Worker stdio and fork/Worker startup options (ADR-0449)', () => {
  test('node main.cjs prints what Node prints and exits 0', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'workspace owner is COI/SAB-gated — chromium only');
    test.setTimeout(240_000);
    await bootProjectFiles(page);
    expect(await page.evaluate(() => globalThis.crossOriginIsolated)).toBe(true);
    await expectViteDevServerReady(page, 5173, 120_000);
    await openShellTerminal(page);

    await runLineConfirmed(page, 'mkdir -p sx-prod/node_modules/cpkg && cd sx-prod');
    for (const [name, source] of FILES) await runLineConfirmed(page, `echo '${source}' > ${name}`);

    // Program rows only: echoed command lines start with `> `.
    const rows = async (): Promise<string[]> =>
      (await terminalBuffer(page))
        .replaceAll('\r', '')
        .split('\n')
        .filter((line) => line.startsWith('SP|'));
    await runLineConfirmed(page, 'node main.cjs');
    await expect
      .poll(async () => (await rows()).some((row) => row.startsWith('SP|done ')), {
        timeout: 60_000,
      })
      .toBe(true)
      .catch(() => undefined);

    expect(await rows()).toEqual([
      'SP|worker default out',
      'SP|captured true "SP|worker default out\\n"',
      'SP|worker --require ./pre.cjs -C custom,pre,custom',
      'SP|fork --require ./pre.cjs -C custom,pre,custom',
      'SP|done 0',
    ]);
    expect(await terminalHistoryExitCode(page, 'node main.cjs')).toBe(0);
  });
});
