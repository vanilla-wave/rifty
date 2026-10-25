import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { withClientServer } from './client-bundle-browser-proof.mjs';

const ioScenario = `
const {Buffer,EventEmitter,Stream,Readable,Writable,Duplex,Transform,PassThrough} = api;
const constructors={Buffer,EventEmitter,Stream,Readable,Writable,Duplex,Transform,PassThrough};
const buffer=Buffer.alloc(4);buffer.writeUInt32BE(0x01020304);
const store=new ArrayBuffer(4);new Uint8Array(store).set([1,2,3,4]);
Buffer.from(store,1,2)[0]=9;
const events=[];const emitter=new EventEmitter();emitter.once('value',value=>events.push(value));emitter.emit('value',42);emitter.emit('value',7);
const legacy=Object.create(Stream.prototype);Stream.call(legacy);legacy.on('value',value=>events.push(value));legacy.emit('value',8);
const instances={
 Readable:new Readable({read(){this.push(null)}}),
 Writable:new Writable({write(chunk,encoding,done){done()}}),
 Duplex:new Duplex({read(){this.push(null)},write(chunk,encoding,done){done()}}),
 Transform:new Transform({transform(chunk,encoding,done){done(null,chunk)}}),
 PassThrough:new PassThrough(),
};
const identity=Object.fromEntries(Object.entries({Buffer:buffer,EventEmitter:emitter,Stream:legacy,...instances}).map(([name,value])=>[name,value.constructor===constructors[name]]));
for(const value of Object.values(instances))value.destroy();
let streamed='';for await(const chunk of Readable.from([Buffer.from('a'),Buffer.from('b')]).pipe(new PassThrough()))streamed+=chunk.toString();
console.log(JSON.stringify({names:Object.fromEntries(Object.entries(constructors).map(([name,value])=>[name,value.name])),identity,hex:buffer.toString('hex'),store:[...new Uint8Array(store)],events,streamed}));
`;

export async function proveSdkPackaging(root, report) {
  const failures = [];
  for (const artifact of report.rows.filter((row) => ['main', 'sw'].includes(row.name))) {
    const bytes = Object.entries(artifact.inputs)
      .filter(([input]) => input.endsWith('/@riftydev/io/dist/index.js'))
      .reduce((total, [, bytes]) => total + bytes, 0);
    try {
      assert(bytes <= 5120, `${artifact.name}: unused io code retained (${bytes} > 5120)`);
    } catch (error) {
      failures.push(error);
    }
  }
  const invoke = (prefix) =>
    JSON.parse(
      execFileSync(
        process.execPath,
        ['--input-type=module', '--eval', `${prefix}\n${ioScenario}`],
        { encoding: 'utf8', timeout: 15_000 },
      ),
    );
  const expected = invoke(
    `import {Buffer as NativeBuffer} from 'node:buffer'; import {EventEmitter as NativeEventEmitter} from 'node:events'; import * as streams from 'node:stream'; const api={...streams,Buffer:NativeBuffer,EventEmitter:NativeEventEmitter};`,
  );
  const entry = report.rows.find((row) => row.name === 'ioProbe').entry;
  const actual = invoke(
    `const api=await import(${JSON.stringify(pathToFileURL(resolve(root, `.${entry}`)).href)});`,
  );
  try {
    assert.deepEqual(
      actual,
      expected,
      'minified packed io constructors/prototypes/operations differ from Node',
    );
  } catch (error) {
    failures.push(error);
  }
  try {
    assert(
      report.rows.find((row) => row.name === 'main').backendLoad,
      'SDK has no deferred generic backend entry',
    );
  } catch (error) {
    failures.push(error);
  }
  if (failures.length) throw new AggregateError(failures, 'SDK packaging failures');
  await proveBackendDeferral(root, report);
  await proveSourceWorker(root);
}

async function proveBackendDeferral(root, report) {
  const main = report.rows.find((row) => row.name === 'main');
  const generic = report.rows.find((row) => row.name === 'generic').entry;
  const toolchain = report.rows.find((row) => row.name === 'toolchain').entry;
  await withClientServer(root, async (browser, base) => {
    for (const fault of [false, true]) {
      const context = await browser.newContext();
      try {
        const page = await context.newPage();
        const requests = [];
        page.on('request', (request) => requests.push(new URL(request.url()).pathname));
        if (fault) await page.route(`${base}${main.backendLoad}`, (route) => route.abort());
        await page.goto(base);
        await page.evaluate(
          async ({ entry, toolchain }) => {
            const { createSandbox } = await import(entry);
            const sandbox = await createSandbox({
              requireCrossOriginIsolation: false,
              skipServiceWorker: true,
              toolchain: { workerUrl: toolchain },
            });
            try {
              await sandbox.fs.writeFile('/toolchain.txt', 'ok');
            } finally {
              sandbox.dispose();
            }
          },
          { entry: main.entry, toolchain },
        );
        assert(!requests.includes(main.backendLoad), 'toolchain boot loaded page backend');
        const result = await page.evaluate(
          async ({ entry, generic }) => {
            const { createSandbox } = await import(entry);
            const warnings = [];
            const sandbox = await createSandbox({
              requireCrossOriginIsolation: false,
              skipServiceWorker: true,
              workerUrl: generic,
              logger: {
                warn: (message) => warnings.push(String(message)),
                error: (message) => warnings.push(String(message)),
              },
            });
            try {
              await sandbox.fs.writeFile('/generic.txt', '42');
              return {
                vfs: sandbox.vfs,
                value: await sandbox.fs.readFile('/generic.txt', 'utf8'),
                warnings,
              };
            } finally {
              sandbox.dispose();
            }
          },
          { entry: main.entry, generic },
        );
        assert(requests.includes(main.backendLoad), 'generic creation never requested backend');
        assert.equal(result.value, '42');
        if (fault) {
          assert.equal(result.vfs.backend, 'memory');
          assert.match(result.vfs.reason, /Failed to fetch dynamically imported module/u);
          assert(result.warnings.some((message) => message.includes('falling back to memory')));
        }
      } finally {
        await context.close();
      }
    }
  });
}

async function proveSourceWorker(root) {
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const result = await build({
    absWorkingDir: repo,
    stdin: {
      contents: "import '@riftydev/workbench/no-coi-toolchain-worker';",
      resolveDir: resolve(repo, 'apps/playground'),
    },
    outdir: resolve(root, 'measure/workbench-source'),
    bundle: true,
    splitting: true,
    minify: true,
    format: 'esm',
    platform: 'browser',
    metafile: true,
    logLevel: 'silent',
  });
  const entry = Object.entries(result.metafile.outputs).find(
    ([, output]) => output.entryPoint === '<stdin>',
  );
  assert(entry && entry[1].bytes > 0, 'source wrapper entry was dropped');
  const url = `/${relative(root, resolve(repo, entry[0])).replaceAll('\\', '/')}`;
  await withClientServer(root, async (browser, base) => {
    const page = await browser.newPage();
    await page.goto(base);
    await page.evaluate((entry) => {
      const worker = new Worker(entry, { type: 'module' });
      globalThis.sourceProof = { worker, output: '', result: null };
      worker.onmessage = ({ data }) => {
        if (data.type === 'toolchain-ready')
          worker.postMessage({
            type: 'eval',
            request: { id: 1, code: 'console.log(Buffer.from("source-ok").toString());void 0' },
          });
        if (data.type === 'stdout') globalThis.sourceProof.output += data.chunk;
        if (data.type === 'result') globalThis.sourceProof.result = data.result;
      };
    }, url);
    await page.waitForFunction(() => globalThis.sourceProof.result !== null);
    const observed = await page.evaluate(() => {
      globalThis.sourceProof.worker.terminate();
      return { output: globalThis.sourceProof.output, result: globalThis.sourceProof.result };
    });
    assert.equal(observed.result.ok, true);
    assert.equal(observed.output.trim(), 'source-ok');
  });
}
