import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { chromium } from '@playwright/test';
import { loadCorpus } from '../src/corpus.ts';
import type { FileTree } from '../src/files.ts';
import { writeTree } from '../src/files.ts';
import {
  freePort,
  killProcessGroup,
  runOrThrow,
  spawnLoggedServer,
  waitHttpReady,
} from '../src/proc.ts';

const task = (await loadCorpus(process.argv[2] ?? 'pilot-v3')).find(
  (t) => t.family === 'contact-import',
)!;
const root = await mkdtemp(join(tmpdir(), 'rifty-csv-export-controls-'));
const reference = task.controls!.reference!;
const source = reference['src/main.tsx']!;
const quoteAll = source.replace(
  /const encode=.*?;\n/,
  'const encode=(value:string)=>`"${value.replaceAll(\'"\',\'""\')}"`;\n',
);
assert.notEqual(quoteAll, source);
const actual = JSON.parse(
  gunzipSync(
    await readFile('tools/agent-bench/tests/fixtures/csv-pilot-v2-programme1.json.gz'),
  ).toString(),
) as FileTree;
const quotedHeader = quoteAll.replace(
  "['name,email',...matches.map",
  "[['name','email'].map(encode).join(','),...matches.map",
);
const brokenEscape = quoteAll.replace("value.replaceAll('\"','\"\"')", 'value');
const hiddenCsv =
  "['name,email',...matches.map(row=>`\"${row.name.replaceAll('\"','\"\"')}\",\"${row.email.replaceAll('\"','\"\"')}\"`)].join('\\n')";
const variants = [
  { name: 'actual-programme1', files: actual, pass: true },
  { name: 'quote-all', files: { ...reference, 'src/main.tsx': quoteAll }, pass: true },
  {
    name: 'quoted-header-pre',
    files: {
      ...reference,
      'src/main.tsx': quotedHeader.replace(
        '<label>Exported CSV<textarea readOnly value={output}/></label>',
        '<div aria-label="Exported CSV"><pre>{output}</pre></div>',
      ),
    },
    pass: true,
  },
  {
    name: 'no-header',
    files: {
      ...reference,
      'src/main.tsx': quoteAll.replace("['name,email',...matches.map", '[...matches.map'),
    },
    pass: true,
  },
  { name: 'broken-escaping', files: { ...reference, 'src/main.tsx': brokenEscape }, pass: false },
  {
    name: 'broken-filter',
    files: {
      ...reference,
      'src/main.tsx': quoteAll.replace(/const matches=rows.filter\(.*?\);/, 'const matches=rows;'),
    },
    pass: false,
  },
  {
    name: 'duplicate-row',
    files: {
      ...reference,
      'src/main.tsx': quoteAll.replace(
        '...matches.map(row=>',
        '...matches.concat(matches).map(row=>',
      ),
    },
    pass: false,
  },
  {
    name: 'hidden-correct-output',
    files: {
      ...reference,
      'src/main.tsx': brokenEscape.replace(
        '</main>',
        `<div style={{height:10}}><pre hidden>{${hiddenCsv}}</pre></div></main>`,
      ),
    },
    pass: false,
  },
  { name: 'baseline', files: task.files, pass: false },
  { name: 'reference', files: reference, pass: true },
  { name: 'partial', files: { ...task.files, ...task.controls!.partial! }, pass: false },
  { name: 'alternative', files: { ...task.files, ...task.controls!.alternative! }, pass: true },
];
await mkdir(root, { recursive: true });
await writeTree(root, task.files);
await runOrThrow('npm', ['install', '--no-audit', '--no-fund'], { cwd: root, timeoutMs: 300000 });
const browser = await chromium.launch();
const evidence = [];
try {
  for (const variant of variants.filter((v) => !process.argv[3] || v.name === process.argv[3])) {
    await writeTree(root, variant.files);
    const port = await freePort();
    const url = `http://127.0.0.1:${port}/`;
    const server = spawnLoggedServer(
      join(root, 'node_modules/.bin/vite'),
      ['--host', '127.0.0.1', '--port', String(port), '--strictPort'],
      { cwd: root, env: process.env, logPath: join(root, 'server.log'), detached: true },
    );
    const context = await browser.newContext();
    try {
      await waitHttpReady(url, 30000, 'CSV export control');
      const page = await context.newPage();
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(url);
      const result = await task.judge!({ view: page, previewUrl: url });
      evidence.push({
        variant: variant.name,
        expectedPass: variant.pass,
        result,
        errors,
        source: variant.files,
      });
      console.log(
        JSON.stringify({ variant: variant.name, expectedPass: variant.pass, result, errors }),
      );
    } finally {
      await context.close();
      await killProcessGroup(server);
    }
  }
} finally {
  await browser.close();
  await writeFile(join(root, 'evidence.json'), JSON.stringify(evidence, null, 2));
  console.log(`CSV_EXPORT_CONTROL_ARTIFACTS ${root}`);
}
for (const row of evidence) {
  assert.equal(row.result.pass, row.expectedPass, row.variant);
  assert.deepEqual(row.errors, [], row.variant);
}
