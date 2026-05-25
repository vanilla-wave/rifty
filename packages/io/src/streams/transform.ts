/**
 * Node-compatible `node:stream.Transform` — owned by `@rifty/io` per ADR-0012.
 *
 * Wires the writable side's `write` to call `_transform`; the transform's
 * callback `cb(null, value)` pushes the value to the readable side. On `end`,
 * `_flush` runs first (if provided) before `push(null)` ends the readable.
 */

import { Duplex } from './duplex.ts';
import type { ReadableOptions } from './readable.ts';
import type { WritableOptions } from './writable.ts';

export interface TransformOptions extends ReadableOptions, WritableOptions {
  transform?(
    this: Transform,
    chunk: unknown,
    encoding: string,
    cb: (err?: Error | null, value?: unknown) => void,
  ): void;
  flush?(this: Transform, cb: (err?: Error | null) => void): void;
}

export class Transform extends Duplex {
  private transformImpl?: TransformOptions['transform'];
  private flushImpl?: TransformOptions['flush'];

  constructor(opts: TransformOptions = {}) {
    super(opts);
    this.transformImpl = opts.transform;
    this.flushImpl = opts.flush;
    // Wire writable side to call _transform.
    const origWrite = this.writableSide.write.bind(this.writableSide);
    this.write = (chunk, encoding, cb) => {
      const encStr = typeof encoding === 'string' ? encoding : 'utf8';
      const cbFinal = (typeof encoding === 'function' ? encoding : cb) ?? (() => {});
      if (this.transformImpl) {
        this.transformImpl.call(this, chunk, encStr, (err, value) => {
          if (err) {
            cbFinal(err);
            return;
          }
          if (value !== undefined && value !== null) this.push(value);
          cbFinal();
        });
        return origWrite(chunk, encStr, () => {});
      }
      // Default identity transform.
      this.push(chunk);
      cbFinal();
      return origWrite(chunk, encStr, () => {});
    };
    this.end = (...args: unknown[]) => {
      // Flush any pending data, then push null to end the readable side.
      const finalize = (): void => {
        this.push(null);
      };
      if (this.flushImpl)
        this.flushImpl.call(this, (err) => {
          if (err) this.emit('error', err);
          else finalize();
        });
      else finalize();
      this.writableSide.end(args[0], args[1] as string, args[2] as () => void);
      return this;
    };
  }
}
