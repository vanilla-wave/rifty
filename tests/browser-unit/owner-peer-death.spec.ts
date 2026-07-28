import { expect, test } from '@playwright/test';
import { gotoHarness, sealedWorkbenchFixtureUrl } from './fixtures.ts';

test('supervisor peer death retires its descendant and preview', async ({ page }) => {
  test.setTimeout(180_000);
  await gotoHarness(page);

  const result = await page.evaluate(
    async ({ fixtureUrl, port, responseMarker, successorMarker }) => {
      type Preview = { readonly port: number; readonly url: string; readonly source: string };
      let transcript = '';
      const timeout = <T>(promise: Promise<T>, label: string, ms = 15_000): Promise<T> =>
        Promise.race([
          promise,
          new Promise<never>((_resolve, reject) =>
            setTimeout(() => reject(new Error(`${label} timed out`)), ms),
          ),
        ]);
      const until = async (predicate: () => boolean, label: string, ms = 30_000) => {
        const deadline = performance.now() + ms;
        while (!predicate()) {
          if (performance.now() >= deadline) throw new Error(`${label} timed out\n${transcript}`);
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
      };
      const fixture = await import(/* @vite-ignore */ fixtureUrl);
      const channelName = `rifty:test:supervisor-peer-death:${crypto.randomUUID()}`;
      const nonce = crypto.randomUUID();
      const channel = new BroadcastChannel(channelName);
      const request = (url: string) => fetch(new URL(url, location.href), { cache: 'no-store' });
      const workspace = { workspaceId: 'peer-death', template: 'hidden-empty' } as const;
      let detach = () => {};

      try {
        await fixture.openSealedWorkbenchFixture({ ...workspace, persistence: 'ephemeral' });
        await fixture.writeProjectText(
          '/scratch/peer-death-server.mjs',
          `import { createServer } from 'node:http';
createServer((_request, response) => response.end(${JSON.stringify(responseMarker)}))
  .listen(${String(port)}, '127.0.0.1', () =>
    process.send({ kind: 'descendant-ready', port: ${String(port)} }));`,
        );
        await fixture.writeProjectText(
          '/scratch/peer-death-supervisor.mjs',
          `import { fork } from 'node:child_process';
const channel = new BroadcastChannel(${JSON.stringify(channelName)});
const child = fork('./peer-death-server.mjs', [], { cwd: process.cwd(),
  stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
child.once('error', (error) => { throw error; });
child.once('message', (message) => {
  if (message?.kind === 'descendant-ready') process.stdout.write('DESCENDANT_READY\\n');
});
channel.addEventListener('message', (event) => {
  if (event.data?.kind !== 'crash' || event.data.nonce !== ${JSON.stringify(nonce)}) return;
  channel.postMessage({ kind: 'closing', nonce: event.data.nonce });
  channel.close();
  queueMicrotask(() => globalThis.close());
});`,
        );
        await fixture.writeProjectText(
          '/scratch/peer-death-successor.mjs',
          `import { createServer } from 'node:http';
createServer((_request, response) => response.end(${JSON.stringify(successorMarker)}))
  .listen(${String(port)}, '127.0.0.1', () => process.stdout.write('SUCCESSOR_BOUND\\n'));`,
        );

        const project = fixture.currentProject();
        let previews: Preview[] = [];
        detach = fixture.currentSessionTools().previews.subscribe((entries: readonly Preview[]) => {
          previews = [...entries];
        });
        const terminal = project.terminals.open();
        terminal.attach((chunk: string) => {
          transcript += chunk;
        });
        const run = terminal.run('node peer-death-supervisor.mjs');
        await timeout(run.ready, 'supervisor admission');
        await Promise.all([
          until(() => transcript.includes('DESCENDANT_READY'), 'descendant readiness'),
          until(() => previews.some((entry) => entry.port === port), 'descendant preview'),
        ]);

        const live = previews.find((entry) => entry.port === port);
        if (live === undefined || live.source !== 'node') throw new Error('preview missing');
        const before = await timeout(request(live.url), 'routed response');
        const exitMessage = run.exited.then(
          () => '',
          (error: unknown) => (error instanceof Error ? error.message : String(error)),
        );
        const admitted = new Promise<void>((resolve) =>
          channel.addEventListener(
            'message',
            (event) => {
              if (event.data?.kind === 'closing' && event.data.nonce === nonce) resolve();
            },
            { once: true },
          ),
        );
        channel.postMessage({ kind: 'crash', nonce });
        await timeout(admitted, 'peer-death admission', 5_000);
        const peerDeath = await timeout(exitMessage, 'peer-death visibility');
        await until(() => previews.length === 0, 'preview invalidation', 15_000);

        let staleUnavailable = false;
        try {
          staleUnavailable = !(await timeout(request(live.url), 'stale route')).ok;
        } catch (error) {
          staleUnavailable = error instanceof Error && error.message !== '';
        }

        let successorTranscript = '';
        const successorTerminal = project.terminals.open();
        successorTerminal.attach((chunk: string) => {
          successorTranscript += chunk;
        });
        const successorRun = successorTerminal.run('node peer-death-successor.mjs');
        await timeout(successorRun.ready, 'successor admission');
        await until(
          () =>
            successorTranscript.includes('SUCCESSOR_BOUND') &&
            previews.some((entry) => entry.port === port),
          'successor bind',
        );
        const successor = previews.find((entry) => entry.port === port);
        if (successor === undefined || successor.source !== 'node') {
          throw new Error('successor preview missing');
        }
        const response = await timeout(request(successor.url), 'successor');
        return {
          before: before.ok && (await before.text()) === responseMarker,
          peerDeath,
          staleUnavailable,
          successor: response.ok && (await response.text()) === successorMarker,
        };
      } finally {
        detach();
        channel.close();
        await timeout(fixture.closeSealedWorkbenchFixture(), 'cleanup').catch(() => {});
      }
    },
    {
      fixtureUrl: sealedWorkbenchFixtureUrl,
      port: 43892,
      responseMarker: 'supervisor-descendant-alive',
      successorMarker: 'successor-after-peer-death',
    },
  );

  expect(result).toMatchObject({
    before: true,
    peerDeath: expect.stringMatching(/peer|exited unexpectedly|closed/u),
    staleUnavailable: true,
    successor: true,
  });
});
