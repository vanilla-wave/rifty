/**
 * A Worker child that inherits stdin (fork's default stdio) reads the parent's
 * input the way Node's shared fd does: the parent's own stdin stays unread and
 * does not hold the parent, before or after the child closes. Node v24.16.0
 * oracle: evidence §Inherited stdin.
 */
import { EventEmitter, Readable } from '@riftydev/io';
import type { KernelProcessSpec } from '@riftydev/kernel';
import { afterEach, describe, expect, it } from 'vitest';
import { activeRefs, resetKeepalive } from '../internal/event-loop-keepalive.ts';
import { installNodeProcessShim } from '../ipc/install-process.ts';
import {
  activeProcessStdio,
  forwardWorkerStdio,
  resolveWorkerStdio,
} from './child_process-worker.ts';
import { setActiveNodeProcessBootstrap } from './process-bootstrap-identity.ts';

const originalProcess = (globalThis as { process?: unknown }).process;

afterEach(() => {
  resetKeepalive();
  setActiveNodeProcessBootstrap(null);
  Object.defineProperty(globalThis, 'process', {
    value: originalProcess,
    writable: true,
    configurable: true,
  });
});

function spec(stdin: MessagePort): KernelProcessSpec {
  const sink = new MessageChannel();
  return {
    pid: 2,
    ppid: 1,
    argv: ['node', '/main.cjs'],
    env: {},
    cwd: '/workspace',
    stdio: {
      stdout: { write: (bytes) => sink.port1.postMessage(bytes) },
      stderr: { write: (bytes) => sink.port1.postMessage(bytes) },
      stdin,
      ipc: new MessageChannel().port1,
    },
  };
}

/** The Worker child's side of `forwardWorkerStdio`: its stdin and its close. */
function workerChild(): {
  handle: Parameters<typeof forwardWorkerStdio>[0] & Pick<EventEmitter, 'emit'>;
  stdin: unknown[];
} {
  const stdin: unknown[] = [];
  const handle = Object.assign(new EventEmitter(), {
    stdout: () => new Readable({ read() {} }),
    stderr: () => new Readable({ read() {} }),
    stdin: () => ({ write: (chunk: unknown) => stdin.push(String(chunk)), end: () => {} }),
  });
  return { handle, stdin };
}

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 10));

describe('fork child inheriting stdin', () => {
  it('reads the parent input without holding the parent, before or after its close', async () => {
    const terminal = new MessageChannel();
    const parent = installNodeProcessShim(spec(terminal.port1));
    const child = workerChild();
    forwardWorkerStdio(
      child.handle,
      resolveWorkerStdio(undefined, activeProcessStdio(), true, false),
    );

    terminal.port2.postMessage('typed');
    await tick();
    expect(child.stdin).toEqual(['typed']);
    expect(activeRefs()).toBe(0);

    child.handle.emit('close', 0, null);
    terminal.port2.postMessage('after-close');
    await tick();
    expect(child.stdin).toEqual(['typed']);
    expect(activeRefs()).toBe(0);

    // Unread input waits for the parent's own reader, as in the fd.
    const later = new Promise((resolve) => parent.stdin.once('data', resolve));
    expect(String(await later)).toBe('after-close');
  });
});
