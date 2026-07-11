export function errorFrom(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

export function errorsFrom(error: unknown): Error[] {
  if (error instanceof AggregateError) {
    return [...error.errors].flatMap((entry) => errorsFrom(entry));
  }
  return [errorFrom(error)];
}

export function reportErrorSafely(error: unknown): void {
  const failure = errorFrom(error);
  const reporter = (globalThis as { readonly reportError?: (error: unknown) => void }).reportError;
  if (typeof reporter === 'function') {
    try {
      reporter.call(globalThis, failure);
      return;
    } catch {
      // A hostile reporter must not regain control of the publisher boundary.
    }
  }
  try {
    globalThis.console?.error('[workbench] host callback failed', failure);
  } catch {
    // Reporting is best-effort; state transitions and teardown stay authoritative.
  }
}

export function invokeHostCallback<Args extends unknown[]>(
  callback: (...args: Args) => void,
  ...args: Args
): void {
  try {
    callback(...args);
  } catch (error) {
    reportErrorSafely(error);
  }
}

/** Synchronous observer delivery where one host callback cannot block siblings. */
export function notifySubscribers<State>(
  listeners: Iterable<(snapshot: State) => void>,
  snapshot: State,
): void {
  for (const listener of [...listeners]) {
    invokeHostCallback(listener, snapshot);
  }
}

/** Attempt every synchronous cleanup step, then surface the complete failure set. */
export function runCleanupSteps(steps: Iterable<() => void>, message: string): void {
  const errors = collectCleanupErrors(steps);
  if (errors.length > 0) {
    throw new AggregateError(
      errors,
      `${message}: ${errors.map((error) => error.message).join('; ')}`,
    );
  }
}

export function collectCleanupErrors(steps: Iterable<() => void>): Error[] {
  const errors: Error[] = [];
  for (const step of steps) {
    try {
      step();
    } catch (error) {
      errors.push(...errorsFrom(error));
    }
  }
  return errors;
}
