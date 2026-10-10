import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from '@playwright/test';
import { loadCorpus } from '../src/corpus.ts';
import { writeTree } from '../src/files.ts';
import {
  freePort,
  killProcessGroup,
  runOrThrow,
  spawnLoggedServer,
  waitHttpReady,
} from '../src/proc.ts';
import { captionReference } from './caption-variants.ts';

const suite = process.argv[2] ?? 'pilot-v2';
const root = await mkdtemp(join(tmpdir(), 'rifty-caption-controls-'));
const browser = await chromium.launch();
const evidence = [];
try {
  for (const task of (await loadCorpus(suite)).filter((task) => task.group === 'app')) {
    const dir = join(root, task.id);
    await mkdir(dir);
    await writeTree(dir, task.files);
    await runOrThrow('npm', ['install', '--no-audit', '--no-fund'], {
      cwd: dir,
      env: { ...process.env, NODE_PATH: undefined },
      timeoutMs: 300000,
    });
    const reference = task.controls!.reference!;
    const sourcePath = task.family === 'contact-import' ? 'src/main.tsx' : 'src/main.js';
    const original = reference[sourcePath]!;
    const captions = captionReference(task)[sourcePath]!;
    assert.notEqual(captions, original);
    const variants =
      task.family === 'contact-import'
        ? ['captions', 'output-caption', 'broken-search', 'broken-content']
        : ['captions', 'broken-search', 'broken-content'];
    for (const variant of variants) {
      const source =
        variant === 'captions'
          ? captions
          : variant === 'output-caption'
            ? captions.replace(
                '<label>Filtered CSV output<textarea readOnly value={output}/></label>',
                '<label>Results<textarea readOnly ref={node=>{if(node)node.value=output;}}/></label>',
              )
            : variant === 'broken-search'
              ? task.family === 'contact-import'
                ? captions.replace('`${row.name} ${row.email}`', '`${row.email}`')
                : captions.replace("(note.title+' '+note.body)", 'note.body')
              : task.family === 'contact-import'
                ? captions.replace('row.name.length>0&&', '').replace("value+='\"';i++;", 'i++;')
                : captions.replace(
                    'function markdown(text){return text.split',
                    "function markdown(text){return text.replace(/<[^>]*>/g,'').split",
                  );
      assert.notEqual(source, original);
      await writeTree(dir, { ...reference, [sourcePath]: source });
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
        evidence.push({ id: task.id, variant, dir, result, errors, source });
        console.log(JSON.stringify({ id: task.id, variant, result, errors }));
      } finally {
        await context.close();
        await killProcessGroup(server);
      }
    }
  }
} finally {
  await browser.close();
  await writeFile(join(root, 'evidence.json'), JSON.stringify(evidence, null, 2));
  console.log(`CAPTION_CONTROL_ARTIFACTS ${root}`);
}
assert.equal(evidence.length, 7);
for (const row of evidence) {
  assert.equal(
    row.result.pass,
    ['captions', 'output-caption'].includes(row.variant),
    `${row.id}/${row.variant}`,
  );
  assert.deepEqual(row.errors, []);
}
