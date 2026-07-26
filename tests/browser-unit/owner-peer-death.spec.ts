import { expect, test } from '@playwright/test';
import { gotoHarness, sealedWorkbenchFixtureUrl } from './fixtures.ts';

const PREVIEW_PORT = 43892;
const RESPONSE_MARKER = 'supervisor-descendant-alive';

test('supervisor peer death physically retires its descendant and invalidates the public preview', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await gotoHarness(page);

  const result = await page.evaluate(
    async ({ fixtureUrl, port, responseMarker }) => {
      interface PreviewEntry {
        readonly port: number;
        readonly url: string;
        readonly source: string;
      }

      interface ProcessExit {
        readonly code: number | null;
        readonly signal: string | null;
      }

      type ExitObservation =
        | { readonly kind: 'exit'; readonly exit: ProcessExit }
        | { readonly kind: 'error'; readonly name: string; readonly message: string };

      type RouteObservation =
        | {
            readonly kind: 'response';
            readonly ok: boolean;
            readonly status: number;
            readonly body: string;
          }
        | { readonly kind: 'error'; readonly name: string; readonly message: string };

      const withTimeout = async <T>(
        operation: Promise<T>,
        label: string,
        timeoutMs: number,
      ): Promise<T> => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          return await Promise.race([
            operation,
            new Promise<never>((_resolve, reject) => {
              timer = setTimeout(
                () => reject(new Error(`${label} timed out after ${String(timeoutMs)}ms`)),
                timeoutMs,
              );
            }),
          ]);
        } finally {
          if (timer !== undefined) clearTimeout(timer);
        }
      };

      const waitUntil = async (
        predicate: () => boolean,
        label: string,
        timeoutMs: number,
      ): Promise<void> => {
        const deadline = performance.now() + timeoutMs;
        while (!predicate()) {
          if (performance.now() >= deadline) {
            throw new Error(
              `${label} timed out after ${String(timeoutMs)}ms\nterminal:\n${transcript}`,
            );
          }
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
      };

      const fixture = await import(/* @vite-ignore */ fixtureUrl);
      const crashChannelName = `rifty:test:supervisor-peer-death:${crypto.randomUUID()}`;
      const crashNonce = crypto.randomUUID();
      const crashChannel = new BroadcastChannel(crashChannelName);

      let opened = false;
      let terminal:
        | {
            attach(listener: (chunk: string) => void): () => void;
            run(line: string): {
              readonly ready: Promise<void>;
              readonly exited: Promise<ProcessExit>;
              close(): Promise<ProcessExit>;
            };
            close(): Promise<void>;
          }
        | undefined;
      let run: ReturnType<NonNullable<typeof terminal>['run']> | undefined;
      let detachTerminal: (() => void) | undefined;
      let detachPreviews: (() => void) | undefined;
      let transcript = '';

      try {
        await fixture.openSealedWorkbenchFixture({
          workspaceId: 'browser-unit-supervisor-peer-death',
          template: 'hidden-empty',
          persistence: 'ephemeral',
        });
        opened = true;
        await fixture.writeProjectText(
          '/scratch/peer-death-server.mjs',
          `import { createServer } from 'node:http';

const server = createServer((_request, response) => {
  response.end(${JSON.stringify(responseMarker)});
});
server.listen(${String(port)}, '127.0.0.1', () => {
  process.send({ kind: 'descendant-ready', port: ${String(port)} });
});
`,
        );
        await fixture.writeProjectText(
          '/scratch/peer-death-supervisor.mjs',
          `import { fork } from 'node:child_process';

const crashChannel = new BroadcastChannel(${JSON.stringify(crashChannelName)});
const child = fork('./peer-death-server.mjs', [], {
  cwd: '/scratch',
  stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
});
child.once('error', (error) => {
  throw error;
});
child.once('message', (message) => {
  if (message?.kind === 'descendant-ready') {
    process.stdout.write('SUPERVISOR_DESCENDANT_READY|' + JSON.stringify({
      supervisorPid: process.pid,
      childPid: child.pid,
      port: message.port,
    }) + '\\n');
  }
});
crashChannel.addEventListener('message', (event) => {
  const value = event.data;
  if (
    value !== null &&
    typeof value === 'object' &&
    value.kind === 'crash-supervisor-peer' &&
    value.nonce === ${JSON.stringify(crashNonce)}
  ) {
    crashChannel.postMessage({ kind: 'supervisor-peer-closing', nonce: value.nonce });
    crashChannel.close();
    queueMicrotask(() => {
      globalThis.close();
    });
  }
});
`,
        );
        const project = fixture.currentProject();
        const previews = fixture.currentSessionTools().previews;
        const previewSnapshots: PreviewEntry[][] = [];
        detachPreviews = previews.subscribe((entries: readonly PreviewEntry[]) => {
          previewSnapshots.push([...entries]);
        });

        const openedTerminal = project.terminals.open() as NonNullable<typeof terminal>;
        terminal = openedTerminal;
        detachTerminal = openedTerminal.attach((chunk: string) => {
          transcript += chunk;
        });
        const activeRun = openedTerminal.run('node peer-death-supervisor.mjs');
        run = activeRun;
        await withTimeout(activeRun.ready, 'supervisor terminal admission', 15_000);
        await withTimeout(
          Promise.all([
            waitUntil(
              () => transcript.includes('SUPERVISOR_DESCENDANT_READY|'),
              'supervisor descendant readiness',
              30_000,
            ),
            waitUntil(
              () =>
                previewSnapshots.some((snapshot) => snapshot.some((entry) => entry.port === port)),
              'supervisor descendant preview',
              30_000,
            ),
          ]),
          'active supervisor descendant',
          35_000,
        );

        const livePreview = [...previewSnapshots]
          .reverse()
          .flat()
          .find((entry) => entry.port === port);
        if (livePreview === undefined) throw new Error('Active descendant preview was lost');
        const beforeResponse = await withTimeout(
          fetch(new URL(livePreview.url, location.href), { cache: 'no-store' }),
          'supervisor descendant routed response',
          15_000,
        );
        const beforeBody = await withTimeout(
          beforeResponse.text(),
          'supervisor descendant routed response body',
          15_000,
        );

        const observedExit = activeRun.exited.then<ExitObservation, ExitObservation>(
          (exit) => ({ kind: 'exit', exit }),
          (error: unknown) => ({
            kind: 'error',
            name: error instanceof Error ? error.name : '',
            message: error instanceof Error ? error.message : String(error),
          }),
        );
        const crashAdmitted = new Promise<void>((resolve) => {
          crashChannel.addEventListener(
            'message',
            (event) => {
              const value = event.data as { readonly kind?: unknown; readonly nonce?: unknown };
              if (value.kind === 'supervisor-peer-closing' && value.nonce === crashNonce) resolve();
            },
            { once: true },
          );
        });
        crashChannel.postMessage({ kind: 'crash-supervisor-peer', nonce: crashNonce });
        await withTimeout(crashAdmitted, 'supervisor peer-death fault admission', 5_000);

        const exit = await withTimeout(observedExit, 'supervisor peer-death visibility', 15_000);
        await waitUntil(
          () => (previewSnapshots.at(-1)?.length ?? -1) === 0,
          'supervisor peer-death preview invalidation',
          15_000,
        );

        const route = await withTimeout<RouteObservation>(
          fetch(new URL(livePreview.url, location.href), { cache: 'no-store' }).then(
            async (response) => ({
              kind: 'response',
              ok: response.ok,
              status: response.status,
              body: await response.text(),
            }),
            (error: unknown) => ({
              kind: 'error',
              name: error instanceof Error ? error.name : '',
              message: error instanceof Error ? error.message : String(error),
            }),
          ),
          'retired descendant routed response',
          15_000,
        );

        return {
          before: {
            responseOk: beforeResponse.ok,
            body: beforeBody,
            transcript,
            preview: livePreview,
          },
          exit,
          finalPreviewSnapshot: previewSnapshots.at(-1) ?? null,
          route,
        };
      } finally {
        detachTerminal?.();
        detachPreviews?.();
        crashChannel.close();
        if (run !== undefined) {
          await withTimeout(run.close(), 'supervisor run cleanup', 10_000).catch(() => {});
        }
        if (terminal !== undefined) {
          await withTimeout(terminal.close(), 'supervisor terminal cleanup', 10_000).catch(
            () => {},
          );
        }
        if (opened) {
          await withTimeout(
            fixture.closeSealedWorkbenchFixture(),
            'supervisor Workbench cleanup',
            15_000,
          ).catch(() => {});
        }
      }
    },
    { fixtureUrl: sealedWorkbenchFixtureUrl, port: PREVIEW_PORT, responseMarker: RESPONSE_MARKER },
  );

  expect(result.before.responseOk).toBe(true);
  expect(result.before.body).toBe(RESPONSE_MARKER);
  expect(result.before.transcript).toContain('SUPERVISOR_DESCENDANT_READY|');
  expect(result.before.preview).toMatchObject({ port: PREVIEW_PORT, source: 'node' });
  expect(result.exit).toMatchObject({
    kind: 'error',
    message: expect.stringMatching(/peer|exited unexpectedly|closed/u),
  });
  expect(result.finalPreviewSnapshot).toEqual([]);
  if (result.route.kind === 'response') {
    expect(result.route.ok, result.route.body).toBe(false);
  } else {
    expect(result.route.message).not.toBe('');
  }
});
