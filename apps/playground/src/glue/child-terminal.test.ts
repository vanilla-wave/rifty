import { describe, expect, it, vi } from 'vitest';
import { bindChildTerminalResize, childTerminalBootstrap } from './child-terminal.ts';

describe('child terminal contract', () => {
  it('shapes node-entry TTY metadata without env strings', () => {
    expect(childTerminalBootstrap({ isTTY: true, cols: 120, rows: 40 })).toEqual({
      stdinIsTTY: false,
      stdoutIsTTY: true,
      stderrIsTTY: true,
      cols: 120,
      rows: 40,
    });
  });

  it('forwards current and live size, then unsubscribes exactly once', () => {
    const resize = vi.fn(() => true);
    const unsubscribe = vi.fn();
    let listener: ((size: { cols: number; rows: number }) => void) | undefined;
    const onError = vi.fn();
    const cleanup = bindChildTerminalResize(
      { resize },
      {
        isTTY: true,
        terminal: {
          current: () => ({ cols: 80, rows: 24 }),
          subscribe(next) {
            listener = next;
            return unsubscribe;
          },
        },
      },
      () => true,
      onError,
    );

    expect(resize).toHaveBeenCalledWith(80, 24);
    listener?.({ cols: 120, rows: 40 });
    expect(resize).toHaveBeenLastCalledWith(120, 40);
    cleanup();
    cleanup();
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(onError).not.toHaveBeenCalled();
  });

  it('rethrows a live control fault to the resize caller after reporting lifecycle failure', () => {
    const resize = vi.fn(() => true);
    let listener: ((size: { cols: number; rows: number }) => void) | undefined;
    const onError = vi.fn();
    bindChildTerminalResize(
      { resize },
      {
        isTTY: true,
        terminal: {
          current: () => ({ cols: 80, rows: 24 }),
          subscribe(next) {
            listener = next;
            return () => {};
          },
        },
      },
      () => true,
      onError,
    );
    resize.mockReturnValue(false);

    expect(() => listener?.({ cols: 120, rows: 40 })).toThrow(
      'foreground child resize control is closed',
    );
    expect(onError).toHaveBeenCalledOnce();
    expect(() => listener?.({ cols: 140, rows: 50 })).not.toThrow();
    expect(resize).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['closed control', (): boolean => false, 'foreground child resize control is closed'],
    [
      'thrown control',
      (): never => {
        throw new Error('resize transport failed');
      },
      'resize transport failed',
    ],
  ] as const)('reports a %s and does not subscribe', (_case, resize, message) => {
    const subscribe = vi.fn(() => () => {});
    const onError = vi.fn();

    bindChildTerminalResize(
      { resize },
      {
        isTTY: true,
        terminal: { current: () => ({ cols: 80, rows: 24 }), subscribe },
      },
      () => true,
      onError,
    );

    expect(onError).toHaveBeenCalledOnce();
    expect(onError.mock.calls[0]?.[0]).toMatchObject({ message });
    expect(subscribe).not.toHaveBeenCalled();
  });

  it('reports current/subscribe faults and never binds a non-TTY context', () => {
    const currentFault = new Error('current failed');
    const currentError = vi.fn();
    const currentSubscribe = vi.fn(() => () => {});
    bindChildTerminalResize(
      { resize: vi.fn(() => true) },
      {
        isTTY: true,
        terminal: {
          current: () => {
            throw currentFault;
          },
          subscribe: currentSubscribe,
        },
      },
      () => true,
      currentError,
    );
    expect(currentError).toHaveBeenCalledWith(currentFault);
    expect(currentSubscribe).not.toHaveBeenCalled();

    const subscribeFault = new Error('subscribe failed');
    const subscribeError = vi.fn();
    bindChildTerminalResize(
      { resize: vi.fn(() => true) },
      {
        isTTY: true,
        terminal: {
          current: () => ({ cols: 80, rows: 24 }),
          subscribe: () => {
            throw subscribeFault;
          },
        },
      },
      () => true,
      subscribeError,
    );
    expect(subscribeError).toHaveBeenCalledWith(subscribeFault);

    const nonTtyCurrent = vi.fn(() => ({ cols: 80, rows: 24 }));
    const cleanup = bindChildTerminalResize(
      { resize: vi.fn(() => true) },
      {
        terminal: { current: nonTtyCurrent, subscribe: () => () => {} },
      },
      () => true,
      vi.fn(),
    );
    cleanup();
    cleanup();
    expect(nonTtyCurrent).not.toHaveBeenCalled();
  });
});
