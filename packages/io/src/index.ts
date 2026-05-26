/**
 * `@rifty/io` — shared primitives layer.
 *
 * Per ADR-0012, this package owns the Node-compatible primitives consumed by
 * `@rifty/runtime-js`, `@rifty/kernel`, and `@rifty/net`:
 *   - `NotImplementedError` for loud, structured "not yet" stubs.
 *   - `EventEmitter` (full Node-compatible) + `once()` promise helper.
 *   - `Buffer` factory + per-instance method patching.
 *   - Stream primitives: `Readable`, `Writable`, `Duplex`, `Transform`,
 *     `PassThrough`, plus `pipeline` and `finished` helpers.
 *   - `node:` builtin registry (`registerBuiltin` / `loadBuiltin` /
 *     `isBuiltinSpecifier` / `listBuiltins`) — see ADR-0035.
 *   - Preview-protocol addressing primitives (`PREVIEW_PREFIX_RE`,
 *     `PREVIEW_LOCAL_HOST`, `synthesizePreviewUrl`, `parsePreviewPath`) —
 *     see ADR-0036.
 *
 * Higher layers re-export these through their Node-shape adapters (e.g.
 * `runtime-js/src/builtins/{events,buffer,stream}.ts`).
 */

export { NotImplementedError } from './errors.ts';
export { EventEmitter, once } from './event-emitter.ts';
export { Buffer } from './buffer.ts';
export type { Buffer as BufferType, BufferLike, Encoding } from './buffer.ts';
export {
  Readable,
  Writable,
  Duplex,
  Transform,
  PassThrough,
  pipeline,
  finished,
  type ReadableOptions,
  type WritableOptions,
  type TransformOptions,
} from './streams/index.ts';
export {
  registerBuiltin,
  isBuiltinSpecifier,
  loadBuiltin,
  listBuiltins,
  type BuiltinFactory,
} from './builtin-registry.ts';
export {
  PREVIEW_PREFIX_RE,
  PREVIEW_LOCAL_HOST,
  synthesizePreviewUrl,
  parsePreviewPath,
} from './preview-protocol.ts';
