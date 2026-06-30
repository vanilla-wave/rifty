/**
 * Aggregator for the split stream primitives. The runtime-js `node:stream`
 * adapter pulls its `default` export (object shape) from here.
 */

import { getDefaultHighWaterMark, setDefaultHighWaterMark } from './default-highwatermark.ts';
import { Duplex } from './duplex.ts';
import { Stream } from './legacy-stream.ts';
import { PassThrough } from './pass-through.ts';
import { finished, pipeline } from './pipeline.ts';
import { Readable, type ReadableState, addAbortSignal } from './readable.ts';
import { Transform } from './transform.ts';
import { Writable, type WritableState } from './writable.ts';

export { Readable, type ReadableFromWebOptions, type ReadableOptions } from './readable.ts';
export { Writable, type WritableOptions, type WriteChunk } from './writable.ts';
export { Duplex } from './duplex.ts';
export { Transform, type TransformOptions } from './transform.ts';
export { PassThrough } from './pass-through.ts';
export { pipeline, finished } from './pipeline.ts';
export { Stream } from './legacy-stream.ts';
export { addAbortSignal } from './readable.ts';
export {
  getDefaultHighWaterMark,
  setDefaultHighWaterMark,
} from './default-highwatermark.ts';

// ──────────────────────────── stream predicates ─────────────────────────────
// `stream.isReadable`/`isWritable`/`isErrored`/`isDisturbed` (Node v16.14/v17.3),
// reading the EXISTING `_readableState`/`_writableState` — no new machinery.
// Return shapes pin REAL Node exactly (verified vs the parity runner):
//   - `isReadable`/`isWritable` → `null` for a non-stream (or the wrong half);
//   - `isErrored`/`isDisturbed` → `false` for a non-stream.
// A non-stream input NEVER throws. We duck-type on the state container (not
// `instanceof`): a `Duplex` has both states, a pure `Writable` has no
// `_readableState`, a pure `Readable` has no `_writableState`.

function readableStateOf(stream: unknown): ReadableState | undefined {
  if (typeof stream !== 'object' || stream === null) return undefined;
  const state = (stream as { _readableState?: unknown })._readableState;
  return typeof state === 'object' && state !== null ? (state as ReadableState) : undefined;
}

function writableStateOf(stream: unknown): WritableState | undefined {
  if (typeof stream !== 'object' || stream === null) return undefined;
  const state = (stream as { _writableState?: unknown })._writableState;
  return typeof state === 'object' && state !== null ? (state as WritableState) : undefined;
}

/**
 * `true` only for a not-yet-ended/destroyed/errored Readable (or Duplex
 * readable side); `null` for a non-Readable input (Node's exact shape).
 */
export function isReadable(stream: unknown): boolean | null {
  const state = readableStateOf(stream);
  if (!state) return null;
  return !state.destroyed && !state.endEmitted && !state.ended && state.errored === null;
}

/**
 * `true` only for a not-yet-ended/destroyed/errored Writable (or Duplex
 * writable side); `null` for a non-Writable input (Node's exact shape).
 */
export function isWritable(stream: unknown): boolean | null {
  const state = writableStateOf(stream);
  if (!state) return null;
  return !state.destroyed && !state.ending && !state.finished && state.errored === null;
}

/**
 * `true` once a stream (either half) has errored; `false` otherwise, including
 * for a non-stream input (never throws).
 */
export function isErrored(stream: unknown): boolean {
  const r = readableStateOf(stream);
  const w = writableStateOf(stream);
  if (!r && !w) return false;
  return (r?.errored ?? null) !== null || (w?.errored ?? null) !== null;
}

/**
 * `true` once a Readable has been read-from (a chunk delivered) or destroyed —
 * backed by the EXPLICIT `disturbed` bit on `_readableState`, never inferred.
 * `false` for a non-Readable input (never throws).
 */
export function isDisturbed(stream: unknown): boolean {
  const state = readableStateOf(stream);
  if (!state) return false;
  return state.disturbed;
}

const stream = {
  Readable,
  Writable,
  Duplex,
  Transform,
  PassThrough,
  pipeline,
  finished,
  Stream,
  addAbortSignal,
  getDefaultHighWaterMark,
  setDefaultHighWaterMark,
  isReadable,
  isWritable,
  isErrored,
  isDisturbed,
};
export default stream;
