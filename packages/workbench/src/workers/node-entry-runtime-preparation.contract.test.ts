import {
  type KernelEntryCapabilityPorts,
  type WorkerSpawnSpec,
  consumeKernelEntryCapabilityPorts,
} from '@riftydev/kernel';
import { runEntryLifecycle } from '@riftydev/kernel/worker-entry';
import { MemoryFsSync } from '@riftydev/vfs/internal';
import { afterEach, describe, expect, it } from 'vitest';
import { prepareNodeEntryRuntime } from './node-entry-runtime-preparation.ts';

const previousRuntimeRoot = Object.getOwnPropertyDescriptor(globalThis, '__rifty');

afterEach(() => {
  for (const port of Object.values(consumeKernelEntryCapabilityPorts())) port.close();
  if (previousRuntimeRoot === undefined) Reflect.deleteProperty(globalThis, '__rifty');
  else Object.defineProperty(globalThis, '__rifty', previousRuntimeRoot);
});

async function runKernelUrlEntry(
  capabilityPorts: KernelEntryCapabilityPorts,
  runEntry: () => Promise<void>,
): Promise<void> {
  const stdout = new MessageChannel();
  const stderr = new MessageChannel();
  const stdin = new MessageChannel();
  const ipc = new MessageChannel();
  const channels = [stdout, stderr, stdin, ipc];
  const spec = {
    entry: { kind: 'url', url: 'fixture:node-entry', capabilityPorts },
    argv: ['rifty', '/workspace/direct.cjs'],
    env: {},
    cwd: '/workspace',
    stdio: {
      stdout: stdout.port2,
      stderr: stderr.port2,
      stdin: stdin.port2,
      ipc: ipc.port2,
    },
    syncRing: new SharedArrayBuffer(8),
    pid: 2,
    ppid: 1,
  } as unknown as WorkerSpawnSpec;
  let failure: unknown;
  try {
    await runEntryLifecycle(spec, {
      preEntryHook: null,
      drainHook: null,
      async runEntry() {
        try {
          await runEntry();
        } catch (error) {
          failure = error;
          throw error;
        }
      },
      writeStderr() {},
    });
  } finally {
    for (const channel of channels) {
      channel.port1.close();
      channel.port2.close();
    }
  }
  if (failure !== undefined) throw failure;
}

describe('node-entry runtime preparation', () => {
  it('rejects unknown entry capabilities before guest import and consumes ambient authority', async () => {
    const channel = new MessageChannel();
    await expect(
      runKernelUrlEntry({ 'forged.capability/v1': channel.port2 }, () =>
        prepareNodeEntryRuntime({
          bin: false,
          args: [],
          entryPath: '/workspace/direct.cjs',
          root: '/workspace',
          fs: new MemoryFsSync(),
        }),
      ),
    ).rejects.toThrow('unsupported Workbench entry capabilities');

    expect(Object.keys(consumeKernelEntryCapabilityPorts())).toEqual([]);
    channel.port1.close();
  });
});
