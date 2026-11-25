import { type Page, expect, test } from '@playwright/test';
import {
  GREEN_BY,
  type OracleStep,
  type Pin,
  STEPS,
  type StepId,
  observed,
  outPath,
  pinOf,
  runOracle,
} from '../../packages/isolate-host/tests/zlib-scenario.ts';
import {
  bootOwner,
  closeOwner,
  execLine,
  gotoHarness,
  sealedWorkbenchFixtureUrl,
} from './fixtures.ts';
import { BROWSER_MASKS, STEP_URL, UNPACK, serveSteps } from './fixtures/zlib-scenario.ts';

// node:zlib goal carrier (backlog epics/node-zlib-on-every-host/map.md item 1), COI Workbench host
// (kernel child `node`, Chromium): each step's workspace unpacked by a guest `node` to `/tmp/z<id>`
// (out of the project tree, keeping it small: a guest write's cost grows with the project's file
// count today, backlog perf/workbench-guest-write-cost-grows-with-project), run by a rifty `node` runner that spawns
// `node <step> <out>` with piped stdio (the shell has no `2>`), against live `node <step>` over the
// same files. Today's outcome pinned whole per step; the unit delivering it compares with Node.

const RUNNER = `const { spawn } = require('node:child_process');
const [dir, ...argv] = process.argv.slice(2);
const child = spawn('node', argv, { cwd: require('node:path').resolve(dir), stdio: ['ignore', 'pipe', 'pipe'] });
let stdout = '';
let stderr = '';
child.stdout.setEncoding('utf8').on('data', (c) => { stdout += c; });
child.stderr.setEncoding('utf8').on('data', (c) => { stderr += c; });
child.on('close', (exitCode) => {
  const out = require('node:path').resolve(dir, argv[1]);
  const file = require('node:fs').existsSync(out) ? require('node:fs').readFileSync(out).toString('base64') : null;
  process.stdout.write('@@ZS' + JSON.stringify({ stdout, stderr, exitCode, file }) + 'ZS@@\\n');
});
`;

/** Today's outcome, measured on main dfad6553e: whole stderr under `BROWSER_MASKS`. */
const PINS: Readonly<Record<StepId, Pin>> = {
  '1': {
    exitCode: 1,
    stdout: '',
    stderr: `Uncaught NotImplementedError: Not implemented: zlib.DeflateRaw (this stream not implemented yet; buffer the input, then call async zlib.deflateRaw: zlib.deflateRaw(buf, cb) or await util.promisify(zlib.deflateRaw)(buf)) (<dev-server>/packages/runtime-js/src/builtins/zlib.ts:11)
`,
    output: null,
  },
  '2': {
    exitCode: 1,
    stdout: '',
    stderr: `NotImplementedError: Not implemented: zlib.createInflateRaw (this stream not implemented yet; buffer the input, then call async zlib.inflateRaw: zlib.inflateRaw(buf, cb) or await util.promisify(zlib.inflateRaw)(buf))
    at <rifty frames>
    at eval (/tmp/z2/node_modules/unzipper/lib/Open/unzip.js:89:52)
    at tryCatcher (/tmp/z2/node_modules/bluebird/js/release/util.js:16:23)
    at Promise._settlePromiseFromHandler (/tmp/z2/node_modules/bluebird/js/release/promise.js:510:31)
    at Promise._settlePromise (/tmp/z2/node_modules/bluebird/js/release/promise.js:567:18)
    at Promise._settlePromise0 (/tmp/z2/node_modules/bluebird/js/release/promise.js:612:10)
    at Promise._settlePromises (/tmp/z2/node_modules/bluebird/js/release/promise.js:691:18)
    at Async._drainQueue (/tmp/z2/node_modules/bluebird/js/release/async.js:133:16)
    at Async._drainQueues (/tmp/z2/node_modules/bluebird/js/release/async.js:143:10)
    at Async.drainQueues (/tmp/z2/node_modules/bluebird/js/release/async.js:17:14)
    at <rifty frames>
`,
    output: null,
  },
  '3w': {
    exitCode: 1,
    stdout: '',
    stderr: `NotImplementedError: Not implemented: zlib.createDeflate (this stream not implemented yet; buffer the input, then call async zlib.deflate: zlib.deflate(buf, cb) or await util.promisify(zlib.deflate)(buf))
    at <rifty frames>
    at Packer.createDeflate (/tmp/z3w/node_modules/pngjs/lib/packer.js:73:24)
    at new module.exports (/tmp/z3w/node_modules/pngjs/lib/packer-async.js:14:32)
    at new exports.PNG (/tmp/z3w/node_modules/pngjs/lib/png.js:44:18)
    at Object.<anonymous> (/tmp/z3w/3w-pngjs-write.js:6:42)
    at <rifty frames>
`,
    output: null,
  },
  '3r': {
    exitCode: 1,
    stdout: '',
    stderr: `TypeError: Class constructors cannot be invoked without 'new'
    at new Inflate (/tmp/z3r/node_modules/pngjs/lib/sync-inflate.js:18:16)
    at inflateSync (/tmp/z3r/node_modules/pngjs/lib/sync-inflate.js:162:25)
    at module.exports (/tmp/z3r/node_modules/pngjs/lib/parser-sync.js:85:20)
    at exports.read (/tmp/z3r/node_modules/pngjs/lib/png-sync.js:7:10)
    at Object.<anonymous> (/tmp/z3r/3r-pngjs-read.js:7:23)
    at <rifty frames>
`,
    output: null,
  },
  '4': {
    exitCode: 1,
    stdout: '',
    stderr: `NotImplementedError: Not implemented: zlib.deflateSync (sync zlib not implemented yet; async zlib.deflate works: zlib.deflate(buf, cb) or await util.promisify(zlib.deflate)(buf))
    at <rifty frames>
    at PDFReference.finalize (/tmp/z4/node_modules/pdfkit/js/pdfkit.js:201:28)
    at PDFReference.end (/tmp/z4/node_modules/pdfkit/js/pdfkit.js:193:10)
    at PDFPage.end (/tmp/z4/node_modules/pdfkit/js/pdfkit.js:434:25)
    at PDFDocument.flushPages (/tmp/z4/node_modules/pdfkit/js/pdfkit.js:5855:12)
    at PDFDocument.end (/tmp/z4/node_modules/pdfkit/js/pdfkit.js:5912:10)
    at Object.<anonymous> (/tmp/z4/4-pdfkit.js:26:5)
    at <rifty frames>
`,
    output: null,
  },
  '5a': {
    exitCode: 1,
    stdout: '',
    stderr: `NotImplementedError: Not implemented: zlib.gunzipSync (sync zlib not implemented yet; async zlib.gunzip works: zlib.gunzip(buf, cb) or await util.promisify(zlib.gunzip)(buf))
    at <rifty frames>
    at Object.<anonymous> (/tmp/z5a/5a-gunzip-members.js:5:33)
    at <rifty frames>
`,
    output: null,
  },
  '5b': {
    exitCode: 1,
    stdout: '',
    stderr: `NotImplementedError: Not implemented: zlib.unzip (gzip/zlib auto-detect not implemented yet; pick by header: gzip input (starts 1f 8b) → async zlib.gunzip, else → async zlib.inflate; both take (buf, cb) and work with util.promisify)
    at <rifty frames>
    at Object.<anonymous> (/tmp/z5b/5b-unzip.js:6:6)
    at <rifty frames>
`,
    output: null,
  },
  '6': {
    exitCode: 1,
    stdout: 'params {"client_max_window_bits":11,"server_max_window_bits":10}\n',
    stderr: `NotImplementedError: Not implemented: zlib.createDeflateRaw (this stream not implemented yet; buffer the input, then call async zlib.deflateRaw: zlib.deflateRaw(buf, cb) or await util.promisify(zlib.deflateRaw)(buf))
    at <rifty frames>
    at PerMessageDeflate._compress (/tmp/z6/node_modules/ws/lib/permessage-deflate.js:416:28)
    at eval (/tmp/z6/node_modules/ws/lib/permessage-deflate.js:326:12)
    at [kRun] (/tmp/z6/node_modules/ws/lib/limiter.js:50:7)
    at Limiter.add (/tmp/z6/node_modules/ws/lib/limiter.js:35:15)
    at PerMessageDeflate.compress (/tmp/z6/node_modules/ws/lib/permessage-deflate.js:325:17)
    at eval (/tmp/z6/6-ws.js:6:54)
    at new Promise (<anonymous>)
    at call (/tmp/z6/6-ws.js:6:28)
    at eval (/tmp/z6/6-ws.js:24:21)
`,
    output: null,
  },
  '7a': {
    exitCode: 1,
    stdout: '',
    stderr: `NotImplementedError: Not implemented: zlib.crc32 (crc32 not implemented yet; node:zlib has no working alternative)
    at <rifty frames>
    at Object.<anonymous> (/tmp/z7a/7a-crc32.js:6:37)
    at <rifty frames>
`,
    output: null,
  },
  '7b': {
    exitCode: 0,
    stdout:
      '{"error":true,"name":"TypeError","message":"The compressed data was not valid: invalid code -- missing end-of-block."}\n',
    stderr: '',
    output: null,
  },
};

let oracle: ReadonlyMap<StepId, OracleStep> | undefined;
const oracleOf = (): ReadonlyMap<StepId, OracleStep> => {
  oracle ??= runOracle();
  return oracle;
};
let page: Page;

/** The step's run in the Workbench, its output read back by the runner. */
async function inWorkbench(step: OracleStep['step']): Promise<ReturnType<typeof observed>> {
  const dir = `z${step.id}`;
  await page.evaluate(
    async ({ fixtureUrl, url, path }) => {
      const fixture = await import(/* @vite-ignore */ fixtureUrl);
      const body = new Uint8Array(await (await fetch(url)).arrayBuffer());
      await fixture.currentProject().files.writeFile(path, body, { expectedVersion: null });
    },
    { fixtureUrl: sealedWorkbenchFixtureUrl, url: `${STEP_URL}${step.id}`, path: `/${dir}.bin` },
  );
  const unpack = await execLine(page, `node zunpack.cjs ${dir}.bin /tmp/${dir}`);
  expect(unpack.exit, unpack.out).toBe(0);
  const run = await execLine(page, `node zrun.cjs /tmp/${dir} ${step.program} ${outPath(step)}`);
  const json = /@@ZS(.*)ZS@@/su.exec(run.out)?.[1];
  if (json === undefined) throw new Error(`runner printed no result\n${run.out}`);
  const r = JSON.parse(json) as {
    stdout: string;
    stderr: string;
    exitCode: number | null;
    file: string | null;
  };
  return observed({ ...r, file: r.file === null ? undefined : Buffer.from(r.file, 'base64') });
}

test.describe('node:zlib goal scenario vs Node (COI Workbench)', () => {
  test.beforeAll(async ({ browser }) => {
    test.setTimeout(300_000);
    page = await browser.newPage();
    await serveSteps(page, oracleOf);
    await gotoHarness(page);
    await bootOwner(page, {
      workspaceId: 'bu-zlib-scenario',
      template: 'hidden-empty',
      persistence: 'ephemeral',
    });
    const install = await execLine(page, 'npm install');
    expect(install.exit, install.out).toBe(0);
    await page.evaluate(
      async ({ fixtureUrl, text }) => {
        const fixture = await import(/* @vite-ignore */ fixtureUrl);
        await fixture.writeProjectText('/scratch/zrun.cjs', text.runner);
        await fixture.writeProjectText('/scratch/zunpack.cjs', text.unpack);
      },
      { fixtureUrl: sealedWorkbenchFixtureUrl, text: { runner: RUNNER, unpack: UNPACK } },
    );
  });
  test.afterAll(async () => {
    await closeOwner(page);
    await page.close();
  });

  for (const step of STEPS) {
    test(`${step.id} ${step.title} — today pinned; ${GREEN_BY}`, async () => {
      test.setTimeout(300_000);
      const s = oracleOf().get(step.id);
      if (s === undefined) throw new Error(`no oracle for ${step.id}`);
      const rifty = pinOf(await inWorkbench(step), BROWSER_MASKS);
      expect(rifty).toEqual(PINS[step.id]);
      expect(rifty, 'the pin is a gap against live Node').not.toEqual(pinOf(observed(s.node)));
    });
  }
});
