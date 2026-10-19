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
    const write = writable._write;
    writable._write = function (chunk, encoding, callback): void {
      reference.ref();
      try {
        write.call(this, chunk, encoding, (error) => {
          reference.unref();
          callback(error);
        });
      } catch (error) {
        reference.unref();
        throw error;
      }
    };
  }
  const dispose = () => WorkerReference.dispose(reference);
  stream.once('close', dispose);
  stream.once(input ? 'finish' : 'end', dispose);
  return reference;
}
