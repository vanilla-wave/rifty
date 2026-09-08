import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import {
  bootOwner,
  closeOwner,
  execLine,
  gotoHarness,
  sealedWorkbenchFixtureUrl,
} from './fixtures.ts';
import type * as SealedFixture from './fixtures/sealed-playground-workbench.ts';

const program = `const express = require('express');
const http = require('node:http');
const app = express();
app.get('/proof', (_req, res) => res.send('EXPRESS_REGISTRY_OK'));
const server = app.listen(4381, '127.0.0.1', () => {
  http.get('http://127.0.0.1:4381/proof', (response) => {
    let body = '';
    response.on('data', (chunk) => { body += chunk; });
    response.on('end', () => {
      console.log(String(response.statusCode) + ' ' + body);
      server.close(() => console.log('CLOSED'));
    });
  }).on('error', (error) => { console.error(error); server.close(); process.exitCode = 1; });
});
`;

test('Express self-request closes and naturally settles the ordinary node command', async ({
  page,
}) => {
  const reference = mkdtempSync(join(tmpdir(), 'rifty-http-close-'));
  let expected: { exit: number; out: string };
  try {
    const install = spawnSync(
      'npm',
      [
        'install',
        '--prefix',
        reference,
        '--ignore-scripts',
        '--no-audit',
        '--no-fund',
        'express@4.21.2',
      ],
      { encoding: 'utf8', timeout: 60_000 },
    );
    expect(install.status, install.stderr).toBe(0);
    writeFileSync(join(reference, 'proof.cjs'), program);
    const node = spawnSync(process.execPath, [join(reference, 'proof.cjs')], {
      encoding: 'utf8',
      timeout: 15_000,
    });
    expect(node.status, `${node.error ?? ''}\n${node.stderr}`).toBe(0);
    expected = { exit: 0, out: node.stdout };
    console.log(`Node ${process.version}: ${JSON.stringify(expected)}`);
  } finally {
    rmSync(reference, { recursive: true, force: true });
  }
  await gotoHarness(page);
  await bootOwner(page, {
    workspaceId: 'http-close-drain',
    plan: {
      kind: 'node-cli',
      id: 'scratch',
      starterId: 'http-close-drain',
      templateId: 'http-close-drain-v1',
      files: {
        '/package.json':
          '{"name":"http-close-drain","private":true,"dependencies":{"express":"4.21.2"}}',
        '/proof.cjs': program,
      },
      firstMaterialization: { kind: 'install' },
      entryPath: '/proof.cjs',
    },
  });
  try {
    expect((await execLine(page, 'npm install')).exit).toBe(0);
    const result = await page.evaluate(async (fixtureUrl) => {
      const fixture = (await import(/* @vite-ignore */ fixtureUrl)) as typeof SealedFixture;
      const terminal = fixture.currentProject().terminals.open();
      let out = '';
      const detach = terminal.attach((chunk) => {
        out += chunk;
      });
      let watchdog: ReturnType<typeof setTimeout> | undefined;
      try {
        const run = terminal.run('node proof.cjs');
        const exit = await Promise.race([
          run.exited,
          new Promise<never>((_, reject) => {
            watchdog = setTimeout(() => reject(new Error(`command did not drain: ${out}`)), 15_000);
          }),
        ]);
        const closed = await run.close();
        if (closed.code !== exit.code || closed.signal !== exit.signal)
          throw new Error('exit changed on close');
        return { exit: exit.code, out };
      } finally {
        clearTimeout(watchdog);
        detach();
        await terminal.close();
      }
    }, sealedWorkbenchFixtureUrl);
    expect({ ...result, out: result.out.replaceAll('\r\n', '\n') }).toEqual(expected);
  } finally {
    await closeOwner(page);
  }
});
