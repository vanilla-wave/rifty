import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { promisify } from 'node:util';
const root = process.argv[2];
if (!root) throw new Error('usage: node ai-mode-react-hmr-oracle.mjs <installed-react-project>');
const require = createRequire(import.meta.url);
const { chromium, expect } = require('@playwright/test');
const server = spawn(
  process.execPath,
  [
    `${root}/node_modules/vite/bin/vite.js`,
    '--host',
    '127.0.0.1',
    '--port',
    '10534',
    '--strictPort',
  ],
  { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] },
);
let output = '';
server.stdout.on('data', (chunk) => {
  output += chunk;
});
server.stderr.on('data', (chunk) => {
  output += chunk;
});
const browser = await chromium.launch();
const file = `${root}/src/components/FilterBar.tsx`;
const original = await readFile(file, 'utf8');
const modules = [];
try {
  for (let i = 0; i < 200; i++) {
    try {
      if ((await fetch('http://127.0.0.1:10534')).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 50));
  }
  const page = await browser.newPage();
  page.on('response', async (response) => {
    if (/@react-refresh|FilterBar/.test(response.url()))
      modules.push({ url: response.url(), body: await response.text() });
  });
  await page.goto('http://127.0.0.1:10534');
  await page.getByRole('link', { name: 'Issues', exact: true }).click();
  await expect(page.locator('.filter-bar')).toBeVisible();
  await page.evaluate(() => {
    globalThis.documentProof = 'same';
  });
  await writeFile(
    file,
    original.replace(
      '<div className="filter-bar">',
      '<div className="filter-bar"><input aria-label="Agent first search" />',
    ),
  );
  await expect(page.getByLabel('Agent first search')).toBeVisible();
  await writeFile(
    file,
    original.replace(
      '<div className="filter-bar">',
      '<div className="filter-bar"><input aria-label="Agent second search" />',
    ),
  );
  await promisify(execFile)(process.execPath, [`${root}/node_modules/vite/bin/vite.js`, 'build'], {
    cwd: root,
  });
  await expect(page.getByLabel('Agent second search')).toBeVisible();
  const sameDocument = await page.evaluate(() => globalThis.documentProof === 'same');
  const source = await readFile(`${root}/node_modules/vite/dist/node/chunks/config.js`, 'utf8');
  const extract = (name) => {
    const start = source.indexOf(`function ${name}(`);
    if (start < 0) throw Error(`${name} missing`);
    return source.slice(start, source.indexOf('\n}', start) + 2);
  };
  const factory = new Function(
    'path',
    'fs',
    `const VALID_ID_PREFIX='/@id/';const NULL_BYTE_PLACEHOLDER='__x00__';const FS_PREFIX='/@fs/';${extract('withTrailingSlash')};${extract('wrapId')};${extract('cleanUrl')};${extract('normalizeResolvedIdToUrl')};return normalizeResolvedIdToUrl;`,
  );
  const normalize = factory(path, fs);
  const rootSlash = normalize({ config: { root: '/' } }, '/@react-refresh', {
    id: '/@react-refresh',
  });
  const rootOrdinary = normalize({ config: { root } }, '/@react-refresh', {
    id: '/@react-refresh',
  });
  const versions = Object.fromEntries(
    ['vite', '@vitejs/plugin-react', 'react', 'react-dom'].map((name) => [
      name,
      require(`${root}/node_modules/${name}/package.json`).version,
    ]),
  );
  const result = {
    node: process.version,
    versions,
    beforeAndAfterBuild: true,
    sameDocument,
    rootSlash,
    rootOrdinary,
    refreshUrls: [
      ...new Set(modules.filter((m) => m.url.includes('@react-refresh')).map((m) => m.url)),
    ],
  };
  await writeFile(`${root}/result.json`, JSON.stringify(result, null, 2));
  await writeFile(`${root}/modules.json`, JSON.stringify(modules, null, 2));
  console.log(JSON.stringify(result));
} finally {
  await writeFile(file, original);
  await browser.close();
  server.kill();
  await writeFile(`${root}/server.log`, output);
}
