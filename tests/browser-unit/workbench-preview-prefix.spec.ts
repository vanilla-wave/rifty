import { expect, test } from '@playwright/test';
import { gotoSandboxHarness, sealedWorkbenchFixtureUrl } from './fixtures.ts';

const PREVIEW_PORT = 43872;
const IFRAME_MARKER = 'I5-PREFIX-IFRAME';
const ASSET_MARKER = 'I5-PREFIX-ASSET';

test('prefixed iframe, asset, root-relative fetch and HMR under /sandbox/ (I5)', async ({
  page,
}) => {
  test.setTimeout(150_000);
  await gotoSandboxHarness(page);
  await expect(page.locator('#browser-unit-harness')).toHaveAttribute('data-sandbox', '1');

  const observed = await page.evaluate(
    async ({ fixtureUrl, previewPort, iframeMarker, assetMarker }) => {
      const fixture = await import(/* @vite-ignore */ fixtureUrl);
      type Exit = { readonly code: number | null; readonly signal: string | null };
      type Run = {
        readonly ready: Promise<void>;
        readonly exited: Promise<Exit>;
        stop(): Promise<Exit>;
        close(): Promise<Exit>;
      };
      type Terminal = {
        attach(listener: (chunk: string) => void): () => void;
        run(line: string): Run;
        close(): Promise<void>;
      };
      const cleanupErrors: string[] = [];
      let opened = false;
      let terminal: Terminal | null = null;
      let run: Run | null = null;
      let detach: (() => void) | null = null;
      let transcript = '';
      let primaryFailure: unknown;
      let outcome:
        | {
            readonly pagePath: string;
            readonly swScope: string;
            readonly advertisedUrl: string | undefined;
            readonly iframeBody: string;
            readonly assetBody: string;
            readonly rootRelativeBody: string;
            readonly hmrInjected: boolean;
            readonly outsideBody: string;
          }
        | undefined;

      const waitUntil = async (
        predicate: () => boolean,
        label: string,
        timeoutMs: number,
      ): Promise<void> => {
        const deadline = performance.now() + timeoutMs;
        while (!predicate()) {
          if (performance.now() >= deadline) {
            throw new Error(`${label} timed out after ${String(timeoutMs)}ms`);
          }
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
      };
      const recordCleanup = async (operation: () => Promise<unknown>): Promise<void> => {
        try {
          await operation();
        } catch (error) {
          cleanupErrors.push(error instanceof Error ? error.message : String(error));
        }
      };
      const fetchText = async (path: string): Promise<string> => {
        const ac = new AbortController();
        const timer = setTimeout(() => ac.abort(), 4_000);
        try {
          const response = await fetch(path, { cache: 'no-store', signal: ac.signal });
          return await response.text();
        } catch (error) {
          return error instanceof Error ? error.message : String(error);
        } finally {
          clearTimeout(timer);
        }
      };

      try {
        await fixture.openSealedWorkbenchFixture({
          workspaceId: 'browser-unit-preview-prefix',
          template: 'hidden-empty',
          persistence: 'ephemeral',
          serviceWorkerScope: '/sandbox/',
          previewPrefix: '/sandbox/preview',
        });
        opened = true;
        await fixture.writeProjectText(
          '/scratch/preview-prefix.mjs',
          [
            "import http from 'node:http';",
            'const html =',
            `  '<!doctype html><html><body><p>${iframeMarker}</p>' +`,
            '  \'<script>fetch("/asset.txt").then((r)=>r.text()).then((t)=>{\' +',
            "  'document.body.dataset.rootRelative=t;}).catch(()=>{});</script>' +",
            "  '</body></html>';",
            'http',
            '  .createServer((req, res) => {',
            "    if ((req.url ?? '/').split('?')[0] === '/asset.txt') {",
            "      res.setHeader('content-type', 'text/plain; charset=utf-8');",
            `      res.end('${assetMarker}');`,
            '      return;',
            '    }',
            "    res.setHeader('content-type', 'text/html; charset=utf-8');",
            '    res.end(html);',
            '  })',
            `  .listen(${String(previewPort)});`,
            '',
          ].join('\n'),
        );
        const materialized = await fixture.executeProjectLine('npm install');
        if (materialized.exit !== 0) {
          throw new Error(`Project materialization failed:\n${materialized.out}`);
        }
        await fixture.writeProjectText(
          '/scratch/package.json',
          `${JSON.stringify({
            name: 'browser-unit-preview-prefix',
            private: true,
            type: 'module',
            scripts: { serve: 'node preview-prefix.mjs' },
          })}\n`,
        );

        const project = fixture.currentProject();
        const previews = fixture.currentSessionTools().previews;
        const openedTerminal = project.terminals.open();
        terminal = openedTerminal;
        detach = openedTerminal.attach((chunk: string) => {
          transcript += chunk;
        });
        run = openedTerminal.run('npm run serve');
        await run.ready;
        await Promise.race([
          waitUntil(
            () =>
              previews
                .snapshot()
                .some((entry: { readonly port: number }) => entry.port === previewPort),
            'prefixed preview advertisement',
            30_000,
          ),
          run.exited.then((exit) => {
            throw new Error(
              `preview server exited before advertise: ${JSON.stringify(exit)}\n${transcript}`,
            );
          }),
        ]);
        const live = previews
          .snapshot()
          .find(
            (entry: { readonly port: number; readonly url?: string }) => entry.port === previewPort,
          );
        const prefixed = `/sandbox/preview/${String(previewPort)}/`;
        const iframe = document.createElement('iframe');
        iframe.src = prefixed;
        document.body.append(iframe);
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('iframe navigation timed out')), 15_000);
          iframe.addEventListener(
            'load',
            () => {
              clearTimeout(timer);
              resolve();
            },
            { once: true },
          );
        });
        const iframeDoc = iframe.contentDocument;
        const deadline = performance.now() + 8_000;
        while (
          iframeDoc?.body?.dataset.rootRelative === undefined &&
          performance.now() < deadline
        ) {
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        const iframeBody = iframeDoc?.documentElement.outerHTML ?? '';
        const registrations = await navigator.serviceWorker.getRegistrations();
        const sandboxReg = registrations.find((registration) =>
          new URL(registration.scope).pathname.startsWith('/sandbox/'),
        );
        outcome = {
          pagePath: location.pathname,
          swScope: sandboxReg === undefined ? '' : new URL(sandboxReg.scope).pathname,
          advertisedUrl: live?.url,
          iframeBody,
          assetBody: await fetchText(`${prefixed}asset.txt`),
          rootRelativeBody: iframeDoc?.body?.dataset.rootRelative ?? '',
          hmrInjected: iframeBody.includes('data-rifty-ws-bridge'),
          outsideBody: await fetchText(`/preview/${String(previewPort)}/`),
        };
      } catch (error) {
        primaryFailure = error;
      } finally {
        detach?.();
        if (run !== null) await recordCleanup(() => run?.stop() ?? Promise.resolve());
        if (terminal !== null) await recordCleanup(() => terminal?.close() ?? Promise.resolve());
        if (opened) await recordCleanup(() => fixture.closeSealedWorkbenchFixture());
      }
      if (primaryFailure !== undefined) {
        const cleanup = cleanupErrors.length === 0 ? '' : `; cleanup: ${cleanupErrors.join('; ')}`;
        throw new Error(
          `${primaryFailure instanceof Error ? primaryFailure.message : String(primaryFailure)}${cleanup}`,
        );
      }
      if (cleanupErrors.length > 0) {
        throw new Error(`cleanup failed: ${cleanupErrors.join('; ')}`);
      }
      if (outcome === undefined) throw new Error('Prefixed preview run produced no outcome');
      return outcome;
    },
    {
      fixtureUrl: sealedWorkbenchFixtureUrl,
      previewPort: PREVIEW_PORT,
      iframeMarker: IFRAME_MARKER,
      assetMarker: ASSET_MARKER,
    },
  );

  expect(observed.pagePath).toBe('/sandbox/unit-harness.html');
  expect(observed.swScope).toBe('/sandbox/');
  expect(observed.advertisedUrl).toBe(`/sandbox/preview/${String(PREVIEW_PORT)}/`);
  expect(observed.iframeBody).toContain(IFRAME_MARKER);
  expect(observed.assetBody).toBe(ASSET_MARKER);
  expect(observed.rootRelativeBody).toBe(ASSET_MARKER);
  expect(observed.hmrInjected).toBe(true);
  expect(observed.outsideBody).not.toContain(IFRAME_MARKER);
});
