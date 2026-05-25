/**
 * Node-compatible `node:stream.pipeline` / `finished` — owned by `@rifty/io`
 * per ADR-0012.
 *
 * `pipeline(a, b, c, cb?)` chains readables/writables with error propagation;
 * resolves once the last stream emits `finish`/`end`.
 *
 * `finished(stream, cb?)` resolves when the stream completes for any reason
 * (`end`/`finish`/`close`/`error`).
 */

import type { EventEmitter } from '../event-emitter.ts';
import type { Readable } from './readable.ts';
import type { Writable } from './writable.ts';

export function pipeline(...streams: unknown[]): Promise<void> {
  const cb =
    typeof streams[streams.length - 1] === 'function'
      ? (streams.pop() as (err?: Error | null) => void)
      : undefined;
  const chain = streams as (Readable | Writable)[];
  return new Promise((resolve, reject) => {
    let errored = false;
    const onError = (err: unknown): void => {
      if (errored) return;
      errored = true;
      cb?.(err as Error);
      reject(err);
    };
    for (let i = 0; i < chain.length - 1; i++) {
      const src = chain[i];
      const dst = chain[i + 1] as Writable;
      if (src && 'pipe' in src && typeof (src as Readable).pipe === 'function') {
        (src as Readable).pipe(dst);
      }
      (src as EventEmitter | undefined)?.on?.('error', onError);
    }
    const last = chain[chain.length - 1] as EventEmitter | undefined;
    last?.on?.('error', onError);
    last?.on?.('finish', () => {
      if (!errored) {
        cb?.(null);
        resolve();
      }
    });
    last?.on?.('end', () => {
      if (!errored) {
        cb?.(null);
        resolve();
      }
    });
  });
}

export function finished(stream: EventEmitter, cb?: (err?: Error | null) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (err?: Error | null): void => {
      if (done) return;
      done = true;
      if (err) {
        cb?.(err);
        reject(err);
      } else {
        cb?.(null);
        resolve();
      }
    };
    stream.on('end', () => finish());
    stream.on('finish', () => finish());
    stream.on('close', () => finish());
    stream.on('error', (e) => finish(e as Error));
  });
}
