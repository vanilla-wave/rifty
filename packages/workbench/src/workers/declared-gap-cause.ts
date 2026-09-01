import { NotImplementedError } from '@riftydev/io';

/** Preserve a named product gap hidden by a dependency's bounded error wrapper. */
export function declaredGapCause(error: unknown): NotImplementedError | null {
  let current = error;
  for (let links = 0; links <= 8 && current instanceof Error; links += 1) {
    if (current instanceof NotImplementedError) return current;
    current = current.cause;
  }
  return null;
}
