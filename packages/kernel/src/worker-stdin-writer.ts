import { Writable } from '@riftydev/io';

export function bindPortAsWritable(
  port: MessagePort,
  input?: { write(bytes: Uint8Array, done: (error?: Error | null) => void): void; end(): void },
): Writable {
  return new Writable({
    write(chunk, _encoding, cb) {
      try {
        if (input) {
          input.write(
            typeof chunk === 'string' ? new TextEncoder().encode(chunk) : (chunk as Uint8Array),
            cb,
          );
          return;
        }
        if (chunk instanceof Uint8Array) {
          port.postMessage(chunk);
        } else if (typeof chunk === 'string') {
          port.postMessage(new TextEncoder().encode(chunk));
        } else {
          // Object-mode payloads pass through verbatim.
          port.postMessage(chunk);
        }
        cb();
      } catch (err) {
        cb(err instanceof Error ? err : new Error(String(err)));
      }
    },
    final(cb) {
      try {
        if (input) {
          input.end();
          cb();
          return;
        }
        port.postMessage({ kind: 'stdin:eof' });
        port.close();
        cb();
      } catch (err) {
        cb(err instanceof Error ? err : new Error(String(err)));
      }
    },
  });
}
