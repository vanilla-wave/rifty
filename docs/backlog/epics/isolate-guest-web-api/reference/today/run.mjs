// Today's outcomes for the narrowed goal (Blob/File, TextDecoder, Abort/Event globals) in the isolate
// guest vs live Node. From the repo root after `pnpm --filter @riftydev/isolate-host build`:
//   node docs/backlog/epics/isolate-guest-web-api/reference/today/run.mjs <docx-dir> [--json out.json]
// <docx-dir>: a dir with docx@9.15.3 installed (`npm i docx@9.15.3`); pptxgenjs and pdfkit come
// from packages/isolate-host's devDependencies.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../../../../../..');
const hostDir = join(root, 'packages/isolate-host');
const { createSandbox, runCode } = await import(pathToFileURL(join(hostDir, 'dist/index.js')).href);
const { GUEST_DIRS, MemoryFsSync, snapshotFs } = await import(
  pathToFileURL(join(hostDir, 'dist/codec.js')).href
);
const { closureFiles } = await import(pathToFileURL(join(hostDir, 'tests/closure-files.ts')).href);
const argv = process.argv.slice(2);
const jsonAt = argv.indexOf('--json');
const jsonOut = jsonAt >= 0 ? argv.splice(jsonAt, 2)[1] : undefined;
const docxDir = argv[0];
if (!docxDir) throw new Error('usage: run.mjs <docx-dir> [--json out.json]');

function inNode(files, gen) {
  const dir = mkdtempSync(join(tmpdir(), 'web-api-today-'));
  try {
    for (const [rel, data] of files) {
      mkdirSync(dirname(join(dir, rel)), { recursive: true });
      writeFileSync(join(dir, rel), data);
    }
    const r = spawnSync(process.execPath, [gen], { cwd: dir, env: {}, encoding: 'utf8' });
    return { stdout: r.stdout, stderr: r.stderr, exitCode: r.status };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
async function inSandbox(files, gen) {
  const fs = new MemoryFsSync();
  for (const d of GUEST_DIRS) fs.mkdirSync(d, { recursive: true });
  for (const [rel, data] of files) {
    const path = `/workspace/${rel}`;
    fs.mkdirSync(path.slice(0, path.lastIndexOf('/')), { recursive: true });
    fs.writeFileSync(path, data);
  }
  const maxFsBytes = 256 * 2 ** 20;
  const sb = await createSandbox({
    snapshot: snapshotFs(fs, { template: null, maxBytes: maxFsBytes }),
    maxFsBytes,
  });
  try {
    const r = await sb.exec(gen, { timeoutMs: 60_000, memoryLimitMb: 512 });
    return { stdout: r.stdout, stderr: r.stderr, exitCode: r.exitCode };
  } finally {
    await sb.destroy();
  }
}
const own = (name) => [name, readFileSync(join(here, name))];
const result = {
  date: '2026-11-25',
  head: spawnSync('git', ['rev-parse', '--short', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
  }).stdout.trim(),
  node: process.version,
};

// 1. API pins: node file, sandbox exec, runCode (-e).
const pinFiles = new Map([own('pins.cjs'), own('encodings.json')]);
const parse = (out) =>
  new Map(
    out
      .split('\n')
      .filter(Boolean)
      .map((l) => l.split('\t')),
  );
const node = inNode(pinFiles, 'pins.cjs');
const guest = await inSandbox(pinFiles, 'pins.cjs');
const evalSrc = readFileSync(join(here, 'pins.cjs'), 'utf8').replace(
  "require('./encodings.json')",
  readFileSync(join(here, 'encodings.json'), 'utf8').trim(),
);
const ev = await runCode(evalSrc);
const n = parse(node.stdout);
const g = parse(guest.stdout);
const e = parse(ev.stdout);
result.pins = [...n.keys()].map((id) => ({
  id,
  node: n.get(id),
  guest: g.get(id) ?? '<missing>',
  eval: e.get(id) ?? '<missing>',
}));
result.pinExit = {
  node: node.exitCode,
  guest: guest.exitCode,
  eval: ev.exitCode,
  guestStderr: guest.stderr.slice(0, 2000),
  evalStderr: ev.stderr.slice(0, 2000),
};

// 2. Scenario: first stop of each generator.
const GEN = {
  'pptx-write.cjs': `const P=require('pptxgenjs');const p=new P();p.addSlide().addText('Hi',{x:1,y:1});
p.write().then(async(b)=>{console.log(Object.prototype.toString.call(b), b && b.constructor && b.constructor.name);
const buf=Buffer.from(await b.arrayBuffer());require('fs').writeFileSync('deck.pptx',buf);console.log('bytes', buf.length>1000);})
.catch((e)=>{console.error(e && e.stack || e);process.exitCode=1;});`,
  'docx-toblob.cjs': `const {Document,Packer,Paragraph}=require('docx');
const doc=new Document({sections:[{children:[new Paragraph('Hello')]}]});
Packer.toBlob(doc).then(async(b)=>{console.log(Object.prototype.toString.call(b));
const buf=Buffer.from(await b.arrayBuffer());require('fs').writeFileSync('r.docx',buf);console.log('bytes', buf.length>1000);})
.catch((e)=>{console.error(e && e.stack || e);process.exitCode=1;});`,
  'pdfkit-font.cjs': `const PDFDocument=require('pdfkit');const doc=new PDFDocument({compress:true});
const chunks=[];doc.on('data',(c)=>chunks.push(c));doc.on('end',()=>{require('fs').writeFileSync('o.pdf',Buffer.concat(chunks));console.log('pdf ok');});
doc.font('Helvetica').text('Hello');doc.end();`,
};
const libs = {
  'pptx-write.cjs': ['pptxgenjs', join(hostDir, 'node_modules/pptxgenjs')],
  'docx-toblob.cjs': ['docx', join(docxDir, 'node_modules/docx')],
  'pdfkit-font.cjs': ['pdfkit', join(hostDir, 'node_modules/pdfkit')],
};
const firstStop = (r) =>
  r.exitCode === 0
    ? 'exit 0'
    : `exit ${r.exitCode}: ${r.stderr.split('\n').find((l) => /\S/.test(l) && !/^\s+at /.test(l)) ?? ''}`;
result.scenario = [];
for (const [gen, src] of Object.entries(GEN)) {
  const [name, dir] = libs[gen];
  const files = closureFiles(name, (await import('node:fs')).realpathSync(dir));
  files.set(gen, new TextEncoder().encode(src));
  const a = inNode(files, gen);
  const b = await inSandbox(files, gen);
  result.scenario.push({
    gen,
    node: firstStop(a),
    nodeStdout: a.stdout,
    guest: firstStop(b),
    guestStdout: b.stdout,
    guestStderr: b.stderr.slice(0, 1500),
  });
}

const lines = [
  `# ${result.date} HEAD ${result.head} node ${result.node}`,
  '',
  'id | node | guest exec | guest runCode',
];
for (const p of result.pins)
  lines.push(
    `${p.id} | ${p.node} | ${p.guest === p.node ? '=' : p.guest} | ${p.eval === p.node ? '=' : p.eval === p.guest ? '= exec' : p.eval}`,
  );
lines.push(
  '',
  `exit node ${result.pinExit.node} exec ${result.pinExit.guest} runCode ${result.pinExit.eval}`,
  '',
  'scenario | node | guest',
);
for (const s of result.scenario)
  lines.push(
    `${s.gen} | ${s.node} ${JSON.stringify(s.nodeStdout.trim())} | ${s.guest} ${JSON.stringify(s.guestStdout.trim())}`,
  );
console.log(lines.join('\n'));
if (jsonOut) writeFileSync(jsonOut, `${JSON.stringify(result, null, 1)}\n`);
