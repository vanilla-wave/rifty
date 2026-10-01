import { afterEach, expect, it } from 'vitest';
import { activeRefs, resetKeepalive } from '../internal/event-loop-keepalive.ts';
import { resetSyncMirror } from './fs-sync-mirror.ts';
import { writeFileSync } from './fs.ts';
import { Worker } from './worker_threads.ts';
import '../module-loader/loader.ts';

afterEach(() => {
  resetKeepalive();
  resetSyncMirror();
});

it('accepts explicit empty execArgv', async () => {
  writeFileSync('/empty-argv.cjs', 'parentPort.postMessage("ok");');
  const worker = new Worker('/empty-argv.cjs', { execArgv: [] });
  await worker.terminate();
});

it('references one Worker until terminal; ref/unref are idempotent', async () => {
  writeFileSync(
    '/live.mjs',
    "import { parentPort } from 'node:worker_threads'; parentPort.on('message', () => {});",
  );
  const worker = new Worker('/live.mjs');
  expect(activeRefs()).toBe(1);
  worker.ref();
  expect(activeRefs()).toBe(1);
  worker.unref().unref();
  expect(activeRefs()).toBe(0);
  worker.ref().ref();
  expect(activeRefs()).toBe(1);
  await worker.terminate();
  expect(activeRefs()).toBe(0);
  worker.ref();
  expect(activeRefs()).toBe(0);
});
