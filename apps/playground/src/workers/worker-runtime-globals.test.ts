import { KERNEL_PROCESS_SPEC_KEY, publishKernelProcessSpec } from '@riftydev/kernel';
import { afterEach, describe, expect, it } from 'vitest';
import { installRuntimeGlobals } from './worker-runtime-globals.ts';

const originalProcess = (globalThis as { process?: unknown }).process;
const originalSpec = Object.getOwnPropertyDescriptor(globalThis, KERNEL_PROCESS_SPEC_KEY);

afterEach(() => {
  Object.defineProperty(globalThis, 'process', {
    value: originalProcess,
    writable: true,
    configurable: true,
  });
  if (originalSpec) Object.defineProperty(globalThis, KERNEL_PROCESS_SPEC_KEY, originalSpec);
  else Reflect.deleteProperty(globalThis, KERNEL_PROCESS_SPEC_KEY);
});

describe('installRuntimeGlobals', () => {
  it('uses raw kernel IPC for typed control frames instead of public process.send JSON', async () => {
    const stdout = new MessageChannel();
    const stderr = new MessageChannel();
    const stdin = new MessageChannel();
    const ipc = new MessageChannel();
    publishKernelProcessSpec({
      pid: 2,
      ppid: 1,
      argv: ['rifty', 'owner'],
      env: {},
      cwd: '/scratch',
      stdio: {
        stdout: stdout.port1,
        stderr: stderr.port1,
        stdin: stdin.port1,
        ipc: ipc.port1,
      },
    });
    let publicSendCalls = 0;
    Object.defineProperty(globalThis, 'process', {
      value: {
        send() {
          publicSendCalls++;
          return true;
        },
      },
      writable: true,
      configurable: true,
    });
    const received = new Promise<unknown>((resolve) => {
      ipc.port2.onmessage = (event) => resolve(event.data);
      ipc.port2.start();
    });

    installRuntimeGlobals().send?.({ bytes: new Uint8Array([1, 2, 3]) });

    await expect(received).resolves.toEqual({
      kind: 'ipc:message',
      payload: { bytes: new Uint8Array([1, 2, 3]) },
    });
    expect(publicSendCalls).toBe(0);
  });
});
