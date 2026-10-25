import { type KernelProcessSpec, publishKernelEntryBootstrap } from '@riftydev/kernel';
import { afterEach, describe, expect, it } from 'vitest';
import { NODE_ENTRY_BOOTSTRAP_PROTOCOL } from '../builtins/node-entry-runtime-config.ts';
import { activeRefs, resetKeepalive } from '../internal/event-loop-keepalive.ts';
import { installNodeProcessShim } from './install-process.ts';

// ADR-0448: a fork child's public IPC lane holds the realm while it has a
// 'message' listener in both serializations (Node's channel ref); a
// launch-less URL Worker sharing the physical port never does.

const originalProcess = (globalThis as { process?: unknown }).process;

function spec(ipc: MessagePort): KernelProcessSpec {
  const sink = new MessageChannel();
  return {
    pid: 2,
    ppid: 1,
    argv: ['node', '/entry.js'],
    env: {},
    cwd: '/workspace',
    stdio: {
      stdout: { write: (bytes) => sink.port1.postMessage(bytes) },
      stderr: { write: (bytes) => sink.port1.postMessage(bytes) },
      stdin: new MessageChannel().port1,
      ipc,
    },
  };
}

/** A program launch published the way the parent's node-entry envelope arrives. */
function publishForkLaunch(ipc: string): void {
  publishKernelEntryBootstrap({
    protocol: NODE_ENTRY_BOOTSTRAP_PROTOCOL,
    payload: {
      hostRuntime: { RIFTY_KERNEL_WORKER_URL: 'https://host.test/kernel.js' },
      launch: { kind: 'program', bin: false, remoteFs: true, ipc, nodeServe: true },
    },
  });
}

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 10));

afterEach(() => {
  resetKeepalive();
  publishKernelEntryBootstrap(null);
  Object.defineProperty(globalThis, 'process', {
    value: originalProcess,
    writable: true,
    configurable: true,
  });
});

describe('fork-child IPC keepalive (ADR-0448)', () => {
  it.each(['json', 'advanced'])(
    'holds one ref while a %s fork child listens, released by disconnect',
    async (serialization) => {
      const ipc = new MessageChannel();
      publishForkLaunch(serialization);
      const process = installNodeProcessShim(spec(ipc.port1));
      const listener = (): void => {};

      expect(activeRefs()).toBe(0);
      process.on('message', listener);
      expect(activeRefs()).toBe(1);
      process.off('message', listener);
      expect(activeRefs()).toBe(0);
      process.on('message', listener);
      ipc.port2.postMessage({ kind: 'ipc:disconnect' });
      await tick();

      expect(process.connected).toBe(false);
      expect(activeRefs()).toBe(0);
    },
  );

  it('keeps a launch-less URL Worker public port unheld by its listener', () => {
    const ipc = new MessageChannel();
    const process = installNodeProcessShim(spec(ipc.port1));

    process.on('message', () => {});

    expect(typeof process.send).toBe('function');
    expect(activeRefs()).toBe(0);
  });
});
