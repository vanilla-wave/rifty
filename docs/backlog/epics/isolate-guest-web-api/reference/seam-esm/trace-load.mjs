// Which runtime code reads a ceiling global before guest code (module load or setUp()), with the
// source frame (trace-load variant, build-variants.mjs; guest.js.map maps the bundle).
//   node docs/backlog/epics/isolate-guest-web-api/reference/seam-esm/trace-load.mjs [--json out.json]
import { readFileSync, writeFileSync } from 'node:fs';
import { SourceMap } from 'node:module';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../../../../../..');
const dist = join(root, 'packages/isolate-host/node_modules/.web-api-probe/trace-load/dist');
const { runCode, createSandbox } = await import(pathToFileURL(join(dist, 'index.js')).href);
const map = new SourceMap(JSON.parse(readFileSync(join(dist, 'guest.js.map'), 'utf8')));
const mapDir = dist;

const PRINT = 'require("fs").writeSync(1, JSON.stringify(globalThis.__probeLoadReads))';
const mapFrame = (line) => {
  const m = /rifty-isolate-guest\.js:(\d+):(\d+)/.exec(line);
  if (!m) return null;
  const e = map.findEntry(Number(m[1]) - 1, Number(m[2]) - 1);
  if (!e?.originalSource) return null;
  const src = relative(root, fileURLToPath(new URL(e.originalSource, pathToFileURL(`${mapDir}/`))));
  const fn = /at (?:new )?([^\s(]+) \(/.exec(line)?.[1] ?? '<top>';
  return `${src}:${e.originalLine + 1} ${fn}`;
};
const summarise = (reads) =>
  reads.map(({ name, stack }) => {
    const frames = stack
      .split('\n')
      .slice(1)
      .map(mapFrame)
      .filter((f) => f && !f.startsWith('packages/isolate-guest/src/guest/web-shim.ts'));
    const phase = frames.some((f) => / setUp$/.test(f)) ? 'setUp' : 'load';
    return { name, phase, at: frames[0], via: frames.slice(1, 4) };
  });

const evalRun = await runCode(PRINT);
const sb = await createSandbox();
await sb.writeFile('p.cjs', PRINT);
const fileRun = await sb.exec('p.cjs');
await sb.destroy();
const out = {
  eval: summarise(JSON.parse(evalRun.stdout)),
  file: summarise(JSON.parse(fileRun.stdout)),
};
for (const [k, rows] of Object.entries(out)) {
  console.log(`\n## ${k} (${rows.length} reads)`);
  const seen = new Map();
  for (const r of rows) {
    const key = `${r.name} | ${r.phase} | ${r.at}`;
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  for (const [key, n] of seen) console.log(`${key}${n > 1 ? ` ×${n}` : ''}`);
}
const json = process.argv.indexOf('--json');
if (json > 0) writeFileSync(process.argv[json + 1], `${JSON.stringify(out, null, 2)}\n`);
process.exit(0);
