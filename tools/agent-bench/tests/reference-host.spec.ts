import { execFileSync } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { browserRegistryPackages } from '../../../tests/integration/browser-registry-fixture.mjs';
import { scriptedProvider } from '../../../tests/integration/fixtures/workbench-vite-consumer/src/agent-scripted-provider.ts';
import { startInstalledRegistry } from '../../../tests/integration/installed-registry.mjs';
import type { NoCoiPage } from '../src/no-coi-page.ts';
import { freePort } from '../src/proc.ts';
import { services } from '../src/services.ts';
import { catalogEndpoint } from './catalog-endpoint.ts';

test('packed benchmark boots the shared host with defaults and policy/text-only toggles', async ({
  browser,
}) => {
  const output = join(await mkdtemp(join(tmpdir(), 'rifty-reference-bench-')), 'series');
  const servers = await services(['rifty-no-coi'], await freePort(), output);
  const registry = await startInstalledRegistry(await browserRegistryPackages(process.cwd()));
  const config = JSON.parse(
    execFileSync(
      process.execPath,
      [
        '--import',
        'tsx',
        '-e',
        "import('./tools/agent-bench/src/config.ts').then(async m=>console.log(JSON.stringify(await m.loadConfig())))",
      ],
      { encoding: 'utf8' },
    ),
  );
  expect(config.limits).toEqual({ maxToolCalls: 100, runTimeoutMs: 600000 });
  try {
    for (const restricted of [false, true]) {
      const provider = scriptedProvider([
        [{ name: 'write_file', args: { path: 'proof.txt', content: 'changed' } }],
        [{ name: 'shell', args: { command: 'node proof.cjs' } }],
        restricted ? 'Policy denied both operations.' : 'Changed file and executed Node.',
      ]);
      const server = createServer(async (request, response) => {
        response.setHeader('Access-Control-Allow-Origin', '*');
        response.setHeader(
          'Access-Control-Allow-Headers',
          request.headers['access-control-request-headers'] ?? '*',
        );
        response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
        if (request.method === 'OPTIONS') return void response.end();
        try {
          const chunks: Buffer[] = [];
          for await (const chunk of request) chunks.push(Buffer.from(chunk));
          const body = Buffer.concat(chunks).toString();
          const result = await provider.fetch(
            new Request('http://fixture.invalid/v1/chat/completions', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body,
            }),
          );
          response.writeHead(result.status, {
            'Content-Type': result.headers.get('content-type')!,
          });
          response.end(await result.text());
        } catch (error) {
          response.writeHead(500);
          response.end(String(error));
        }
      });
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Missing provider');
      const context = await browser.newContext();
      try {
        await context.route('**/npm-registry/**', async (route) => {
          const requested = new URL(route.request().url());
          const upstream = await route.fetch({
            url:
              registry.origin + requested.pathname.slice('/npm-registry'.length) + requested.search,
          });
          await route.fulfill({ response: upstream });
        });
        const page = await context.newPage();
        const urls: string[] = [];
        page.on('request', (request) => urls.push(request.url()));
        await page.goto(servers.noCoiUrl!);
        await page.waitForFunction(() => Reflect.has(globalThis, 'bench'));
        await page.evaluate(
          async ({ endpoint, restricted }) => {
            const bench = Reflect.get(globalThis, 'bench') as NoCoiPage;
            return bench.boot(
              {
                'package.json':
                  '{"name":"packed-reference-bench","version":"1.0.0","dependencies":{"vite":"7.3.6"}}',
                'index.html': '<!doctype html><div id="root">benchmark preview</div>',
                'proof.txt': 'original',
                'proof.cjs': "console.log('bench-real');",
              },
              {
                endpoint,
                ...(restricted
                  ? {
                      policies: {
                        files: { readonlyPaths: ['proof.txt'] },
                        shell: { allowedCommands: ['npm'] },
                      },
                    }
                  : {}),
              },
            );
          },
          {
            endpoint: catalogEndpoint(`http://127.0.0.1:${address.port}/v1`, {
              textOnlyContent: restricted,
            }),
            restricted,
          },
        );
        const result = await page.evaluate(() =>
          (Reflect.get(globalThis, 'bench') as NoCoiPage).run(
            'Change proof.txt and run node proof.cjs.',
          ),
        );
        expect(result.trace.status).toBe('done');
        const tools = result.trace.transcript.filter((entry) => entry.role === 'toolResult');
        expect(tools.map((entry) => entry.isError)).toEqual([restricted, restricted]);
        const files = await page.evaluate(() =>
          (Reflect.get(globalThis, 'bench') as NoCoiPage).snapshot(),
        );
        expect(files['proof.txt']).toBe(restricted ? 'original' : 'changed');
        if (!restricted) expect(JSON.stringify(tools.at(-1))).toContain('bench-real');
        expect(provider.requests).toHaveLength(3);
        expect(JSON.stringify(provider.requests[0]?.body.messages)).toMatch(
          /npm install.*configured registry/i,
        );
        if (restricted)
          expect(
            provider.requests.every((request) =>
              request.body.messages.every((message) => typeof message.content === 'string'),
            ),
          ).toBe(true);
        expect(urls.some((url) => /\/sw\.js(?:\?|$)/u.test(url))).toBe(false);
        if (!restricted) {
          await page.evaluate(() => (Reflect.get(globalThis, 'bench') as NoCoiPage).preview());
          await expect(page.frameLocator('iframe').locator('#root')).toHaveText(
            'benchmark preview',
          );
        }
        await page.evaluate(() => (Reflect.get(globalThis, 'bench') as NoCoiPage).close());
      } finally {
        await context.close();
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    }
  } finally {
    await registry.close();
    await servers.close();
  }
});
