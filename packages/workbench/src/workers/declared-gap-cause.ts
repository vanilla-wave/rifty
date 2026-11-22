import { NotImplementedError } from '@riftydev/io';

/** Preserve a named product gap hidden by a dependency's bounded error wrapper. */
export function declaredGapCause(error: unknown): NotImplementedError | null {
  let current = error;
  // A guest value in the chain (a Proxy `cause`) may throw on any read.
  try {
    for (let depth = 0; depth <= 8; depth += 1) {
      if (!(current instanceof Error)) return null;
      if (current instanceof NotImplementedError) return current;
      if (depth === 8) return null;
      current = current.cause;
    }
  } catch {
    return null;
  }
  return null;
}
