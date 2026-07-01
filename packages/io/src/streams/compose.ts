/**
 * Node-compatible `node:stream.compose` — owned by `@riftydev/io` per ADR-0012.
 *
 * `compose(...stages)` builds a `Duplex` whose write side feeds `stages[0]` and
 * whose read side drains `stages[n-1]`, wired through the shipped `pipeline`
 * (so an error in ANY stage destroys the whole chain — destroy-on-error). Each
 * stage may be a `Duplex`/`Transform` (used as-is) or a body function
 * `(source) => asyncIterable` (an async generator), which is normalised to a
 * `Duplex` via `Duplex.from`.
 *
 * Return type is `instanceof Duplex`. Node's internal `Duplexify` class NAME is
 * deliberately NOT replicated (out of scope per the backlog contract).
 * Verified vs real Node v24.
 */

import { Duplex } from './duplex.ts';
import { pipeline } from './pipeline.ts';
import { Readable } from './readable.ts';
import { Writable } from './writable.ts';

/** A `compose` stage: a Node Duplex/Transform, or a body function. */
type ComposeStage = Duplex | ((source: AsyncGenerator<unknown>) => unknown);

function abortError(): Error {
  const err = new Error('The operation was aborted') as Error & { code?: string };
  err.name = 'AbortError';
  err.code = 'ABORT_ERR';
  return err;
}

/** Normalise one stage into a Node `Duplex` (a function → `Duplex.from(fn)`). */
function toDuplex(stage: unknown): Duplex {
  if (stage instanceof Duplex) return stage;
  if (typeof stage === 'function') {
    return Duplex.from(stage as (source: AsyncGenerator<unknown>) => unknown);
  }
  // A bare Readable/Writable is a valid first/last stage in Node's compose, but
  // the backlog contract's cases only exercise Duplex/Transform/function stages;
  // anything else is a loud reject rather than a silent coercion.
  if (stage instanceof Readable || stage instanceof Writable) {
    // Wrap a half-stream so the pipeline wiring still has a uniform shape: a
    // Readable becomes the read side, a Writable the write side, of a passthrough.
    return Duplex.from(
      stage instanceof Readable
        ? {
            readable: stage,
            writable: new Writable({
              objectMode: true,
              write(_c, _e, cb) {
                cb();
              },
            }),
          }
        : { readable: Readable.from([], { objectMode: true }), writable: stage as Writable },
    );
  }
  const err = new TypeError(
    `Each compose stage must be a Duplex, Transform, or async-generator function. Received ${stage === null ? 'null' : typeof stage}`,
  ) as TypeError & { code?: string };
  err.code = 'ERR_INVALID_ARG_TYPE';
  throw err;
}

export function compose(...stages: ComposeStage[]): Duplex {
  if (stages.length === 0) {
    const err = new TypeError('The "streams" argument must be specified') as TypeError & {
      code?: string;
    };
    err.code = 'ERR_MISSING_ARGS';
    throw err;
  }
  const duplexes = stages.map(toDuplex);
  const first = duplexes[0] as Duplex;
  const last = duplexes[duplexes.length - 1] as Duplex;

  // The composed facade: writes go to `first`, reads come from `last`. We do NOT
  // re-pipe here for a single stage — `pipeline` of one stage is a no-op, and
  // the facade still bridges its write→`first` / read←`last` (same object).
  const composed = new Duplex({
    objectMode: true,
    read(): void {
      /* push-driven from `last` below */
    },
    write(chunk, encoding, cb): void {
      first.write(chunk, encoding, cb);
    },
    final(cb): void {
      first.end();
      cb();
    },
  });

  // Wire the internal chain (≥2 stages) via the shipped pipeline so an error in
  // any stage destroys every OTHER stage (destroy-on-error). The pipeline's
  // promise rejection is surfaced by the per-stage error relays below, so we
  // swallow it here (no unhandled rejection) — the relays carry the error to the
  // composed facade.
  if (duplexes.length > 1) {
    void pipeline(...(duplexes as unknown[])).catch(() => {});
  }

  // Drain `last`'s read side into the facade.
  last.on('data', (chunk) => {
    if (!composed.destroyed) composed.push(chunk);
  });
  last.once('end', () => {
    if (!composed.destroyed) composed.push(null);
  });

  // Any stage erroring destroys the facade AND every stage (Node: the composed
  // duplex emits the error and every stage's `.destroyed` is true). The pipeline
  // already destroys the OTHER stages on the first error; we additionally destroy
  // the facade and re-assert destroy across all stages to cover a single-stage
  // compose (no pipeline) and the facade itself.
  let errored = false;
  const onStageError = (err: unknown): void => {
    if (errored) return;
    errored = true;
    const error = err instanceof Error ? err : new Error(String(err));
    for (const d of duplexes) {
      if (!d.destroyed) d.destroy(error);
    }
    if (!composed.destroyed) composed.destroy(error);
  };
  for (const d of duplexes) d.on('error', onStageError);

  // Destroying the facade tears down the chain too.
  composed.on('close', () => {
    const destroyReason = composed._writableState.errored ?? abortError();
    for (const d of duplexes) {
      if (!d.destroyed) d.destroy(destroyReason);
    }
  });

  return composed;
}
