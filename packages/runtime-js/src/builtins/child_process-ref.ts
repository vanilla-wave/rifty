import type { Readable } from '@riftydev/io';
import { ref, unref } from '../internal/event-loop-keepalive.ts';

export interface RefableChildPipe extends Readable {
  ref(): this;
  unref(): this;
}

/** A child process and each readable pipe are independent Node loop handles. */
export function referenceChildPipe(stream: Readable): { stream: RefableChildPipe; close(): void } {
  let held = true;
  let closed = false;
  ref();
  const pipe = Object.assign(stream, {
    ref() {
      if (!held && !closed) {
        held = true;
        ref();
      }
      return this;
    },
    unref() {
      if (held) {
        held = false;
        unref();
      }
      return this;
    },
  }) as RefableChildPipe;
  const close = (): void => {
    closed = true;
    pipe.unref();
  };
  pipe.once('end', close);
  pipe.once('close', close);
  return { stream: pipe, close };
}
