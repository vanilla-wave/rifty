import { MemoryFsSync } from '@riftydev/vfs/internal';
import { afterEach, expect, it } from 'vitest';
import { runNodeEntry } from './node-entry.ts';
import {
  readActiveNodeProcessBootstrap,
  setActiveNodeProcessBootstrap,
} from './process-bootstrap-identity.ts';
import { NodeProcess } from './process.ts';

const original = readActiveNodeProcessBootstrap();
const originalProcess = Object.getOwnPropertyDescriptor(globalThis, 'process');
afterEach(() => {
  setActiveNodeProcessBootstrap(original?.process ?? null, original?.federated ?? false);
  if (originalProcess) Object.defineProperty(globalThis, 'process', originalProcess);
  else Reflect.deleteProperty(globalThis, 'process');
});

it.each(['cjs', 'mjs'])(
  'dispatches top-level %s entry errors to the active handler',
  async (extension) => {
    const fs = new MemoryFsSync();
    fs.loadFixture({ [`/entry.${extension}`]: 'throw new Error("entry-boom");' });
    const proc = new NodeProcess();
    setActiveNodeProcessBootstrap(proc);
    const received: unknown[][] = [];
    proc.on('uncaughtException', (error, origin) =>
      received.push([Reflect.get(error as object, 'message'), origin]),
    );
    proc.on('unhandledRejection', () => {
      throw new Error('entry rejection is fatal-exception provenance');
    });

    await expect(
      runNodeEntry({ vfs: fs, cwd: '/', entryPath: `/entry.${extension}` }),
    ).resolves.toBeUndefined();
    expect(received).toEqual([
      ['entry-boom', extension === 'cjs' ? 'uncaughtException' : 'unhandledRejection'],
    ]);
  },
);

it('dispatches a synchronous eval failure to its active process handler', async () => {
  const proc = new NodeProcess();
  setActiveNodeProcessBootstrap(proc);
  Object.defineProperty(globalThis, 'process', { value: proc, configurable: true });
  const errors: unknown[] = [];
  proc.on('uncaughtException', (error) => errors.push(error));
  await expect(
    runNodeEntry({
      kind: 'eval',
      vfs: new MemoryFsSync(),
      cwd: '/',
      source: 'throw new Error("eval-boom");',
      print: false,
      explicitCommonJs: true,
    }),
  ).resolves.toBeUndefined();
  expect(errors).toHaveLength(1);
  expect(errors[0]).toMatchObject({ message: 'eval-boom' });
});
