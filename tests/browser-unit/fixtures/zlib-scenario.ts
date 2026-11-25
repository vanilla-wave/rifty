import type { Page } from '@playwright/test';
import type { Mask, OracleStep } from '../../../packages/isolate-host/tests/zlib-scenario.ts';

// node:zlib goal carrier on the browser hosts (Workbench: ../zlib-scenario.spec.ts, SDK:
// tests/no-coi/zlib-scenario.spec.ts): a step's workspace (thousands of closure files) reaches the
// guest as one routed body, `u32 index length · JSON [path, size][] · bytes`, written as one file
// and unpacked by a guest `node` (UNPACK): one host write instead of one per file.

export const STEP_URL = '/__zlib-scenario/';

/** Serves each step's workspace at `STEP_URL + <id>`; route set before boot (trap late-fetch-interception). */
export async function serveSteps(
  page: Page,
  oracle: () => ReadonlyMap<string, OracleStep>,
): Promise<void> {
  await page.route(`**${STEP_URL}*`, (route) => {
    const id = decodeURIComponent(new URL(route.request().url()).pathname.slice(STEP_URL.length));
    const step = oracle().get(id);
    if (step === undefined) return route.fulfill({ status: 404 });
    const index = Buffer.from(JSON.stringify([...step.files].map(([p, b]) => [p, b.byteLength])));
    const head = Buffer.alloc(4);
    head.writeUInt32LE(index.byteLength);
    return route.fulfill({
      status: 200,
      contentType: 'application/octet-stream',
      body: Buffer.concat([head, index, ...step.files.values()]),
    });
  });
}

/** `node zunpack.cjs <body> <dir>`: the step's files under a fresh `<dir>` (no earlier run's output). */
export const UNPACK = `const fs = require('node:fs');
const path = require('node:path');
const [body, dir] = process.argv.slice(2);
fs.rmSync(dir, { recursive: true, force: true });
const b = fs.readFileSync(body);
const size = b.readUInt32LE(0);
let at = 4 + size;
const dirs = new Set();
for (const [rel, length] of JSON.parse(b.subarray(4, at).toString('utf8'))) {
  const file = path.join(dir, rel);
  if (!dirs.has(path.dirname(file))) fs.mkdirSync(path.dirname(file), { recursive: true });
  dirs.add(path.dirname(file));
  fs.writeFileSync(file, b.subarray(at, at + length));
  at += length;
}
fs.rmSync(body);
`;

/** The masks of a browser host's stderr; nothing else of it is rewritten. */
export const BROWSER_MASKS: readonly Mask[] = [
  {
    why: "the dev server's origin (port) and this checkout's path in rifty's own source URLs",
    pattern: /https?:\/\/(?:localhost|127\.0\.0\.1):\d+\/@fs\/\S*?\/packages\//g,
    to: '<dev-server>/packages/',
  },
  {
    why: "a run of rifty's own stack frames (their line:col move with any runtime edit); guest frames stay",
    pattern: /(?:^ {4}at (?:.*\()?<dev-server>\/packages\/.*\n)+/gm,
    to: '    at <rifty frames>\n',
  },
];
