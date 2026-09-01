import { NotImplementedError } from '@riftydev/io';

/** Preserve a named product gap hidden by a dependency's bounded error wrapper. */
export function declaredGapCause(error: unknown): NotImplementedError | null {
  let current = error;
  for (let depth = 0; depth <= 8; depth += 1) {
    if (!(current instanceof Error)) return null;
    if (current instanceof NotImplementedError) return current;
    if (depth === 8) return null;
    try {
      current = current.cause;
    } catch {
      return null;
    }
  }
  return null;
}
