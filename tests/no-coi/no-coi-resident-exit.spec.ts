import { expect, test } from '@playwright/test';

test('host exits the resident through replacement; restart still replays until explicit exit', async ({
  page,
}) => {
  await page.goto('/no-coi-harness.html');
  const value = await page.evaluate(
    async (root) => {
      const { createSandbox } = await import(`/@fs${root}/packages/rifty/src/index.ts`);
      const sandbox = await createSandbox({
        requireCrossOriginIsolation: false,
        serviceWorkerUrl: '/sw.js',
        toolchain: {
          workerUrl: `/@fs${root}/packages/workbench/src/workers/no-coi-toolchain-worker.ts`,
        },
      });
      try {
        await sandbox.fs.writeFile(
          '/resident/node_modules/local-server/package.json',
          '{"name":"local-server","type":"commonjs"}',
        );
        await sandbox.fs.writeFile(
          '/resident/node_modules/local-server/cli.js',
          "require('node:http').createServer((req,res)=>res.end('real-resident')).listen(5192);",
        );
        const binPath = '/resident/node_modules/.bin/local-server';
        await sandbox.fs.writeFile(
          binPath,
          "#!/usr/bin/env node\nimport('../local-server/cli.js');\n",
        );
        const project = sandbox.project({ root: '/resident' });
        await project.fs.writeFile('saved.txt', 'before');
        const resident = await sandbox.toolchain.startBin({
          cwd: '/resident',
          binPath,
          args: [],
          port: 5192,
        });
        const initial = await (await fetch(resident.previewUrl)).text();
        const preview = { src: resident.previewUrl };
        const replayed = await sandbox.restart({ preview });
        const afterRestart = await (await fetch(preview.src)).text();
        const pending = sandbox.stopResident();
        const overlap = await sandbox.restart({ preview }).then(
          () => 'unexpected restart',
          (error: Error) => error.name,
        );
        const exited = await pending;
        const saved = await project.fs.readFile('saved.txt', 'utf8');
        await project.fs.writeFile('saved.txt', 'after');
        const command = await project.run('cat saved.txt').completion;
        const later = await sandbox.restart({ preview });
        const next = await project.run('echo next').completion;
        return { initial, replayed, afterRestart, overlap, exited, saved, command, later, next };
      } finally {
        sandbox.dispose();
      }
    },
    process.cwd().replaceAll('\\', '/'),
  );
  expect(value.initial).toBe('real-resident');
  expect(value.replayed.resident?.port).toBe(5192);
  expect(value.afterRestart).toBe('real-resident');
  expect(value.overlap).toBe('SandboxRestartBusyError');
  expect(value.exited).toEqual({ resident: null, unflushedWrites: false });
  expect(value.saved).toBe('before');
  expect(value.command).toMatchObject({ status: 'exited', exitCode: 0, stdout: 'after' });
  expect(value.later.resident).toBeNull();
  expect(value.next).toMatchObject({ status: 'exited', exitCode: 0, stdout: 'next\n' });
});
