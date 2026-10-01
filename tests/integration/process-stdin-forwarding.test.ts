import { createHostMessageChannel } from '@riftydev/io';
import { expect, it } from 'vitest';
import {
  bindWorkerStdioOutput,
  createWorkerOutputState,
} from '../../packages/kernel/src/worker-stdio-drain.ts';
import { NodeProcess } from '../../packages/runtime-js/src/builtins/process.ts';
import {
  activeRefs,
  resetKeepalive,
} from '../../packages/runtime-js/src/internal/event-loop-keepalive.ts';

it('forwarded fd input leaves guest stdin flow/ref ownership intact', async () => {
  const channels = Array.from({ length: 4 }, () => createHostMessageChannel());
  const outputState = createWorkerOutputState();
  const proc = new NodeProcess({
    pid: 12,
    ppid: 1,
    argv: ['rifty', '/entry.cjs'],
    cwd: '/',
    env: {},
    stdio: {
      stdin: channels[0]!.port1,
      stdout: bindWorkerStdioOutput(channels[1]!.port1, outputState, 'stdout', channels[3]!.port1),
      stderr: bindWorkerStdioOutput(channels[2]!.port1, outputState, 'stderr', channels[3]!.port1),
      ipc: channels[3]!.port1,
    },
  });
  try {
    const forward = Reflect.get(proc.stdin, Symbol.for('rifty.runtime-js.stdin-forwarder.v1')) as
      | ((data: (chunk: unknown) => void, end: () => void) => () => void)
      | undefined;
    expect(typeof forward).toBe('function');
    const input: unknown[] = [];
    const delivered = new Promise<void>((resolve) => {
      const release = forward!(
        (chunk) => {
          input.push(chunk);
          release();
          resolve();
        },
        () => {},
      );
    });
    expect(activeRefs()).toBe(0);
    expect(proc.stdin.listenerCount('data')).toBe(0);
    channels[0]!.port2.postMessage('forwarded');
    await delivered;
    expect(input).toEqual(['forwarded']);
    expect(activeRefs()).toBe(0);
    proc.stdin.on('data', () => {});
    expect(activeRefs()).toBe(1);
    proc.stdin.pause();
    expect(activeRefs()).toBe(0);
  } finally {
    for (const channel of channels) {
      channel.port1.close();
      channel.port2.close();
    }
    resetKeepalive();
  }
});
