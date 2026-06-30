/**
 * `@riftydev/io` — shared primitives layer.
 *
 * Per ADR-0012, this package owns the Node-compatible primitives consumed by
 * `@riftydev/runtime-js`, `@riftydev/kernel`, and `@riftydev/net`:
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
export {
  Buffer,
  getInspectMaxBytes,
  setInspectMaxBytes,
  isUtf8,
  isAscii,
} from './buffer.ts';
export type { Buffer as BufferType, BufferLike, Encoding } from './buffer.ts';
// ADR-0082: zero-copy bytes→string decode on the public surface. Lets text
// reads (e.g. runtime-js fs) skip the throwaway full-buffer Buffer.from copy.
export { decode as bytesToString } from './buffer-codec.ts';
export {
  Readable,
  Writable,
  Duplex,
  Transform,
  PassThrough,
  Stream,
  pipeline,
  finished,
  addAbortSignal,
  getDefaultHighWaterMark,
  setDefaultHighWaterMark,
  isReadable,
  isWritable,
  isErrored,
  isDisturbed,
  type ReadableOptions,
  type ReadableFromWebOptions,
  type AsyncHelperOptions,
  type WritableOptions,
  type WriteChunk,
  type DuplexOptions,
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
