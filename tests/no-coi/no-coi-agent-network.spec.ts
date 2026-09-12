import { expect, test } from '@playwright/test';

test('a project Node HTTP listener retains command ownership until Stop closes it', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto('/no-coi-harness.html');
  const observed = await page.evaluate(
    async (root) => {
      const { createSandbox } = await import(`/@fs${root}/packages/rifty/src/index.ts`);
      const sandbox = await createSandbox({
        requireCrossOriginIsolation: false,
        skipServiceWorker: true,
        toolchain: {
          workerUrl: `/@fs${root}/packages/workbench/src/workers/no-coi-toolchain-worker.ts`,
        },
      });
      try {
        const project = sandbox.project({ root: '/agent-network' });
        await project.fs.writeFile(
          'server.cjs',
          `
        const http = require('node:http');
        const server = http.createServer((req, res) => res.end('ok'));
        process.once('SIGINT', () => server.close(() => console.log('server-closed')));
        server.listen(5714, '127.0.0.1', () => console.log('server-ready'));
      `,
        );
        const run = project.run('node server.cjs');
        const events: string[] = [];
        let ready!: () => void;
        const listening = new Promise<void>((resolve) => {
          ready = resolve;
        });
        run.onOutput(({ stream, chunk }) => {
          events.push(`${stream}:${chunk}`);
          if (chunk.includes('server-ready')) ready();
        });
        const entered = await Promise.race([
          listening.then(() => 'ready'),
          run.completion.then((result) => ({ premature: result })),
        ]);
        const beforeStop = await Promise.race([
          run.completion.then((result) => ({ settled: result })),
          new Promise<'pending'>((resolve) => setTimeout(() => resolve('pending'), 150)),
        ]);
        const stopped = await run.stop();
        const same = stopped === (await run.completion);
        const nextEvents: string[] = [];
        const nextRun = project.run('echo next');
        nextRun.onOutput(({ stream, chunk }) => nextEvents.push(`${stream}:${chunk}`));
        const next = await nextRun.completion;
        return {
          coi: crossOriginIsolated,
          entered,
          beforeStop,
          stopped,
          same,
          events,
          next,
          nextEvents,
        };
      } finally {
        sandbox.dispose();
      }
    },
    process.cwd().replaceAll('\\', '/'),
  );
  expect(observed.coi).toBe(false);
  expect(observed.entered).toBe('ready');
  expect(observed.beforeStop).toBe('pending');
  expect(observed.stopped).toMatchObject({
    status: 'cancelled',
    worker: 'retained',
    stdout: 'server-ready\nserver-closed\n',
  });
  expect(observed.same).toBe(true);
  expect(observed.events).toEqual(['stdout:server-ready\n', 'stdout:server-closed\n']);
  expect(observed.next).toMatchObject({ status: 'exited', exitCode: 0, stdout: 'next\n' });
  expect(observed.nextEvents).toEqual(['stdout:next\n']);
});
