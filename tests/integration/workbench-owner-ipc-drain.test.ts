import { expect, it } from 'vitest';
import { createHostMessageChannel } from '../../packages/io/src/index.ts';
import {
  bindWorkerStdioOutput,
  createWorkerOutputState,
} from '../../packages/kernel/src/worker-stdio-drain.ts';
import { NodeProcess } from '../../packages/runtime-js/src/builtins/process.ts';
import {
  activeRefs,
  resetKeepalive,
} from '../../packages/runtime-js/src/internal/event-loop-keepalive.ts';
import { installRuntimeGlobals } from '../../packages/workbench/src/workers/worker-runtime-globals.ts';

it('releases the owner control subscription before natural drain', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'process');
  const channels = Array.from({ length: 4 }, () => createHostMessageChannel());
  const output = createWorkerOutputState();
  const proc = new NodeProcess({
    pid: 12,
    ppid: 1,
    argv: ['rifty'],
    cwd: '/',
    env: {},
    stdio: {
      stdin: channels[0]!.port1,
      stdout: bindWorkerStdioOutput(channels[1]!.port1, output, 'stdout', channels[3]!.port1),
      stderr: bindWorkerStdioOutput(channels[2]!.port1, output, 'stderr', channels[3]!.port1),
      ipc: channels[3]!.port1,
    },
  });
  try {
    Object.defineProperty(globalThis, 'process', { value: proc, configurable: true });
    const ipc = installRuntimeGlobals();
    const detach = ipc.onMessage!(() => {});
    expect(activeRefs()).toBe(1);
    expect(typeof detach).toBe('function');
    (detach as unknown as () => void)();
    expect(activeRefs()).toBe(0);
    expect(proc.listenerCount('message')).toBe(0);
  } finally {
    if (original) Object.defineProperty(globalThis, 'process', original);
    else Reflect.deleteProperty(globalThis, 'process');
    for (const channel of channels) {
      channel.port1.close();
      channel.port2.close();
    }
    resetKeepalive();
  }
});
