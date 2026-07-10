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
  it('uses kernel control for typed frames instead of public process.send JSON', async () => {
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
      capabilities: { stdin: 'unavailable', runtimeIpc: false },
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

    const control = installRuntimeGlobals();
    control.send?.({ bytes: new Uint8Array([1, 2, 3]) });

    await expect(received).resolves.toEqual({
      kind: 'control:message',
      payload: { bytes: new Uint8Array([1, 2, 3]) },
    });
    expect(publicSendCalls).toBe(0);
  });

  it('receives raw control without requiring the public process message surface', async () => {
    const stdout = new MessageChannel();
    const stderr = new MessageChannel();
    const stdin = new MessageChannel();
    const ipc = new MessageChannel();
    publishKernelProcessSpec({
      pid: 3,
      ppid: 1,
      argv: ['rifty', 'control-only'],
      env: {},
      cwd: '/scratch',
      capabilities: { stdin: 'unavailable', runtimeIpc: false },
      stdio: {
        stdout: stdout.port1,
        stderr: stderr.port1,
        stdin: stdin.port1,
        ipc: ipc.port1,
      },
    });
    Object.defineProperty(globalThis, 'process', {
      value: {},
      writable: true,
      configurable: true,
    });

    const control = installRuntimeGlobals();
    const received = new Promise<unknown>((resolve) => control.onMessage?.(resolve));
    ipc.port2.postMessage({ kind: 'control:message', payload: { ready: true } });

    await expect(received).resolves.toEqual({ ready: true });
  });
});
