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
} from '../browser-unit/fixtures.ts';
import type * as SealedFixture from '../browser-unit/fixtures/sealed-playground-workbench.ts';

// Native Node oracles share a loopback port; retain independent retries.
test.describe.configure({ mode: 'default' });

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

const close = "server.close(() => console.log('CLOSED'));";
const cases = [
  { name: 'last close', source: program, mode: 'file', code: 0 },
  { name: 'eval last close', source: program, mode: 'eval', code: 0 },
  {
    name: 'tail timer and exitCode',
    source: program.replace(
      close,
      `${close}setTimeout(() => { console.log('TAIL'); process.exitCode = 7; }, 30);`,
    ),
    mode: 'file',
    code: 7,
  },
  {
    name: 'close callback relisten',
    source: program.replace(
      close,
      "server.close(() => { console.log('CLOSED'); server.listen(4381, '127.0.0.1', () => { console.log('RELISTENED'); setTimeout(() => server.close(() => console.log('FINAL_CLOSE')), 30); }); });",
    ),
    mode: 'file',
    code: 0,
  },
  {
    name: 'another listening port',
    source: program.replace(
      close,
      "const second = http.createServer((_req, res) => res.end('SECOND')); second.listen(0, '127.0.0.1', () => { server.close(() => { console.log('CLOSED'); setTimeout(() => { http.get('http://127.0.0.1:' + second.address().port, (res) => { let text = ''; res.on('data', (chunk) => { text += chunk; }); res.on('end', () => { console.log(text); second.close(() => console.log('FINAL_CLOSE')); }); }); }, 30); }); });",
    ),
    mode: 'file',
    code: 0,
  },
  {
    name: 'late first listen',
    source: `setTimeout(() => {\n${program}}, 30);`,
    mode: 'file',
    code: 0,
  },
  {
    name: 'explicit eval exit with live port',
    source: program.replace(close, 'process.exit(9);'),
    mode: 'eval',
    code: 9,
  },
];

for (const scenario of cases) {
  test(`Express command drain: ${scenario.name}`, async ({ page }) => {
    test.setTimeout(120_000);
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
      writeFileSync(join(reference, 'proof.cjs'), scenario.source);
      const node = spawnSync(
        process.execPath,
        scenario.mode === 'eval' ? ['-e', scenario.source] : [join(reference, 'proof.cjs')],
        {
          cwd: reference,
          encoding: 'utf8',
          timeout: 15_000,
        },
      );
      expect(node.status, `${node.error ?? ''}\n${node.stderr}`).toBe(scenario.code);
      expected = { exit: scenario.code, out: node.stdout };
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
          '/proof.cjs': scenario.source,
        },
        firstMaterialization: { kind: 'install' },
        entryPath: '/proof.cjs',
      },
    });
    try {
      expect((await execLine(page, 'npm install')).exit).toBe(0);
      const command =
        scenario.mode === 'eval'
          ? `node -e '${scenario.source.replaceAll("'", "'\"'\"'")}'`
          : 'node proof.cjs';
      const result = await page.evaluate(
        async ({ fixtureUrl, command }) => {
          const fixture = (await import(/* @vite-ignore */ fixtureUrl)) as typeof SealedFixture;
          const terminal = fixture.currentProject().terminals.open();
          let out = '';
          const detach = terminal.attach((chunk) => {
            out += chunk;
          });
          let watchdog: ReturnType<typeof setTimeout> | undefined;
          try {
            const run = terminal.run(command);
            const exit = await Promise.race([
              run.exited,
              new Promise<never>((_, reject) => {
                watchdog = setTimeout(
                  () => reject(new Error(`command did not drain: ${out}`)),
                  15_000,
                );
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
        },
        { fixtureUrl: sealedWorkbenchFixtureUrl, command },
      );
      expect({ ...result, out: result.out.replaceAll('\r\n', '\n') }).toEqual(expected);
    } finally {
      await closeOwner(page);
    }
  });
}
