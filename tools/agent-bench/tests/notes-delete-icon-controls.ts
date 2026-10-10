import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { type Page, chromium, expect } from '@playwright/test';
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
const old = (await loadCorpus('eval-v3')).find((t) => t.family === 'linked-knowledge')!;
const next = (await loadCorpus('eval-v4')).find((t) => t.family === 'linked-knowledge')!;
const files = JSON.parse(
  gunzipSync(
    await readFile('tools/agent-bench/tests/fixtures/notes-delete-icon-alternative.json.gz'),
  ).toString(),
) as FileTree;
const source = files['src/main.js']!;
const root = await mkdtemp(join(tmpdir(), 'rifty-notes-delete-icon-controls-'));
await writeTree(root, { ...next.files, ...next.controls!.reference!, 'src/main.js': source });
await runOrThrow('npm', ['install', '--no-audit', '--no-fund'], {
  cwd: root,
  env: { ...process.env, NODE_PATH: undefined },
  timeoutMs: 300000,
});
const port = await freePort();
const url = `http://127.0.0.1:${port}/`;
const server = spawnLoggedServer(
  join(root, 'node_modules/.bin/vite'),
  ['--host', '127.0.0.1', '--port', String(port), '--strictPort'],
  {
    cwd: root,
    env: { ...process.env, NODE_PATH: undefined },
    logPath: join(root, 'server.log'),
    detached: true,
  },
);
const browser = await chromium.launch();
const evidence: { publicWorkflow?: unknown; old?: unknown; next?: unknown; errors: string[] } = {
  errors: [],
};
async function publicWorkflow(page: Page) {
  const title = page.getByRole('textbox', { name: 'Title', exact: true });
  const body = page.getByRole('textbox', { name: 'Markdown', exact: true });
  const search = page.getByRole('textbox', { name: 'Search', exact: true });
  const entry = (n: string) => page.getByRole('button', { name: n, exact: true });
  const fresh = () => page.getByRole('button', { name: 'New note', exact: true }).click();
  const save = () => page.getByRole('button', { name: 'Save', exact: true }).click();
  const alpha = '# First\n**Important**\n[[Beta]]\n<script>not code</script>';
  const out = [];
  await fresh();
  await title.fill('Alpha');
  await body.fill(alpha);
  await save();
  await expect(page.getByRole('heading', { name: 'First', exact: true })).toBeVisible();
  await expect(page.locator('strong')).toHaveText('Important');
  await expect(page.getByRole('region', { name: 'Markdown preview' })).toContainText(
    '<script>not code</script>',
  );
  assert.equal(
    await page.getByRole('region', { name: 'Markdown preview' }).locator('script').count(),
    0,
  );
  out.push('visible headings/bold/literalHTML');
  await page.getByRole('link', { name: 'Beta', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Missing linked note');
  await expect(body).toHaveValue(alpha);
  out.push('missingtarget preservesdraft');
  await fresh();
  await title.fill('Beta');
  await body.fill('Unique body needle');
  await save();
  await page.reload();
  await fresh();
  await search.fill('ALPHA');
  assert.equal(await entry('Alpha').count(), 1);
  assert.equal(await entry('Beta').count(), 0);
  await search.fill('NEEDLE');
  assert.equal(await entry('Beta').count(), 1);
  assert.equal(await entry('Alpha').count(), 0);
  out.push('search title/body caseinsensitive');
  await search.fill('');
  await entry('Alpha').click();
  await search.fill('First');
  await page.getByRole('link', { name: 'Beta', exact: true }).click();
  await expect(title).toHaveValue('Beta');
  await expect(body).toHaveValue('Unique body needle');
  out.push('Wiki savednavigation');
  await title.fill('Beta renamed');
  await body.fill('Updated saved body');
  await save();
  await page.reload();
  await entry('Beta renamed').click();
  await expect(body).toHaveValue('Updated saved body');
  await title.fill('Beta');
  await body.fill('Unique body needle');
  await save();
  await page.reload();
  await entry('Beta').click();
  out.push('edit/save persisted');
  await body.fill('unsaved overwrite');
  await page.reload();
  await entry('Beta').click();
  await expect(body).toHaveValue('Unique body needle');
  out.push('unsaved draft notpersisted');
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await page.reload();
  await fresh();
  assert.equal(await entry('Beta').count(), 0);
  assert.equal(await entry('Alpha').count(), 1);
  await entry('Alpha').click();
  await expect(body).toHaveValue(alpha);
  out.push('delete persisted/other savedstate');
  return out;
}
try {
  await waitHttpReady(url, 30000, 'independent delete-icon alternative');
  for (const [name, judge] of [
    ['publicWorkflow', publicWorkflow],
    ['old', old.judge!],
    ['next', next.judge!],
  ] as const) {
    const context = await browser.newContext();
    const page = await context.newPage();
    page.on('pageerror', (e) => evidence.errors.push(e.message));
    await page.goto(url);
    evidence[name] =
      name === 'publicWorkflow'
        ? await publicWorkflow(page)
        : await (name === 'old' ? old.judge! : next.judge!)({ view: page, previewUrl: url });
    await context.close();
  }
} finally {
  await browser.close();
  await killProcessGroup(server);
  await writeFile(
    join(root, 'evidence.json'),
    JSON.stringify({ root, source, ...evidence }, null, 2),
  );
  console.log(`NOTES_DELETE_ICON_ARTIFACTS ${root}`);
  console.log(JSON.stringify({ root, ...evidence }));
}
assert.equal(evidence.errors.length, 0);
assert.equal((evidence.old as { pass: boolean }).pass, true);
assert.equal((evidence.next as { pass: boolean }).pass, true);
