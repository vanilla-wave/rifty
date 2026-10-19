import type { Readable, Writable } from '@riftydev/io';
import { WorkerReference } from './worker-reference.ts';

/** Read handles retain the loop; an idle write-only pipe has no active I/O. */
export function referenceChildPipe(stream: Readable | Writable, input: boolean): WorkerReference {
  const reference = new WorkerReference();
  if (!input) reference.ref();
  Object.assign(stream, {
    ref() {
      if (!input) reference.ref();
      return stream;
    },
    unref() {
      // A pending write request retains independently of the pipe's ref flag.
      if (!input) reference.unref();
      return stream;
    },
  });
  if (input) {
    const writable = stream as Writable;
    const write = writable.write;
    writable.write = function (chunk, encodingOrCallback, callback): boolean {
      // One request retains until its callback, including queued writes. The
      // constructor's options.write can bypass the public _write hook.
      const request = new WorkerReference();
      request.ref();
      const cb = typeof encodingOrCallback === 'function' ? encodingOrCallback : callback;
      try {
        return write.call(
          this,
          chunk,
          typeof encodingOrCallback === 'string' ? encodingOrCallback : undefined,
          (error) => {
            try {
              cb?.(error ?? null);
            } finally {
              WorkerReference.dispose(request);
            }
          },
        );
      } catch (error) {
        WorkerReference.dispose(request);
        throw error;
      }
    };
  }
  const dispose = () => WorkerReference.dispose(reference);
  stream.once('close', dispose);
  stream.once(input ? 'finish' : 'end', dispose);
  return reference;
}
