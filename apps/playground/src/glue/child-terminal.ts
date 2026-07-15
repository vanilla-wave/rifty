interface ChildTerminalSize {
  readonly cols: number;
  readonly rows: number;
}

export interface ChildTerminalContext {
  readonly isTTY?: boolean;
  readonly cols?: number;
  readonly rows?: number;
  readonly terminal?: {
    current(): ChildTerminalSize;
    subscribe(listener: (size: ChildTerminalSize) => void): () => void;
  };
}

interface ChildTerminalHandle {
  resize(cols: number, rows: number): unknown;
}

export function childTerminalEnv(ctx: ChildTerminalContext) {
  const isTTY = ctx.isTTY === true ? '1' : '0';
  return {
    RIFTY_STDIN_IS_TTY: '0',
    RIFTY_STDOUT_IS_TTY: isTTY,
    RIFTY_STDERR_IS_TTY: isTTY,
    RIFTY_TTY_COLS: String(ctx.cols ?? 80),
    RIFTY_TTY_ROWS: String(ctx.rows ?? 24),
  };
}

export function bindChildTerminalResize(
  handle: ChildTerminalHandle,
  ctx: ChildTerminalContext,
  isActive: () => boolean,
  onError: (error: unknown) => void,
): () => void {
  let closed = false;
  let failed = false;
  let unsubscribe: (() => void) | undefined;
  const cleanup = (): void => {
    if (closed) return;
    closed = true;
    const stop = unsubscribe;
    unsubscribe = undefined;
    stop?.();
  };
  const fail = (error: unknown): void => {
    if (closed || failed || !isActive()) return;
    failed = true;
    onError(error);
  };
  const forward = (size: ChildTerminalSize, propagate: boolean): void => {
    if (closed || failed || !isActive()) return;
    try {
      if (handle.resize(size.cols, size.rows) === false) {
        throw new Error('foreground child resize control is closed');
      }
    } catch (error) {
      fail(error);
      // A live resize originates in PtySessionActor.resize(). Re-throw through
      // the synchronous terminal source so that operation can return a negative
      // owner ACK; lifecycle teardown still proceeds through onError.
      if (propagate) throw error;
    }
  };

  if (!isActive() || ctx.isTTY !== true || !ctx.terminal) return cleanup;
  try {
    forward(ctx.terminal.current(), false);
    if (failed || !isActive()) return cleanup;
    unsubscribe = ctx.terminal.subscribe((size) => forward(size, true));
    if (!isActive()) cleanup();
  } catch (error) {
    fail(error);
  }
  return cleanup;
}
