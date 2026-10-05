import type { EventEmitter } from '../event-emitter.ts';

/** Minimal pipe destination shape (readable.ts keeps its one-way dep). */
export interface PipeableWritable extends EventEmitter {
  write(chunk: unknown): boolean | Promise<boolean>;
  end(): unknown;
}

/**
 * Guest `process.stdout`/`process.stderr` writer shape: fd 1/2 + write. Node's
 * `pipe` never ends the process's own stdio (the process owns their lifetime);
 * recognizing the shape here keeps the io layer free of a process-builtin
 * import (one-way layering). No other rifty writer carries `fd: 1|2`.
 */
export function isProcessStdioDest(dest: PipeableWritable): boolean {
  const fd = (dest as unknown as { fd?: unknown }).fd;
  return (fd === 1 || fd === 2) && typeof dest.write === 'function';
}
