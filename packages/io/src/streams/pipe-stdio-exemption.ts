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
// Realm-shared registry: production ships SEVERAL io bundle copies (kernel,
// node-entry); a module-level WeakSet would miss cross-bundle registration.
const REGISTRY = Symbol.for('rifty.io.process-stdio-streams.v1');

function registry(): WeakSet<object> {
  const realm = globalThis as { [REGISTRY]?: WeakSet<object> };
  if (realm[REGISTRY] === undefined) {
    Object.defineProperty(globalThis, REGISTRY, {
      value: new WeakSet<object>(),
      enumerable: false,
      configurable: false,
      writable: false,
    });
  }
  return realm[REGISTRY] as WeakSet<object>;
}

/** The process builtin registers its stdout/stderr writers (identity seam). */
export function registerProcessStdioStream(stream: object): void {
  registry().add(stream);
}

export function isProcessStdioDest(dest: PipeableWritable): boolean {
  return registry().has(dest);
}
