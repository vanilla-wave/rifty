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

const task = (await loadCorpus(process.argv[2] ?? 'eval-v3')).find(
  (task) => task.family === 'linked-knowledge',
)!;
const files = JSON.parse(
  gunzipSync(
    await readFile('tools/agent-bench/tests/fixtures/notes-composed-entry-programme.json.gz'),
  ).toString(),
) as FileTree;
const root = await mkdtemp(join(tmpdir(), 'rifty-notes-entry-controls-'));
await writeTree(root, { ...task.files, ...files });
await runOrThrow('npm', ['install', '--no-audit', '--no-fund'], {
  cwd: root,
  env: { ...process.env, NODE_PATH: undefined },
  timeoutMs: 300000,
});

// Fixture-specific public walkthrough, independently of the private name matcher.
async function publicWorkflow(page: Page) {
  const title = page.getByRole('textbox', { name: 'Title', exact: true });
  const body = page.getByRole('textbox', { name: 'Markdown', exact: true });
  const search = page.getByRole('searchbox', { name: 'Search', exact: true });
  const entries = page.getByRole('navigation', { name: 'Saved notes', exact: true });
  const entry = (name: string) =>
    entries.getByRole('button').filter({ has: page.getByText(name, { exact: true }) });
  const save = () => page.getByRole('button', { name: /Save note/ }).click();
  const fresh = () => page.getByRole('button', { name: 'New note', exact: true }).click();
  const alpha = '# First\n**Important**\n[[Beta]]\n<script>not code</script>';
  const observations = [];

  await fresh();
  await title.fill('Alpha');
  await body.fill(alpha);
  await save();
  await expect(page.getByRole('heading', { name: 'First', exact: true })).toBeVisible();
  const preview = page.locator('#preview-content');
  await expect(preview.locator('strong')).toHaveText('Important');
  assert.ok(
    (await preview
      .locator('strong')
      .evaluate((node) => Number.parseInt(getComputedStyle(node).fontWeight))) >= 600,
  );
  await expect(preview).toContainText('<script>not code</script>');
  assert.equal(await preview.locator('script').count(), 0);
  observations.push({ requirement: 'headings, bold, literal HTML', pass: true });

  await preview.getByRole('link', { name: 'Beta', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('No saved note titled');
  await expect(body).toHaveValue(alpha);
  observations.push({ requirement: 'missing target preserves draft', pass: true });

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
  observations.push({
    requirement: 'title/body case-insensitive search',
    pass: true,
    snapshot: await page.locator('body').ariaSnapshot(),
  });

  await search.fill('');
  await entry('Alpha').click();
  await search.fill('First');
  await preview.getByRole('link', { name: 'Beta', exact: true }).click();
  await expect(title).toHaveValue('Beta');
  await expect(body).toHaveValue('Unique body needle');
  observations.push({ requirement: 'Wiki target navigates to saved content', pass: true });

  await title.fill('Beta renamed');
  await body.fill('Updated saved body');
  await save();
  await page.reload();
  await entry('Beta renamed').click();
  await expect(title).toHaveValue('Beta renamed');
  await expect(body).toHaveValue('Updated saved body');
  await title.fill('Beta');
  await body.fill('Unique body needle');
  await save();
  await page.reload();
  await entry('Beta').click();
  observations.push({ requirement: 'edit/save existing note persists', pass: true });

  await body.fill('unsaved overwrite');
  await page.reload();
  await entry('Beta').click();
  await expect(body).toHaveValue('Unique body needle');
  observations.push({ requirement: 'unsaved overwrite does not persist', pass: true });

  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await page.reload();
  await fresh();
  assert.equal(await entry('Beta').count(), 0);
  assert.equal(await entry('Alpha').count(), 1);
  await entry('Alpha').click();
  await expect(title).toHaveValue('Alpha');
  await expect(body).toHaveValue(alpha);
  observations.push({ requirement: 'delete persists, other saved note retained', pass: true });
  return observations;
}

const browser = await chromium.launch();
const port = await freePort();
const url = `http://127.0.0.1:${port}/`;
const server = spawnLoggedServer(
  join(root, 'node_modules/.bin/vite'),
  ['--host', '127.0.0.1', '--port', String(port), '--strictPort'],
  { cwd: root, env: process.env, logPath: join(root, 'server.log'), detached: true },
);
const evidence: { publicWorkflow?: unknown; privateVerdict?: unknown; errors: string[] } = {
  errors: [],
};
let privatePass = false;
try {
  await waitHttpReady(url, 30000, 'captured notes programme');
  const publicContext = await browser.newContext();
  const publicPage = await publicContext.newPage();
  publicPage.on('pageerror', (error) => evidence.errors.push(error.message));
  await publicPage.goto(url);
  evidence.publicWorkflow = await publicWorkflow(publicPage);
  await publicContext.close();
  const privateContext = await browser.newContext();
  const privatePage = await privateContext.newPage();
  privatePage.on('pageerror', (error) => evidence.errors.push(error.message));
  await privatePage.goto(url);
  const result = await task.judge!({ view: privatePage, previewUrl: url });
  evidence.privateVerdict = result;
  privatePass = result.pass;
  await privateContext.close();
} finally {
  await browser.close();
  await killProcessGroup(server);
  await writeFile(
    join(root, 'evidence.json'),
    JSON.stringify(
      { suite: process.argv[2] ?? 'eval-v3', task: task.id, files, ...evidence },
      null,
      2,
    ),
  );
  console.log(`NOTES_ENTRY_ARTIFACTS ${root}`);
  console.log(JSON.stringify(evidence));
}
assert.equal(evidence.errors.length, 0);
assert.equal(privatePass, true, 'Actual programme meeting public workflow must be accepted');
