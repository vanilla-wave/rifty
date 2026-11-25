import type { Page } from '@playwright/test';
import type { OracleStep, StepId } from '../../../packages/isolate-host/tests/zlib-scenario.ts';

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

/** `node zunpack.cjs <body> <dir>`: the step's files under `<dir>`. */
export const UNPACK = `const fs = require('node:fs');
const path = require('node:path');
const [body, dir] = process.argv.slice(2);
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

const stream = (name: string, oneShot: string): string =>
  `NotImplementedError: Not implemented: zlib.${name} (this stream not implemented yet; buffer the input, then call async zlib.${oneShot}: zlib.${oneShot}(buf, cb) or await util.promisify(zlib.${oneShot})(buf))`;
const sync = (name: string, async: string): string =>
  `NotImplementedError: Not implemented: zlib.${name} (sync zlib not implemented yet; async zlib.${async} works: zlib.${async}(buf, cb) or await util.promisify(zlib.${async})(buf))`;

/** The browser-host `node:zlib`'s (runtime-js `builtins/zlib.ts`) error per step today, main dfad6553e. */
export const BROWSER_ERRORS: Readonly<Record<StepId, string | null>> = {
  '1': stream('DeflateRaw', 'deflateRaw'),
  '2': stream('createInflateRaw', 'inflateRaw'),
  '3w': stream('createDeflate', 'deflate'),
  '3r': "TypeError: Class constructors cannot be invoked without 'new'",
  '4': sync('deflateSync', 'deflate'),
  '5a': sync('gunzipSync', 'gunzip'),
  '5b': 'NotImplementedError: Not implemented: zlib.unzip (gzip/zlib auto-detect not implemented yet; pick by header: gzip input (starts 1f 8b) → async zlib.gunzip, else → async zlib.inflate; both take (buf, cb) and work with util.promisify)',
  '6': stream('createDeflateRaw', 'deflateRaw'),
  '7a': 'NotImplementedError: Not implemented: zlib.crc32 (crc32 not implemented yet; node:zlib has no working alternative)',
  // Reported, not thrown: the program prints it (Node: Error, Z_DATA_ERROR, errno -3, no trailing dot).
  '7b': null,
};
/** Stdout a step prints before its error, today, on both browser hosts. */
export const BROWSER_STDOUT: Readonly<Partial<Record<StepId, string>>> = {
  '6': 'params {"client_max_window_bits":11,"server_max_window_bits":10}\n',
  '7b': '{"error":true,"name":"TypeError","message":"The compressed data was not valid: invalid code -- missing end-of-block."}\n',
};
