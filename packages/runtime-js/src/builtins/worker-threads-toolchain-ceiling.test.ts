import { NotImplementedError } from '@riftydev/io';
import { afterEach, expect, it } from 'vitest';
import { resetSyncMirror } from './fs-sync-mirror.ts';
import { writeFileSync } from './fs.ts';
import { Worker } from './worker_threads.ts';

const realm = Symbol.for('rifty.runtime-js.sandbox-toolchain.v1');
const effect = Symbol.for('rifty.test.toolchain-worker-body');
afterEach(() => {
  Reflect.deleteProperty(globalThis, realm);
  Reflect.deleteProperty(globalThis, effect);
  resetSyncMirror();
});

it.each(['/child.cjs', new URL('file:///child.mjs')])(
  'rejects selected toolchain Worker %s synchronously before child side effects',
  async (entry) => {
    Object.defineProperty(globalThis, realm, { value: true, configurable: true });
    const body = `globalThis[Symbol.for('rifty.test.toolchain-worker-body')] = true;`;
    writeFileSync('/child.cjs', body);
    writeFileSync('/child.mjs', body);
    let caught: unknown;
    let worker: Worker | undefined;
    try {
      worker = new Worker(entry);
      worker.on('error', () => {});
    } catch (error) {
      caught = error;
    }
    await Promise.resolve();
    await worker?.terminate();
    expect(caught).toBeInstanceOf(NotImplementedError);
    expect(caught).toMatchObject({ feature: 'worker_threads.Worker' });
    expect(Reflect.get(globalThis, effect)).toBeUndefined();
  },
);
