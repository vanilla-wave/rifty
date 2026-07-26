import { expect, test } from '@playwright/test';
import { closeOwner, gotoHarness, sealedWorkbenchFixtureUrl } from './fixtures.ts';

const PORT = 4397;
const DEV_SCRIPT = 'nodemon --legacy-watch --no-stdin --no-update-notifier src/main.js';
const INITIAL_BODY = 'nodemon-session-initial';
const QUEUED_BODY = 'nodemon-session-must-not-resurrect';

function serverSource(body: string, listenDelayMs: number): string {
  return [
    "import { createServer } from 'node:http';",
    `console.log(${JSON.stringify(`APP_BOOT:${body}`)} + ' pid=' + process.pid + ' ppid=' + process.ppid);`,
    ...(listenDelayMs === 0
      ? []
      : [`await new Promise((resolve) => setTimeout(resolve, ${String(listenDelayMs)}));`]),
    'const server = createServer((_request, response) => {',
    "  response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });",
    `  response.end(${JSON.stringify(body)});`,
    '});',
    'server.listen(Number(process.env.PORT), () => {',
    `  console.log(${JSON.stringify(`APP_LISTENING:${body}`)});`,
    '});',
    '',
  ].join('\n');
}

test('session close fences an admitted nodemon restart without subtree or route resurrection', async ({
  page,
}) => {
  test.setTimeout(360_000);
  await gotoHarness(page);
  await page.route('**/npm-registry/**', (route) => route.continue());
  await page.route('**/npm-tarballs/**', (route) => route.continue());

  try {
    const result = await page.evaluate(
      async ({ fixtureUrl, port, devScript, initialBody, initialSource, queuedSource }) => {
        const fixture = await import(/* @vite-ignore */ fixtureUrl);
        await fixture.openSealedWorkbenchFixture({
          workspaceId: 'bu-nodemon-session-close-race',
          persistence: 'ephemeral',
          plan: {
            kind: 'node-server',
            id: 'scratch',
            starterId: 'bu-nodemon-session-close-race',
            templateId: 'browser-unit:nodemon-session-close-race',
            files: {
              '/package.json': `${JSON.stringify({
                name: 'bu-nodemon-session-close-race',
                private: true,
                type: 'module',
                scripts: {
                  dev: devScript,
                  start: 'node src/main.js',
                },
                dependencies: { nodemon: '3.1.14' },
              })}\n`,
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
        const previewHistory: number[][] = [];
        const unsubscribePreview = previews.subscribe(
          (snapshot: readonly { readonly port: number }[]) => {
            previewHistory.push(snapshot.map((entry) => entry.port));
          },
        );
        const run = session.run();
        let output = '';
        const detachOutput = run.terminal.attach((chunk: string) => {
          output += chunk;
        });

        const waitUntil = async (
          predicate: () => boolean | Promise<boolean>,
          label: string,
          timeoutMs: number,
        ): Promise<void> => {
          const deadline = Date.now() + timeoutMs;
          while (!(await predicate())) {
            if (Date.now() >= deadline) {
              throw new Error(`${label} timed out\n${output}`);
            }
            await new Promise((resolve) => setTimeout(resolve, 50));
          }
        };

        const probe = async (): Promise<{
          readonly served: boolean;
          readonly status: number;
          readonly body: string;
        }> => {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 2_000);
          try {
            const response = await fetch(`/preview/${String(port)}/`, {
              cache: 'no-store',
              signal: controller.signal,
            });
            const body = await response.text();
            return {
              served: response.status === 200 && body === initialBody,
              status: response.status,
              body,
            };
          } catch (error) {
            return {
              served: false,
              status: 0,
              body: error instanceof Error ? error.message : String(error),
            };
          } finally {
            clearTimeout(timer);
          }
        };

        try {
          try {
            await run.ready;
          } catch (error) {
            throw new Error(
              `${error instanceof Error ? error.message : String(error)}\nterminal:\n${output}`,
            );
          }
          if (!output.includes(`> ${devScript}`) || !output.includes('[nodemon] starting')) {
            throw new Error(`project did not execute real installed nodemon\n${output}`);
          }
          await waitUntil(
            () =>
              previews.snapshot().some((entry: { readonly port: number }) => entry.port === port),
            'initial semantic preview',
            30_000,
          );
          const initialProbe = await probe();
          if (!initialProbe.served) {
            throw new Error(`initial routed app was not served: ${JSON.stringify(initialProbe)}`);
          }

          await fixture.writeProjectText('/scratch/src/main.js', queuedSource);
          await waitUntil(
            () => output.includes('[nodemon] restarting due to changes'),
            'real nodemon watch restart admission',
            45_000,
          );

          const startsAtClose = output.split('[nodemon] starting').length - 1;
          const sessionClosing = session.close();
          const repeatedSessionClosing = session.close();
          const sessionCloseWasShared = sessionClosing === repeatedSessionClosing;
          await sessionClosing;

          const firstRunClose = run.close();
          const repeatedRunClose = run.close();
          const runCloseWasShared = firstRunClose === repeatedRunClose;
          const [exited, closed] = await Promise.all([run.exited, firstRunClose]);

          let previewAfterCloseError: { readonly name: string; readonly message: string } | null =
            null;
          try {
            previews.snapshot();
          } catch (error) {
            const inspected = error instanceof Error ? error : new Error(String(error));
            previewAfterCloseError = { name: inspected.name, message: inspected.message };
          }
          let rerunAfterCloseError: { readonly name: string; readonly message: string } | null =
            null;
          try {
            session.run();
          } catch (error) {
            const inspected = error instanceof Error ? error : new Error(String(error));
            rerunAfterCloseError = { name: inspected.name, message: inspected.message };
          }

          const outputAtClose = output;
          await new Promise((resolve) => setTimeout(resolve, 4_000));
          const afterRestartWindow = await probe();
          const startsAfterRestartWindow = output.split('[nodemon] starting').length - 1;

          return {
            initialProbe,
            previewHistory,
            output,
            outputStableAfterClose: output === outputAtClose,
            startsAtClose,
            startsAfterRestartWindow,
            sessionCloseWasShared,
            runCloseWasShared,
            exited,
            closed,
            previewAfterCloseError,
            rerunAfterCloseError,
            afterRestartWindow,
          };
        } finally {
          unsubscribePreview();
          detachOutput();
        }
      },
      {
        fixtureUrl: sealedWorkbenchFixtureUrl,
        port: PORT,
        devScript: DEV_SCRIPT,
        initialBody: INITIAL_BODY,
        initialSource: serverSource(INITIAL_BODY, 0),
        queuedSource: serverSource(QUEUED_BODY, 3_000),
      },
    );

    const transitions = result.previewHistory.reduce<number[][]>((collapsed, snapshot) => {
      const previous = collapsed.at(-1);
      if (
        previous === undefined ||
        previous.length !== snapshot.length ||
        previous.some((port, index) => port !== snapshot[index])
      ) {
        collapsed.push(snapshot);
      }
      return collapsed;
    }, []);
    const liveToEmptyTransitions = transitions.filter(
      (snapshot, index) =>
        snapshot.length === 0 && index > 0 && (transitions[index - 1]?.length ?? 0) > 0,
    );
    const definitiveEmptyIndex = transitions.findIndex(
      (snapshot, index) =>
        snapshot.length === 0 && index > 0 && (transitions[index - 1]?.length ?? 0) > 0,
    );

    expect(result.initialProbe).toEqual({
      served: true,
      status: 200,
      body: INITIAL_BODY,
    });
    expect(result.sessionCloseWasShared).toBe(true);
    expect(result.runCloseWasShared).toBe(true);
    expect(result.closed).toEqual(result.exited);
    expect(result.previewAfterCloseError).toMatchObject({ name: 'ClosedHandleError' });
    expect(result.rerunAfterCloseError).toMatchObject({ name: 'ClosedHandleError' });
    expect(liveToEmptyTransitions).toHaveLength(1);
    expect(definitiveEmptyIndex).toBeGreaterThan(0);
    expect(
      transitions.slice(definitiveEmptyIndex + 1).every((snapshot) => snapshot.length === 0),
    ).toBe(true);
    expect(result.afterRestartWindow.served).toBe(false);
    expect(result.afterRestartWindow.body).not.toBe(QUEUED_BODY);
    expect(result.startsAfterRestartWindow).toBe(result.startsAtClose);
    expect(result.outputStableAfterClose, result.output).toBe(true);
  } finally {
    await closeOwner(page);
  }
});
