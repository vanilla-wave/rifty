import type { EventEmitter } from '../event-emitter.ts';

/** Minimal pipe destination shape (readable.ts keeps its one-way dep). */
export interface PipeableWritable extends EventEmitter {
  write(chunk: unknown): boolean | Promise<boolean>;
  end(): unknown;
}

/**
 * Node's `pipe` never ends the process's own stdio — the process owns their
 * lifetime. Recognition is by IDENTITY via registration (the process builtin
 * registers its stdio writers here), not by duck-typing: an ordinary
 * Writable that happens to carry `fd: 1|2` still gets `end()` in Node.
 */
const PROCESS_STDIO_STREAMS = new WeakSet<object>();

/** The process builtin registers its stdout/stderr writers (identity seam). */
export function registerProcessStdioStream(stream: object): void {
  PROCESS_STDIO_STREAMS.add(stream);
}

export function isProcessStdioDest(dest: PipeableWritable): boolean {
  return PROCESS_STDIO_STREAMS.has(dest);
}
