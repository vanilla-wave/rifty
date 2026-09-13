import { execFileSync } from 'node:child_process';
import { expect, test } from '@playwright/test';
import { nativeReplicaProbeSource } from './fixtures/native-replica-page.ts';

const root = process.cwd().replaceAll('\\', '/');
const payload = [0, 255, 17, 128, 65, 0, 234, 42, 99];
// Execute this exact consumer against Node and the SDK's real toolchain Worker.
const probe = `async (fs, dir) => {
  const read = (path, options = {}) => new Promise((resolve) => {
    const bytes = [];
    const stream = fs.createReadStream(path, { highWaterMark: 2, ...options });
    stream.on('data', chunk => bytes.push(...chunk));
    stream.on('error', error => resolve({ bytes, error: error.code }));
    stream.on('end', () => resolve({ bytes, error: null }));
  });
  return {
    full: await read(dir + '/bytes.bin'),
    window: await read(dir + '/bytes.bin', { start: 2, end: 6 }),
    missing: await read(dir + '/missing'),
    throughFile: await read(dir + '/bytes.bin/child'),
    directory: await read(dir),
  };
}`;

test('toolchain createReadStream sees sync-written bytes while native OPFS persistence is held', async ({
  page,
  browser,
}) => {
  test.setTimeout(90_000);
  const oracle = JSON.parse(
    execFileSync(
      process.execPath,
      [
        '-e',
        `const fs = require('node:fs');
        const dir = fs.mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'rifty-stream-'));
        fs.writeFileSync(dir + '/bytes.bin', Buffer.from(${JSON.stringify(payload)}));
        (${probe})(fs, dir).then(result => console.log(JSON.stringify({ version: process.version, result })))
          .finally(() => fs.rmSync(dir, { recursive: true, force: true }));`,
      ],
      { encoding: 'utf8' },
    ),
  ) as { version: string; result: unknown };

  await page.goto('/no-coi-harness.html');
  const result = await page.evaluate(
    async ({ root, payload, probe, nativeReplicaProbeSource }) => {
      const { createSandbox } = await import(`/@fs${root}/packages/rifty/src/index.ts`);
      const sandbox = await createSandbox({
        requireCrossOriginIsolation: false,
        skipServiceWorker: true,
        toolchain: {
          workerUrl: `/@fs${root}/packages/workbench/src/workers/no-coi-toolchain-worker.ts`,
        },
      });
      try {
        while (!sandbox.runtime.isReady()) await new Promise((resolve) => setTimeout(resolve, 10));
        await sandbox.fs.writeFile('/stream-visibility/bytes.bin', 'old durable bytes');
        const output: string[] = [];
        const off = sandbox.runtime.on((event: { type: string; chunk?: string }) => {
          if (event.type === 'stdout' && event.chunk) output.push(event.chunk);
        });
        const evaluated = await sandbox.runtime.eval(`(async () => {
          const fs = require('node:fs');
          const dir = '/stream-visibility';
          const opfs = await navigator.storage.getDirectory();
          ${nativeReplicaProbeSource}
          const nativeBytes = async () => Array.from((await nativeReplicaEntries(opfs)).get('/stream-visibility/bytes.bin').bytes);
          let release;
          let entered;
          let held = false;
          const gate = new Promise(resolve => { release = resolve; });
          const pending = new Promise(resolve => { entered = resolve; });
          const restoreNative = observeNativeReplicaWrites(async records => {
            if (records.some(record => record.path === '/stream-visibility/bytes.bin' && record.kind === 'file')) {
              held = true;
              entered();
              await gate;
              held = false;
            }
          });
          try {
            fs.writeFileSync(dir + '/bytes.bin', Buffer.from(${JSON.stringify(payload)}));
            await pending;
            const nativeBefore = await nativeBytes();
            const streams = await (${probe})(fs, dir);
            const heldDuringStreams = held;
            const nativeAfterStreams = await nativeBytes();
            release();
            console.log(JSON.stringify({ streams, heldDuringStreams, nativeBefore, nativeAfterStreams }));
          } finally {
            release();
            restoreNative();
          }
        })()`);
        off();
        if (!evaluated.ok) throw new Error(`stream probe failed: ${JSON.stringify(evaluated)}`);
        // runtime.eval resolves after its real OPFS flush; do not race getFile
        // snapshots against the in-flight native replacement on Linux.
        const { nativeReplicaEntries } = await import(
          `/@fs${root}/tests/browser-unit/fixtures/native-replica-observer.ts`
        );
        const persisted = Array.from(
          (await nativeReplicaEntries(await navigator.storage.getDirectory())).get(
            '/stream-visibility/bytes.bin',
          ).bytes,
        );
        return { coi: crossOriginIsolated, ...JSON.parse(output.join('').trim()), persisted };
      } finally {
        sandbox.dispose();
      }
    },
    { root, payload, probe, nativeReplicaProbeSource },
  );
  expect(result.coi).toBe(false);
  expect(result.heldDuringStreams).toBe(true);
  expect(result.nativeBefore).toEqual([...Buffer.from('old durable bytes')]);
  expect(result.nativeAfterStreams).toEqual(result.nativeBefore);
  expect(result.streams).toEqual(oracle.result);
  expect(result.streams.full).toEqual({ bytes: payload, error: null });
  expect(result.streams.window).toEqual({ bytes: payload.slice(2, 7), error: null });
  expect(result.persisted).toEqual(payload);
  console.log(
    `[stream-visibility] Node/${oracle.version} Chrome/${browser.version()} ${JSON.stringify(result)}`,
  );
});
