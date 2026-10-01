import { afterEach, describe, expect, it } from 'vitest';
import {
  installUnhandledErrorTrap,
  installUnhandledRejectionTrap,
  resetKeepalive,
} from '../internal/event-loop-keepalive.ts';
import {
  readActiveNodeProcessBootstrap,
  setActiveNodeProcessBootstrap,
} from './process-bootstrap-identity.ts';
import { NodeProcess } from './process.ts';

const original = readActiveNodeProcessBootstrap();
afterEach(() => {
  setActiveNodeProcessBootstrap(original?.process ?? null, original?.federated ?? false);
  resetKeepalive();
});

describe('process lifecycle', () => {
  it('exit() inherits exitCode and emits exit once', () => {
    const proc = new NodeProcess();
    const codes: unknown[] = [];
    proc.once('exit', (code) => codes.push(code));
    proc.exitCode = 7;
    expect(() => proc.exit()).toThrow(expect.objectContaining({ exitCode: 7 }));
    expect(codes).toEqual([7]);
  });

  it.each(['error', 'unhandledrejection'])(
    'dispatches handled %s to the active process',
    (type) => {
      const proc = new NodeProcess();
      setActiveNodeProcessBootstrap(proc);
      const target = new EventTarget();
      if (type === 'error')
        installUnhandledErrorTrap(
          target as unknown as Parameters<typeof installUnhandledErrorTrap>[0],
        );
      else
        installUnhandledRejectionTrap(
          target as unknown as Parameters<typeof installUnhandledRejectionTrap>[0],
        );
      const errors: unknown[] = [];
      proc.on(type === 'error' ? 'uncaughtException' : 'unhandledRejection', (error) =>
        errors.push(error),
      );
      const reason = new Error('boom');
      const event = Object.assign(
        new Event(type, { cancelable: true }),
        type === 'error' ? { error: reason } : { reason, promise: Promise.resolve() },
      );
      target.dispatchEvent(event);
      expect(errors).toEqual([reason]);
      expect(event.defaultPrevented).toBe(true);
    },
  );
});
