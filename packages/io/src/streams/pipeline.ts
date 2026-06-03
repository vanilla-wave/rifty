/**
 * Node-compatible `node:stream.pipeline` / `finished` — owned by `@riftydev/io`
 * per ADR-0012.
 *
 * Per Node docs (and ADR-0034):
 *   - `pipeline(a, b, c, cb?)` wires `a → b → c`, then resolves when the last
 *     stage emits `finish` (writable terminus) or `end` (readable terminus).
 *   - On ANY error in ANY stage of the chain, `pipeline()` calls `destroy(err)`
 *     on every OTHER stage, then invokes the callback / rejects with the error.
 *     This is what stops a producer from continuing to pump into a dead sink.
 *   - The callback (and the promise resolution) fire exactly once.
 *
 * Implementation note: pipeline keeps error-absorber listeners attached on
 * each stage even AFTER the first error fires. Without these absorbers,
 * `destroy(err)` on an upstream stage emits `'error'` on the next tick with
 * no listener → unhandled throw. Node uses `eos()` (end-of-stream) helpers
 * that internally hold an error-listener until all streams have closed.
 */

import type { EventEmitter } from '../event-emitter.ts';
import type { Readable } from './readable.ts';
import type { Writable } from './writable.ts';

/**
 * Minimal duck-shape for "thing the pipeline understands": anything that emits
 * `error`/`end`/`finish` and can be `destroy()`'d. Readable/Writable/Duplex
 * all satisfy this; the type is intentionally loose so future Node-shape
 * streams plug in without touching this file.
 *
 * `pipe` / `write` are present on intermediate / sink stages respectively
 * (Node uses a similar duck-shape) — both are optional here so a sink-only
 * stage need not pretend to expose `pipe`.
 */
interface PipelineStage extends EventEmitter {
  destroy?(err?: Error): unknown;
  pipe?(dest: PipelineStage): unknown;
  write?(chunk: unknown, ...rest: unknown[]): unknown;
}

/**
 * Reject anything that isn't a stream-shaped object BEFORE `pipe()` wiring
 * runs. Without this, `pipeline(readable, {})` reached the pipe loop and
 * eventually called `dest.write(...)` on a plain object → `dest.write is not
 * a function`, with no hint that the bad argument was `{}` at position 1.
 *
 * The required shape is intentionally minimal: an `on(event, handler)` method
 * so the pipeline can attach its error absorber and terminus listener. Real
 * pipe wiring happens only if `pipe` exists on the upstream stage, so the
 * absence of `pipe`/`write` on a leaf stage stays valid; the validator just
 * guarantees the EventEmitter surface is real.
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
     * Per-stage error absorbers — installed on every stage and kept attached
     * until both the pipeline has settled AND the destroy()-triggered errors
     * have drained on the microtask queue. Without these, `destroy(err)`'s
     * deferred `emit('error', err)` would throw on a stream with no listener.
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
          // destroy() throwing mid-cleanup must not mask the original error.
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
      // Detach absorbers on the NEXT tick — destroy() schedules error emits via
      // microtask, so we need to be the listener when they fire. One pass
      // through the microtask queue is enough for our `queueMicrotask`-based
      // destroy() impl.
      queueMicrotask(() => queueMicrotask(detachAbsorbers));
    };
    const onTerminus = (): void => {
      if (settled) return;
      settled = true;
      cb?.(null);
      resolve();
      detachAbsorbers();
    };
    // Install error absorbers on every stage; they double as the first-error
    // trigger via `onError`.
    for (const stage of chain as PipelineStage[]) {
      if (!stage) continue;
      const handler = (err: unknown): void => onError(err, stage);
      stage.on('error', handler);
      absorbers.push({ stage, handler });
    }
    // Wire each pipe stage->next-stage.
    for (let i = 0; i < chain.length - 1; i++) {
      const src = chain[i];
      const dst = chain[i + 1] as Writable;
      if (src && 'pipe' in src && typeof (src as Readable).pipe === 'function') {
        (src as Readable).pipe(dst);
      }
    }
    // Terminus listeners — settle the pipeline on the last stage's
    // `finish`/`end`.
    const last = chain[chain.length - 1] as PipelineStage | undefined;
    if (last) {
      last.on('finish', onTerminus);
      last.on('end', onTerminus);
    }
  });
  // When a callback is supplied, the callback is the user's error-handling
  // path. The promise is still returned for code that wants to await it, but
  // we attach a no-op catch so an unhandled rejection on the cb-only path
  // doesn't crash the process (matches the spirit of Node's callback-form
  // `pipeline()`, which doesn't return a usable promise at all).
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
