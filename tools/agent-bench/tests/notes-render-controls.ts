import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { chromium } from '@playwright/test';
import { loadCorpus } from '../src/corpus.ts';
import { writeTree } from '../src/files.ts';
import type { FileTree } from '../src/files.ts';
import {
  freePort,
  killProcessGroup,
  runOrThrow,
  spawnLoggedServer,
  waitHttpReady,
} from '../src/proc.ts';

const suite = process.argv[2] ?? 'pilot-v4';
const root = await mkdtemp(join(tmpdir(), 'rifty-caption-controls-'));
const browser = await chromium.launch();
const evidence = [];
try {
  for (const task of (await loadCorpus(suite)).filter(
    (task) => task.family === 'linked-knowledge',
  )) {
    const dir = join(root, task.id);
    await mkdir(dir);
    await writeTree(dir, task.files);
    await runOrThrow('npm', ['install', '--no-audit', '--no-fund'], {
      cwd: dir,
      env: { ...process.env, NODE_PATH: undefined },
      timeoutMs: 300000,
    });
    const reference = task.controls!.reference!;
    const sourcePath = 'src/main.js';
    const original = reference[sourcePath]!;
    const actual = async (n: number) =>
      JSON.parse(
        gunzipSync(
          await readFile(`tools/agent-bench/tests/fixtures/notes-pilot-v3-programme${n}.json.gz`),
        ).toString(),
      ) as FileTree;
    const variants = [
      { name: 'actual-programme1', files: await actual(1), pass: true },
      { name: 'actual-programme3', files: await actual(3), pass: true },
      { name: 'reference', files: reference, pass: true },
      { name: 'baseline', files: task.files, pass: false },
      { name: 'partial', files: { ...task.files, ...task.controls!.partial! }, pass: false },
      { name: 'alternative', files: { ...task.files, ...task.controls!.alternative! }, pass: true },
      {
        name: 'duplicate-preview',
        files: {
          ...reference,
          [sourcePath]: original.replace(
            '${markdown(body)}</section>',
            '${markdown(body)}${markdown(body)}</section>',
          ),
        },
        pass: true,
      },
      {
        name: 'stripped-html',
        files: {
          ...reference,
          [sourcePath]: original.replace(
            'function markdown(text){return text.split',
            "function markdown(text){return text.replace(/<[^>]*>/g,'').split",
          ),
        },
        pass: false,
      },
      {
        name: 'hidden-html',
        files: {
          ...reference,
          [sourcePath]: original
            .replace(
              'function markdown(text){return text.split',
              "function markdown(text){return text.replace(/<[^>]*>/g,'').split",
            )
            .replace(
              '${markdown(body)}</section>',
              '${markdown(body)}</section><div hidden>${escape(body)}</div>',
            ),
        },
        pass: false,
      },
      {
        name: 'missing-bold',
        files: {
          ...reference,
          [sourcePath]: original.replace("'<strong>$1</strong>'", "'<span>$1</span>'"),
        },
        pass: false,
      },
      {
        name: 'missing-heading',
        files: {
          ...reference,
          [sourcePath]: original.replace(
            '<h2>${safe.slice(2)}</h2>',
            '<div>${safe.slice(2)}</div>',
          ),
        },
        pass: false,
      },
      {
        name: 'broken-target',
        files: {
          ...reference,
          [sourcePath]: original.replace('if(note)open(note.id);else', 'if(note){}else'),
        },
        pass: false,
      },
    ];
    for (const variant of variants.filter((v) => !process.argv[3] || v.name === process.argv[3])) {
      const source = variant.files[sourcePath]!;

      await writeTree(dir, variant.files);
      const port = await freePort();
      const url = `http://127.0.0.1:${port}/`;
      const server = spawnLoggedServer(
        join(dir, 'node_modules/.bin/vite'),
        ['--host', '127.0.0.1', '--port', String(port), '--strictPort'],
        {
          cwd: dir,
          env: { ...process.env, NODE_PATH: undefined },
          logPath: join(dir, 'server.log'),
          detached: true,
        },
      );
      const context = await browser.newContext();
      try {
        await waitHttpReady(url, 30000, 'caption control');
        const page = await context.newPage();
        const errors: string[] = [];
        page.on('pageerror', (error) => errors.push(error.message));
        await page.goto(url);
        const result = await task.judge!({ view: page, previewUrl: url });
        evidence.push({
          id: task.id,
          variant: variant.name,
          expectedPass: variant.pass,
          dir,
          result,
          errors,
          files: variant.files,
        });
        console.log(JSON.stringify({ id: task.id, variant: variant.name, result, errors }));
      } finally {
        await context.close();
        await killProcessGroup(server);
      }
    }
  }
} finally {
  await browser.close();
  await writeFile(join(root, 'evidence.json'), JSON.stringify(evidence, null, 2));
  console.log(`NOTES_RENDER_CONTROL_ARTIFACTS ${root}`);
}
assert.equal(evidence.length, process.argv[3] ? 1 : 12);
for (const row of evidence) {
  assert.equal(row.result.pass, row.expectedPass, `${row.id}/${row.variant}`);
  assert.deepEqual(row.errors, []);
}
