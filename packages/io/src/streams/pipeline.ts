/**
 * Node-compatible `node:stream.pipeline` / `finished` — owned by `@riftydev/io`
 * per ADR-0012.
 *
 * Node contract (ADR-0034):
 *   - `pipeline(a, b, c, cb?)` wires `a → b → c`, resolves when the last stage
 *     emits `finish` (writable) or `end` (readable).
 *   - Any error in any stage → `destroy(err)` on every OTHER stage, then
 *     cb/reject. Stops a producer from pumping into a dead sink.
 *   - cb and promise resolution fire exactly once.
 *
 * Error absorbers stay attached after the first error: `destroy(err)` on an
 * upstream stage emits `'error'` next tick with no listener → unhandled throw.
 * Mirrors Node's `eos()` holding an error-listener until all streams close.
 */

import type { EventEmitter } from '../event-emitter.ts';
import type { Readable } from './readable.ts';
import type { Writable } from './writable.ts';

/**
 * Duck-shape the pipeline understands: emits `error`/`end`/`finish`, can be
 * `destroy()`'d. Readable/Writable/Duplex satisfy it; loose so future
 * Node-shape streams plug in without touching this file. `pipe`/`write` are
 * optional so a sink-only stage need not pretend to expose `pipe`.
 */
interface PipelineStage extends EventEmitter {
  destroy?(err?: Error): unknown;
  pipe?(dest: PipelineStage): unknown;
  write?(chunk: unknown, ...rest: unknown[]): unknown;
}

/**
 * Reject non-stream args BEFORE `pipe()` wiring. Without this,
 * `pipeline(readable, {})` reached the pipe loop and called `dest.write(...)`
 * on a plain object → `dest.write is not a function`, with no hint the bad
 * argument was `{}` at position 1. Required shape is just `on(event, handler)`
 * (the EventEmitter surface); `pipe`/`write` are checked at wiring time, so a
 * leaf stage without them stays valid.
 */
function isPipelineStreamShape(v: unknown): v is PipelineStage {
  if (v === null || typeof v !== 'object') return false;
  const candidate = v as { on?: unknown };
  return typeof candidate.on === 'function';
}

export function pipeline(...streams: unknown[]): Promise<void> {
  const cb =
    typeof streams[streams.length - 1] === 'function'
      ? (streams.pop() as (err?: Error | null) => void)
      : undefined;
  for (let i = 0; i < streams.length; i++) {
    if (!isPipelineStreamShape(streams[i])) {
      throw new TypeError(
        `pipeline: argument must be a stream (index ${i} received a non-stream value)`,
      );
    }
  }
  const chain = streams as (Readable | Writable)[];
  const p = new Promise<void>((resolve, reject) => {
    let settled = false;
    /**
     * Per-stage error absorbers — kept attached until the pipeline has settled
     * AND destroy()-triggered errors have drained on the microtask queue.
     * Without these, `destroy(err)`'s deferred `emit('error', err)` throws on a
     * stream with no listener.
     */
    const absorbers: Array<{ stage: PipelineStage; handler: (err: unknown) => void }> = [];
    const detachAbsorbers = (): void => {
      for (const { stage, handler } of absorbers) stage.off('error', handler);
      absorbers.length = 0;
    };
    const destroyAll = (err: Error, except?: PipelineStage): void => {
      for (const stage of chain as PipelineStage[]) {
        if (stage === except) continue;
        try {
          stage.destroy?.(err);
        } catch {
          // destroy() throwing mid-cleanup must not mask the original error
        }
      }
    };
    const onError = (err: unknown, source: PipelineStage): void => {
      if (settled) return;
      settled = true;
      const error = err instanceof Error ? err : new Error(String(err));
      destroyAll(error, source);
      cb?.(error);
      reject(error);
      // Detach on the next tick: destroy() schedules error emits via microtask,
      // so we must still be the listener when they fire. Two passes suffice for
      // our `queueMicrotask`-based destroy() impl.
      queueMicrotask(() => queueMicrotask(detachAbsorbers));
    };
    const onTerminus = (): void => {
      if (settled) return;
      settled = true;
      cb?.(null);
      resolve();
      detachAbsorbers();
    };
    // Absorbers double as the first-error trigger via `onError`.
    for (const stage of chain as PipelineStage[]) {
      if (!stage) continue;
      const handler = (err: unknown): void => onError(err, stage);
      stage.on('error', handler);
      absorbers.push({ stage, handler });
    }
    for (let i = 0; i < chain.length - 1; i++) {
      const src = chain[i];
      const dst = chain[i + 1] as Writable;
      if (src && 'pipe' in src && typeof (src as Readable).pipe === 'function') {
        (src as Readable).pipe(dst);
      }
    }
    // Settle on the last stage's `finish`/`end`.
    const last = chain[chain.length - 1] as PipelineStage | undefined;
    if (last) {
      last.on('finish', onTerminus);
      last.on('end', onTerminus);
    }
  });
  // With a callback the cb is the user's error path; the promise is still
  // returned for awaiters, but a no-op catch keeps a cb-only unhandled
  // rejection from crashing the process (Node's callback-form `pipeline()`
  // returns no usable promise at all).
  if (cb) p.catch(() => {});
  return p;
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
