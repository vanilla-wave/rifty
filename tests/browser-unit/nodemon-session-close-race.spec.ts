import { expect, test } from '@playwright/test';
import { closeOwner, gotoHarness, sealedWorkbenchFixtureUrl } from './fixtures.ts';
function serverSource(body: string, listenDelayMs: number): string {
  return `import { createServer } from 'node:http';\nconsole.log(${JSON.stringify(`APP_BOOT:${body}`)});\nawait new Promise((resolve) => setTimeout(resolve, ${String(listenDelayMs)}));\ncreateServer((_request, response) => response.end(${JSON.stringify(body)})).listen(Number(process.env.PORT), () => console.log(${JSON.stringify(`APP_LISTENING:${body}`)}));\n`;
}
test('session close fences admitted nodemon restart and route', async ({ page }) => {
  test.setTimeout(360_000);
  await gotoHarness(page);
  await page.route('**/npm-registry/**', (route) => route.continue());
  await page.route('**/npm-tarballs/**', (route) => route.continue());
  try {
    const result = await page.evaluate(
      async ({ fixtureUrl, packageJson, initialSource, queuedSource }) => {
        const port = 4397;
        const devScript = 'nodemon --legacy-watch --no-stdin --no-update-notifier src/main.js';
        const initialBody = 'nodemon-session-initial';
        const fixture = await import(/* @vite-ignore */ fixtureUrl);
        await fixture.openSealedWorkbenchFixture({
          workspaceId: 'bu-nodemon-session-close-race',
          plan: {
            kind: 'node-server',
            id: 'scratch',
            starterId: 'bu-nodemon-session-close-race',
            templateId: 'browser-unit:nodemon-session-close-race',
            files: {
              '/package.json': packageJson,
              '/src/main.js': initialSource,
            },
            dependencies: { nodemon: '3.1.14' },
            firstMaterialization: { kind: 'install' },
            entryPath: '/src/main.js',
            port,
          },
        });
        const session = fixture.currentProject();
        const previews = fixture.currentSessionTools().previews;
        const previewHistory: boolean[] = [];
        const unsubscribePreview = previews.subscribe((snapshot: readonly { port: number }[]) =>
          previewHistory.push(snapshot.length > 0),
        );
        const run = session.run();
        let output = '';
        const detachOutput = run.terminal.attach((chunk: string) => {
          output += chunk;
        });
        const waitFor = async (
          predicate: () => boolean | Promise<boolean>,
          label: string,
        ): Promise<void> => {
          for (let retries = 0; retries < 900; retries += 1) {
            if (await predicate()) return;
            await new Promise((resolve) => setTimeout(resolve, 50));
          }
          throw new Error(`${label} timed out\nterminal:\n${output}`);
        };
        const probe = async (): Promise<readonly [number, string]> => {
          try {
            const response = await fetch(`/preview/${String(port)}/`, {
              cache: 'no-store',
              signal: AbortSignal.timeout(2_000),
            });
            return [response.status, await response.text()];
          } catch (error) {
            return [0, error instanceof Error ? error.message : String(error)];
          }
        };
        const rejectsClosed = (operation: () => unknown): boolean => {
          try {
            operation();
            return false;
          } catch (error) {
            return error instanceof Error && error.name === 'ClosedHandleError';
          }
        };
        try {
          await run.ready;
          const installed =
            output.includes(`> ${devScript}`) && output.includes('[nodemon] starting');
          await waitFor(
            () => previews.snapshot().some((entry: { port: number }) => entry.port === port),
            'initial semantic preview',
          );
          const initialProbe = await probe();
          await fixture.writeProjectText('/scratch/src/main.js', queuedSource);
          await waitFor(
            () => output.includes('[nodemon] restarting due to changes'),
            'real nodemon watch restart admission',
          );
          const sessionClosing = session.close();
          const sessionCloseShared = sessionClosing === session.close();
          await sessionClosing;
          const runClosing = run.close();
          const runCloseShared = runClosing === run.close();
          const [exited, closed] = await Promise.all([run.exited, runClosing]);
          const closeSettledAtExit = JSON.stringify(closed) === JSON.stringify(exited);
          const previewClosed = rejectsClosed(() => previews.snapshot());
          const sessionClosed = rejectsClosed(() => session.run());
          const outputAtClose = output;
          const startsAtClose = output.split('[nodemon] starting').length - 1;
          await new Promise((resolve) => setTimeout(resolve, 4_000));
          const afterClose = await probe();
          const transitions = previewHistory.filter(
            (state, index) => index === 0 || state !== previewHistory[index - 1],
          );
          return {
            installed,
            initial: initialProbe[0] === 200 && initialProbe[1] === initialBody,
            sessionCloseShared,
            runCloseShared,
            closeSettledAtExit,
            previewClosed,
            sessionClosed,
            liveThenEmpty: transitions.filter(Boolean).length === 1 && transitions.at(-1) === false,
            routeGone:
              afterClose[0] !== 200 && afterClose[1] !== 'nodemon-session-must-not-resurrect',
            noRestart: output.split('[nodemon] starting').length - 1 === startsAtClose,
            transcriptStable: output === outputAtClose,
          };
        } finally {
          unsubscribePreview();
          detachOutput();
        }
      },
      {
        fixtureUrl: sealedWorkbenchFixtureUrl,
        packageJson:
          '{"name":"bu-nodemon-session-close-race","private":true,"type":"module","scripts":{"dev":"nodemon --legacy-watch --no-stdin --no-update-notifier src/main.js"},"dependencies":{"nodemon":"3.1.14"}}\n',
        initialSource: serverSource('nodemon-session-initial', 0),
        queuedSource: serverSource('nodemon-session-must-not-resurrect', 3_000),
      },
    );
    expect(Object.values(result)).toEqual(Array.from({ length: 11 }, () => true));
  } finally {
    await closeOwner(page);
  }
});
