import { expect, test } from '@playwright/test';
import { gotoHarness, sealedWorkbenchFixtureUrl } from './fixtures.ts';
import type * as SealedFixture from './fixtures/sealed-playground-workbench.ts';

test('ordinary Express execution, diagnostics and .vite files survive archive and owner reopen', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await gotoHarness(page);
  const result = await page.evaluate(async (fixtureUrl) => {
    const fixture = (await import(/* @vite-ignore */ fixtureUrl)) as typeof SealedFixture;
    const options = {
      workspaceId: 'registry-owned-express',
      persistence: 'required' as const,
      plan: {
        kind: 'node-cli' as const,
        id: 'scratch',
        starterId: 'registry-owned-express',
        templateId: 'registry-owned-express-v1',
        files: {
          '/package.json':
            '{"name":"ordinary-express","private":true,"dependencies":{"express":"4.21.2"}}\n',
          '/.vite/notes.txt': 'initial notes',
          '/proof.cjs': `const express = require('express');
const http = require('node:http');
const app = express();
app.get('/proof', (_req, res) => res.send('EXPRESS_REGISTRY_OK'));
const server = app.listen(4381, '127.0.0.1', () => {
  http.get('http://127.0.0.1:4381/proof', (response) => {
    let body = '';
    response.on('data', (chunk) => { body += chunk; });
    response.on('end', () => { console.log(response.statusCode, body); server.close(); });
  }).on('error', (error) => { console.error(error); server.close(); process.exitCode = 1; });
});\n`,
        },
        firstMaterialization: { kind: 'install' as const },
        entryPath: '/proof.cjs',
      },
    };
    await fixture.openSealedWorkbenchFixture(options);
    let closed = false;
    try {
      const project = fixture.currentProject();
      const firstInstall = await fixture.executeProjectLine('npm install');
      const first = await fixture.executeProjectLineUntil(
        'node proof.cjs',
        '200 EXPRESS_REGISTRY_OK',
      );
      const notes = await project.files.readFile('/.vite/notes.txt');
      await project.files.writeFile(
        '/.vite/notes.txt',
        new TextEncoder().encode('retained user notes'),
        { expectedVersion: notes.version },
      );
      const visible = project.files.snapshot().entries.map((entry) => entry.path);
      const archive = await fixture.currentSessionTools().archive.export();
      const exported = JSON.parse(archive) as { files: { path: string; content: string }[] };
      await fixture.currentSessionTools().archive.import(archive);
      const afterImport = new TextDecoder().decode(
        (await project.files.readFile('/.vite/notes.txt')).bytes,
      );
      const install = await fixture.executeProjectLine('npm install');
      await fixture.closeSealedWorkbenchFixture();
      closed = true;
      await fixture.openSealedWorkbenchFixture(options);
      closed = false;
      const reopened = new TextDecoder().decode(
        (await fixture.currentProject().files.readFile('/.vite/notes.txt')).bytes,
      );
      const second = await fixture.executeProjectLineUntil(
        'node proof.cjs',
        '200 EXPRESS_REGISTRY_OK',
      );
      return {
        firstInstall,
        first,
        second,
        install,
        visible,
        afterImport,
        reopened,
        archivedNotes: exported.files.find((file) => file.path === '.vite/notes.txt')?.content,
      };
    } finally {
      if (!closed) await fixture.closeSealedWorkbenchFixture();
    }
  }, sealedWorkbenchFixtureUrl);
  expect(result.firstInstall.exit).toBe(0);
  expect(result.first.out).toContain('200 EXPRESS_REGISTRY_OK');

  expect(result.second.out).toContain('200 EXPRESS_REGISTRY_OK');
  expect(result.install.exit).toBe(0);
  expect([result.first.out, result.second.out, result.install.out].join('\n')).not.toContain(
    '[real-vite/worker]',
  );
  expect(result.visible).toContain('/.vite/notes.txt');
  expect(result.archivedNotes).toBe(Buffer.from('retained user notes').toString('base64'));
  expect(result.afterImport).toBe('retained user notes');
  expect(result.reopened).toBe('retained user notes');
});
