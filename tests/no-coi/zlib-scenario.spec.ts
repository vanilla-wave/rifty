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
  BROWSER_MASKS,
  STEP_URL,
  UNPACK,
  serveSteps,
} from '../browser-unit/fixtures/zlib-scenario.ts';
import { type Page, expect, test } from './fixtures/test.ts';

// node:zlib goal carrier (backlog epics/node-zlib-on-every-host/map.md item 1), no-COI SDK host
// (Chromium): one sandbox, each step's workspace unpacked by a guest `node` to `/zs/z<id>`, run as
// `project({ root }).run('node <step> <out>')` against live `node <step>` over the same files.
// Today's outcome pinned whole per step (with the run's `status` and failure); the unit
// delivering it compares with Node instead. COI Workbench twin: tests/browser-unit.

/** The completion's `error` without its `stack` (its frames are dev-server URLs). */
type Failure = Readonly<Record<string, string>>;
interface SdkPin extends Pin {
  readonly status: string;
  readonly failure: Failure | null;
}
/**
 * Today's outcome, measured on main dfad6553e: whole stderr under `BROWSER_MASKS`. A throw from an
 * async task or of a `NotImplementedError` at a file entry's top level fails the run (exit code
 * null; backlog distribution/no-coi-command-unhandled-rejection-exit); step 1's reaches no stderr,
 * only the Worker-crash failure.
 */
const PINS: Readonly<Record<StepId, SdkPin>> = {
  '1': {
    exitCode: null,
    stdout: '',
    stderr: '',
    output: null,
    status: 'failed',
    failure: {
      name: 'Error',
      message:
        'Worker crashed: Uncaught NotImplementedError: Not implemented: zlib.DeflateRaw (this stream not implemented yet; buffer the input, then call async zlib.deflateRaw: zlib.deflateRaw(buf, cb) or await util.promisify(zlib.deflateRaw)(buf))',
      code: 'WORKER_CRASHED',
    },
  },
  '2': {
    exitCode: null,
    stdout: '',
    stderr: `NotImplementedError: Not implemented: zlib.createInflateRaw (this stream not implemented yet; buffer the input, then call async zlib.inflateRaw: zlib.inflateRaw(buf, cb) or await util.promisify(zlib.inflateRaw)(buf))
    at <rifty frames>
    at eval (/zs/z2/node_modules/unzipper/lib/Open/unzip.js:89:52)
    at tryCatcher (/zs/z2/node_modules/bluebird/js/release/util.js:16:23)
    at Promise._settlePromiseFromHandler (/zs/z2/node_modules/bluebird/js/release/promise.js:510:31)
    at Promise._settlePromise (/zs/z2/node_modules/bluebird/js/release/promise.js:567:18)
    at Promise._settlePromise0 (/zs/z2/node_modules/bluebird/js/release/promise.js:612:10)
    at Promise._settlePromises (/zs/z2/node_modules/bluebird/js/release/promise.js:691:18)
    at Async._drainQueue (/zs/z2/node_modules/bluebird/js/release/async.js:133:16)
    at Async._drainQueues (/zs/z2/node_modules/bluebird/js/release/async.js:143:10)
    at Async.drainQueues (/zs/z2/node_modules/bluebird/js/release/async.js:17:14)
    at <rifty frames>
`,
    output: null,
    status: 'failed',
    failure: {
      name: 'NotImplementedError',
      message:
        'Not implemented: zlib.createInflateRaw (this stream not implemented yet; buffer the input, then call async zlib.inflateRaw: zlib.inflateRaw(buf, cb) or await util.promisify(zlib.inflateRaw)(buf))',
      feature: 'zlib.createInflateRaw',
    },
  },
  '3w': {
    exitCode: null,
    stdout: '',
    stderr: `NotImplementedError: Not implemented: zlib.createDeflate (this stream not implemented yet; buffer the input, then call async zlib.deflate: zlib.deflate(buf, cb) or await util.promisify(zlib.deflate)(buf))
    at <rifty frames>
    at Packer.createDeflate (/zs/z3w/node_modules/pngjs/lib/packer.js:73:24)
    at new module.exports (/zs/z3w/node_modules/pngjs/lib/packer-async.js:14:32)
    at new exports.PNG (/zs/z3w/node_modules/pngjs/lib/png.js:44:18)
    at Object.<anonymous> (/zs/z3w/3w-pngjs-write.js:6:42)
    at <rifty frames>
`,
    output: null,
    status: 'failed',
    failure: {
      name: 'NotImplementedError',
      message:
        'Not implemented: zlib.createDeflate (this stream not implemented yet; buffer the input, then call async zlib.deflate: zlib.deflate(buf, cb) or await util.promisify(zlib.deflate)(buf))',
      feature: 'zlib.createDeflate',
    },
  },
  '3r': {
    exitCode: 1,
    stdout: '',
    stderr: `TypeError: Class constructors cannot be invoked without 'new'
    at new Inflate (/zs/z3r/node_modules/pngjs/lib/sync-inflate.js:18:16)
    at inflateSync (/zs/z3r/node_modules/pngjs/lib/sync-inflate.js:162:25)
    at module.exports (/zs/z3r/node_modules/pngjs/lib/parser-sync.js:85:20)
    at exports.read (/zs/z3r/node_modules/pngjs/lib/png-sync.js:7:10)
    at Object.<anonymous> (/zs/z3r/3r-pngjs-read.js:7:23)
    at <rifty frames>
`,
    output: null,
    status: 'exited',
    failure: null,
  },
  '4': {
    exitCode: null,
    stdout: '',
    stderr: `NotImplementedError: Not implemented: zlib.deflateSync (sync zlib not implemented yet; async zlib.deflate works: zlib.deflate(buf, cb) or await util.promisify(zlib.deflate)(buf))
    at <rifty frames>
    at PDFReference.finalize (/zs/z4/node_modules/pdfkit/js/pdfkit.js:201:28)
    at PDFReference.end (/zs/z4/node_modules/pdfkit/js/pdfkit.js:193:10)
    at PDFPage.end (/zs/z4/node_modules/pdfkit/js/pdfkit.js:434:25)
    at PDFDocument.flushPages (/zs/z4/node_modules/pdfkit/js/pdfkit.js:5855:12)
    at PDFDocument.end (/zs/z4/node_modules/pdfkit/js/pdfkit.js:5912:10)
    at Object.<anonymous> (/zs/z4/4-pdfkit.js:26:5)
    at <rifty frames>
`,
    output: null,
    status: 'failed',
    failure: {
      name: 'NotImplementedError',
      message:
        'Not implemented: zlib.deflateSync (sync zlib not implemented yet; async zlib.deflate works: zlib.deflate(buf, cb) or await util.promisify(zlib.deflate)(buf))',
      feature: 'zlib.deflateSync',
    },
  },
  '5a': {
    exitCode: null,
    stdout: '',
    stderr: `NotImplementedError: Not implemented: zlib.gunzipSync (sync zlib not implemented yet; async zlib.gunzip works: zlib.gunzip(buf, cb) or await util.promisify(zlib.gunzip)(buf))
    at <rifty frames>
    at Object.<anonymous> (/zs/z5a/5a-gunzip-members.js:5:33)
    at <rifty frames>
`,
    output: null,
    status: 'failed',
    failure: {
      name: 'NotImplementedError',
      message:
        'Not implemented: zlib.gunzipSync (sync zlib not implemented yet; async zlib.gunzip works: zlib.gunzip(buf, cb) or await util.promisify(zlib.gunzip)(buf))',
      feature: 'zlib.gunzipSync',
    },
  },
  '5b': {
    exitCode: null,
    stdout: '',
    stderr: `NotImplementedError: Not implemented: zlib.unzip (gzip/zlib auto-detect not implemented yet; pick by header: gzip input (starts 1f 8b) → async zlib.gunzip, else → async zlib.inflate; both take (buf, cb) and work with util.promisify)
    at <rifty frames>
    at Object.<anonymous> (/zs/z5b/5b-unzip.js:6:6)
    at <rifty frames>
`,
    output: null,
    status: 'failed',
    failure: {
      name: 'NotImplementedError',
      message:
        'Not implemented: zlib.unzip (gzip/zlib auto-detect not implemented yet; pick by header: gzip input (starts 1f 8b) → async zlib.gunzip, else → async zlib.inflate; both take (buf, cb) and work with util.promisify)',
      feature: 'zlib.unzip',
    },
  },
  '6': {
    exitCode: null,
    stdout: 'params {"client_max_window_bits":11,"server_max_window_bits":10}\n',
    stderr: `NotImplementedError: Not implemented: zlib.createDeflateRaw (this stream not implemented yet; buffer the input, then call async zlib.deflateRaw: zlib.deflateRaw(buf, cb) or await util.promisify(zlib.deflateRaw)(buf))
    at <rifty frames>
    at PerMessageDeflate._compress (/zs/z6/node_modules/ws/lib/permessage-deflate.js:416:28)
    at eval (/zs/z6/node_modules/ws/lib/permessage-deflate.js:326:12)
    at [kRun] (/zs/z6/node_modules/ws/lib/limiter.js:50:7)
    at Limiter.add (/zs/z6/node_modules/ws/lib/limiter.js:35:15)
    at PerMessageDeflate.compress (/zs/z6/node_modules/ws/lib/permessage-deflate.js:325:17)
    at eval (/zs/z6/6-ws.js:6:54)
    at new Promise (<anonymous>)
    at call (/zs/z6/6-ws.js:6:28)
    at eval (/zs/z6/6-ws.js:24:21)
`,
    output: null,
    status: 'failed',
    failure: {
      name: 'NotImplementedError',
      message:
        'Not implemented: zlib.createDeflateRaw (this stream not implemented yet; buffer the input, then call async zlib.deflateRaw: zlib.deflateRaw(buf, cb) or await util.promisify(zlib.deflateRaw)(buf))',
      feature: 'zlib.createDeflateRaw',
    },
  },
  '7a': {
    exitCode: null,
    stdout: '',
    stderr: `NotImplementedError: Not implemented: zlib.crc32 (crc32 not implemented yet; node:zlib has no working alternative)
    at <rifty frames>
    at Object.<anonymous> (/zs/z7a/7a-crc32.js:6:37)
    at <rifty frames>
`,
    output: null,
    status: 'failed',
    failure: {
      name: 'NotImplementedError',
      message:
        'Not implemented: zlib.crc32 (crc32 not implemented yet; node:zlib has no working alternative)',
      feature: 'zlib.crc32',
    },
  },
  '7b': {
    exitCode: 0,
    stdout:
      '{"error":true,"name":"TypeError","message":"The compressed data was not valid: invalid code -- missing end-of-block."}\n',
    stderr: '',
    output: null,
    status: 'exited',
    failure: null,
  },
};

const root = process.cwd().replaceAll('\\', '/');
let oracle: ReadonlyMap<StepId, OracleStep> | undefined;
const oracleOf = (): ReadonlyMap<StepId, OracleStep> => {
  oracle ??= runOracle();
  return oracle;
};
let page: Page;

interface SdkRun {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number | null;
  readonly status: string;
  readonly failure: Failure | null;
  readonly file: number[] | null;
}

async function inSdk(step: OracleStep['step']): Promise<SdkPin> {
  const r = await page.evaluate(
    async ({ url, id, program, out, unpack }): Promise<SdkRun> => {
      interface Outcome {
        stdout: string;
        stderr: string;
        exitCode: number | null;
        status: string;
        error?: Record<string, string>;
      }
      const sandbox = (globalThis as Record<string, unknown>).__zlibScenario as {
        fs: {
          writeFile(p: string, d: Uint8Array | string): Promise<void>;
          readFile(p: string): Promise<Uint8Array>;
        };
        project(o: { root: string }): { run(line: string): { completion: Promise<Outcome> } };
      };
      const body = new Uint8Array(await (await fetch(url)).arrayBuffer());
      await sandbox.fs.writeFile(`/zs/z${id}.bin`, body);
      await sandbox.fs.writeFile('/zs/zunpack.cjs', unpack);
      const unpacked = await sandbox
        .project({ root: '/zs' })
        .run(`node zunpack.cjs z${id}.bin z${id}`).completion;
      if (unpacked.exitCode !== 0) throw new Error(`unpack: ${unpacked.stderr}`);
      const done = await sandbox.project({ root: `/zs/z${id}` }).run(`node ${program} ${out}`)
        .completion;
      let file: number[] | null = null;
      try {
        file = Array.from(await sandbox.fs.readFile(`/zs/z${id}/${out}`));
      } catch {}
      const e = done.error;
      return {
        stdout: done.stdout,
        stderr: done.stderr,
        exitCode: done.exitCode,
        status: done.status,
        failure:
          e === undefined
            ? null
            : Object.fromEntries(Object.entries(e).filter(([key]) => key !== 'stack')),
        file,
      };
    },
    {
      url: `${STEP_URL}${step.id}`,
      id: step.id,
      program: step.program,
      out: outPath(step),
      unpack: UNPACK,
    },
  );
  const pin = pinOf(
    observed({ ...r, file: r.file === null ? undefined : Uint8Array.from(r.file) }),
    BROWSER_MASKS,
  );
  return { ...pin, status: r.status, failure: r.failure };
}

test.describe('node:zlib goal scenario vs Node (no-COI SDK)', () => {
  test.beforeAll(async ({ browser }) => {
    test.setTimeout(300_000);
    page = await browser.newPage();
    await serveSteps(page, oracleOf);
    await page.goto('/no-coi-harness.html');
    await page.evaluate(async (root) => {
      const { createSandbox } = await import(`/@fs${root}/packages/rifty/src/index.ts`);
      (globalThis as Record<string, unknown>).__zlibScenario = await createSandbox({
        requireCrossOriginIsolation: false,
        skipServiceWorker: true,
        toolchain: {
          workerUrl: `/@fs${root}/packages/workbench/src/workers/no-coi-toolchain-worker.ts`,
        },
      });
    }, root);
  });
  test.afterAll(async () => {
    await page.evaluate(() =>
      ((globalThis as Record<string, unknown>).__zlibScenario as { dispose(): void }).dispose(),
    );
    await page.close();
  });

  for (const step of STEPS) {
    test(`${step.id} ${step.title} — today pinned; ${GREEN_BY}`, async () => {
      test.setTimeout(300_000);
      const s = oracleOf().get(step.id);
      if (s === undefined) throw new Error(`no oracle for ${step.id}`);
      const rifty = await inSdk(step);
      expect(rifty).toEqual(PINS[step.id]);
      const node = { ...pinOf(observed(s.node)), status: 'exited', failure: null };
      expect(rifty, 'the pin is a gap against live Node').not.toEqual(node);
    });
  }
});
