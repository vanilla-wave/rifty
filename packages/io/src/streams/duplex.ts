/**
 * Node-compatible `node:stream.Duplex` — owned by `@rifty/io` per ADR-0012.
 *
 * Composes a Readable (this) with a dedicated Writable inside; the constructor
 * re-exposes `write`/`end` from the writable side on the duplex itself.
 */

import { Readable, type ReadableOptions } from './readable.ts';
import { Writable, type WritableOptions } from './writable.ts';

export class Duplex extends Readable {
  writableSide: Writable;
  constructor(opts: ReadableOptions & WritableOptions = {}) {
    super(opts);
    this.writableSide = new Writable(opts);
    // Re-expose Writable methods on this instance.
    this.write = (chunk, encoding, cb) => this.writableSide.write(chunk, encoding, cb);
    this.end = (...args: unknown[]) => {
      this.writableSide.end(args[0], args[1] as string, args[2] as () => void);
      return this;
    };
  }
  // Augmented at construction time:
  write!: (
    chunk: unknown,
    encoding?: string | ((err?: Error | null) => void),
    cb?: (err?: Error | null) => void,
  ) => boolean;
  end!: (...args: unknown[]) => this;
}
