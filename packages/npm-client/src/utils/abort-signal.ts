/** Shared install-abort helpers (extracted from installer.ts, move-only). */

export function abortReason(signal: AbortSignal, label: string): Error {
  return signal.reason instanceof Error ? signal.reason : new Error(`${label}: aborted`);
}

export function throwIfAborted(signal: AbortSignal | undefined, label = 'npm install'): void {
  if (signal?.aborted) throw abortReason(signal, label);
}

export async function awaitWithSignal<T>(
  operation: Promise<T>,
  signal: AbortSignal | undefined,
  label: string,
): Promise<T> {
  if (!signal) return await operation;
  throwIfAborted(signal, label);
  operation.catch(() => {}); // abort can win while the independently owned prefetch settles later
  let onAbort: (() => void) | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        onAbort = () => reject(abortReason(signal, label));
        signal.addEventListener('abort', onAbort, { once: true });
      }),
    ]);
  } finally {
    if (onAbort) signal.removeEventListener('abort', onAbort);
  }
}
