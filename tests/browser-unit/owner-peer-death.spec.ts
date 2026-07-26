import { expect, test } from '@playwright/test';
import { gotoHarness, sealedWorkbenchFixtureUrl } from './fixtures.ts';

const PREVIEW_PORT = 43892;
const RESPONSE_MARKER = 'supervisor-descendant-alive';
const SUCCESSOR_MARKER = 'successor-after-peer-death';

test('supervisor peer death physically retires its descendant and invalidates the public preview', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await gotoHarness(page);

  const result = await page.evaluate(
    async ({ fixtureUrl, port, responseMarker, successorMarker }) => {
      interface PreviewEntry {
        readonly port: number;
        readonly url: string;
        readonly source: string;
      }

      type ProcessExit = { readonly code: number | null; readonly signal: string | null };

      const withTimeout = <T>(
        operation: Promise<T>,
        label: string,
        timeoutMs: number,
      ): Promise<T> =>
        Promise.race([
          operation,
          new Promise<never>((_resolve, reject) =>
            setTimeout(
              () => reject(new Error(`${label} timed out after ${String(timeoutMs)}ms`)),
              timeoutMs,
            ),
          ),
        ]);

      const waitUntil = async (
        predicate: () => boolean,
        label: string,
        timeoutMs: number,
      ): Promise<void> => {
        const deadline = performance.now() + timeoutMs;
        while (!predicate()) {
          if (performance.now() >= deadline) {
            throw new Error(`${label} timed out\nterminal:\n${transcript}`);
          }
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
      };

      const fixture = await import(/* @vite-ignore */ fixtureUrl);
      const crashChannelName = `rifty:test:supervisor-peer-death:${crypto.randomUUID()}`;
      const crashNonce = crypto.randomUUID();
      const crashChannel = new BroadcastChannel(crashChannelName);

      let detachPreviews = (): void => {};
      let transcript = '';
      let successorTranscript = '';

      try {
        await fixture.openSealedWorkbenchFixture({
          workspaceId: 'browser-unit-supervisor-peer-death',
          template: 'hidden-empty',
          persistence: 'ephemeral',
        });
        await fixture.writeProjectText(
          '/scratch/peer-death-server.mjs',
          `import { createServer } from 'node:http';
createServer((_request, response) => response.end(${JSON.stringify(responseMarker)}))
  .listen(${String(port)}, '127.0.0.1', () =>
    process.send({ kind: 'descendant-ready', port: ${String(port)} }));
`,
        );
        await fixture.writeProjectText(
          '/scratch/peer-death-supervisor.mjs',
          `import { fork } from 'node:child_process';

const crashChannel = new BroadcastChannel(${JSON.stringify(crashChannelName)});
const child = fork('./peer-death-server.mjs', [], {
  cwd: '/scratch', stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
child.once('error', (error) => { throw error; });
child.once('message', (message) => {
  if (message?.kind === 'descendant-ready') process.stdout.write(
    'SUPERVISOR_DESCENDANT_READY|' + JSON.stringify({
      supervisorPid: process.pid,
      childPid: child.pid,
      port: message.port,
    }) + '\\n',
  );
});
crashChannel.addEventListener('message', (event) => {
  const value = event.data;
  if (value?.kind !== 'crash-supervisor-peer' ||
      value.nonce !== ${JSON.stringify(crashNonce)}) return;
  crashChannel.postMessage({ kind: 'supervisor-peer-closing', nonce: value.nonce });
  crashChannel.close();
  queueMicrotask(() => globalThis.close());
});
`,
        );
        await fixture.writeProjectText(
          '/scratch/peer-death-successor.mjs',
          `import { createServer } from 'node:http';
createServer((_request, response) => response.end(${JSON.stringify(successorMarker)}))
  .listen(${String(port)}, '127.0.0.1', () =>
    process.stdout.write('SUCCESSOR_BOUND_SAME_PORT\\n'));
`,
        );
        const project = fixture.currentProject();
        const previews = fixture.currentSessionTools().previews;
        let previewSnapshot: PreviewEntry[] = [];
        detachPreviews = previews.subscribe((entries: readonly PreviewEntry[]) => {
          previewSnapshot = [...entries];
        });

        const terminal = project.terminals.open();
        terminal.attach((chunk: string) => {
          transcript += chunk;
        });
        const activeRun = terminal.run('node peer-death-supervisor.mjs');
        await withTimeout(activeRun.ready, 'supervisor terminal admission', 15_000);
        await Promise.all([
          waitUntil(
            () => transcript.includes('SUPERVISOR_DESCENDANT_READY|'),
            'supervisor descendant readiness',
            30_000,
          ),
          waitUntil(
            () => previewSnapshot.some((entry) => entry.port === port),
            'supervisor descendant preview',
            30_000,
          ),
        ]);

        const livePreview = previewSnapshot.find((entry) => entry.port === port);
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

        const observedExit = activeRun.exited.then(
          (exit: ProcessExit) => ({ kind: 'exit' as const, exit }),
          (error: unknown) => ({
            kind: 'error',
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
          () => previewSnapshot.length === 0,
          'supervisor peer-death preview invalidation',
          15_000,
        );
        const peerDeathPreviewSnapshot = [...previewSnapshot];

        const route = await withTimeout(
          fetch(new URL(livePreview.url, location.href), { cache: 'no-store' }).then(
            (response) => ({
              kind: 'response' as const,
              ok: response.ok,
            }),
            (error: unknown) => ({
              kind: 'error' as const,
              message: error instanceof Error ? error.message : String(error),
            }),
          ),
          'retired descendant routed response',
          15_000,
        );

        const successorTerminal = project.terminals.open();
        successorTerminal.attach((chunk: string) => {
          successorTranscript += chunk;
        });
        const replacementRun = successorTerminal.run('node peer-death-successor.mjs');
        await withTimeout(replacementRun.ready, 'same-port successor terminal admission', 15_000);
        await waitUntil(
          () =>
            successorTranscript.includes('SUCCESSOR_BOUND_SAME_PORT') &&
            previewSnapshot.some((entry) => entry.port === port),
          'same-port successor bind and preview',
          30_000,
        );
        const successorPreview = previewSnapshot.find((entry) => entry.port === port);
        if (successorPreview === undefined) throw new Error('same-port successor preview was lost');
        const successorResponse = await withTimeout(
          fetch(new URL(successorPreview.url, location.href), { cache: 'no-store' }),
          'same-port successor routed response',
          15_000,
        );
        const successorBody = await withTimeout(
          successorResponse.text(),
          'same-port successor routed response body',
          15_000,
        );

        return {
          before: {
            responseOk: beforeResponse.ok,
            body: beforeBody,
            preview: livePreview,
          },
          exit,
          peerDeathPreviewSnapshot,
          route,
          successor: {
            responseOk: successorResponse.ok,
            body: successorBody,
            transcript: successorTranscript,
            previewSnapshot,
          },
        };
      } finally {
        detachPreviews();
        crashChannel.close();
        await withTimeout(
          fixture.closeSealedWorkbenchFixture(),
          'supervisor Workbench cleanup',
          15_000,
        ).catch(() => {});
      }
    },
    {
      fixtureUrl: sealedWorkbenchFixtureUrl,
      port: PREVIEW_PORT,
      responseMarker: RESPONSE_MARKER,
      successorMarker: SUCCESSOR_MARKER,
    },
  );

  expect(result.before.responseOk).toBe(true);
  expect(result.before.body).toBe(RESPONSE_MARKER);
  expect(result.before.preview).toMatchObject({ port: PREVIEW_PORT, source: 'node' });
  expect(result.exit).toMatchObject({
    kind: 'error',
    message: expect.stringMatching(/peer|exited unexpectedly|closed/u),
  });
  expect(result.peerDeathPreviewSnapshot).toEqual([]);
  if (result.route.kind === 'response') {
    expect(result.route.ok).toBe(false);
  } else {
    expect(result.route.message).not.toBe('');
  }
  expect(result.successor).toMatchObject({
    responseOk: true,
    body: SUCCESSOR_MARKER,
    transcript: expect.stringContaining('SUCCESSOR_BOUND_SAME_PORT'),
    previewSnapshot: [
      expect.objectContaining({
        port: PREVIEW_PORT,
        source: 'node',
      }),
    ],
  });
});
