// One consumer scenario per run; prints a JSON digest of everything it produced.
// usage: node [-r swap-binding.cjs] consumer-scenarios.cjs <scenario> REPO CONSUMERS_DIR
'use strict';
const { createHash } = require('node:crypto');
const { createRequire } = require('node:module');
const { join } = require('node:path');
const { Readable } = require('node:stream');

const [scenario, repo, consumers] = process.argv.slice(2);
const fromExceljs = createRequire(
  require('node:fs').realpathSync(
    join(repo, 'packages/isolate-host/node_modules/exceljs/package.json'),
  ),
);
const fromConsumers = createRequire(join(consumers, 'package.json'));
const sha = (b) => createHash('sha256').update(b).digest('hex').slice(0, 16);
const T0 = 1_700_000_000_000; // frozen clock: zip entry dates, xlsx/pdf timestamps
const RealDate = Date;
global.Date = class extends RealDate {
  constructor(...a) {
    super(...(a.length ? a : [T0]));
  }
  static now() {
    return T0;
  }
};

async function xlsx() {
  const ExcelJS = fromExceljs('exceljs');
  const chunks = [];
  const stream = new (require('node:stream').Writable)({
    write(c, _e, cb) {
      chunks.push(c);
      cb();
    },
  });
  const wb = new ExcelJS.stream.xlsx.WorkbookWriter({ stream, useSharedStrings: true });
  wb.created = wb.modified = new Date(T0);
  const ws = wb.addWorksheet('Revenue');
  for (let i = 0; i < 5000; i++) ws.addRow([`region-${i % 17}`, i * 3, i / 7]).commit();
  await wb.commit();
  return Buffer.concat(chunks);
}

const scenarios = {
  // exceljs streaming WorkbookWriter → archiver → crc32-stream (class extends zlib.DeflateRaw).
  async 'exceljs-stream-writer'() {
    const b = await xlsx();
    return { bytes: b.length, sha: sha(b) };
  },
  // unzipper: Open.buffer (createInflateRaw per entry) and Parse (piped stream) over that xlsx.
  async unzipper() {
    const unzipper = fromExceljs('unzipper');
    const b = await xlsx();
    const dir = await unzipper.Open.buffer(b);
    const open = [];
    for (const f of dir.files) open.push(`${f.path}:${sha(await f.buffer())}`);
    const parsed = [];
    await new Promise((res, rej) => {
      Readable.from([b.subarray(0, 7000), b.subarray(7000)])
        .pipe(unzipper.Parse())
        .on('entry', async (e) => {
          const c = [];
          for await (const x of e) c.push(x);
          parsed.push(`${e.path}:${sha(Buffer.concat(c))}`);
        })
        .on('close', res)
        .on('error', rej);
    });
    await new Promise((r) => setTimeout(r, 50));
    return { open, parsed: parsed.sort() };
  },
  // ws permessage-deflate (no socket): server/client negotiate, compress with/without fin, decompress.
  async 'ws-permessage-deflate'() {
    const wsReq = createRequire(
      join(repo, 'node_modules/.pnpm/ws@8.23.0/node_modules/ws/package.json'),
    );
    const PMD = wsReq('./lib/permessage-deflate');
    const { format, parse } = wsReq('./lib/extension'); // the header round trip a real handshake does
    const server = new PMD({
      serverMaxWindowBits: 10,
      clientMaxWindowBits: 11,
      threshold: 0,
      isServer: true,
    });
    const client = new PMD({ threshold: 0 });
    const wire = (p) => parse(format({ [PMD.extensionName]: [p] }))[PMD.extensionName];
    const params = server.accept(wire(client.offer()));
    client.accept(wire(params));
    const call = (fn, ...a) => new Promise((res, rej) => fn(...a, (e, r) => (e ? rej(e) : res(r))));
    const out = [];
    const msgs = ['hello', 'hello hello hello', Buffer.alloc(70000, 7), 'x'.repeat(300000)];
    for (const [i, m] of msgs.entries()) {
      const c = await call(server.compress.bind(server), Buffer.from(m), i % 2 === 0);
      out.push(sha(c));
      const fin = i % 2 === 0;
      const d = await call(client.decompress.bind(client), c, fin);
      out.push(fin ? sha(d) : `partial:${d.length}`);
    }
    server.cleanup();
    client.cleanup();
    return { params, out };
  },
  // pngjs: PNG.sync.write (deflateSync) and PNG.sync.read (sync-inflate: zlib.Inflate.call + _handle).
  async 'pngjs-sync'() {
    const { PNG } = fromConsumers('pngjs');
    const png = new PNG({ width: 300, height: 200 });
    for (let i = 0; i < png.data.length; i++) png.data[i] = ((i * 7) % 256) ^ (i >> 9);
    const file = PNG.sync.write(png);
    const back = PNG.sync.read(file);
    return { file: sha(file), roundTrip: Buffer.compare(back.data, png.data) === 0 };
  },
  // pdfkit: compressed content streams (deflateSync).
  async pdfkit() {
    const PDFDocument = fromConsumers('pdfkit');
    const doc = new PDFDocument({ compress: true, info: { CreationDate: new Date(T0) } });
    const c = [];
    doc.on('data', (x) => c.push(x));
    const done = new Promise((r) => doc.on('end', r));
    for (let i = 0; i < 40; i++)
      doc.text(`Row ${i}: the quick brown fox jumps over the lazy dog ${i * 17}`);
    doc.end();
    await done;
    const b = Buffer.concat(c);
    return { bytes: b.length, sha: sha(b) };
  },
};
scenarios[scenario]().then(
  (r) => console.log(JSON.stringify(r)),
  (e) => {
    console.log(JSON.stringify({ error: `${e.name}: ${e.message}` }));
    process.exitCode = 1;
  },
);
