/**
 * `node:buffer` module surface — the `Buffer` polyfill lives in `@riftydev/io`
 * (ADR-0012); this assembles the module-level exports Node ships beside it.
 * Consumers importing this path (relative `./buffer.ts` or
 * `@riftydev/runtime-js/builtins`) and `require('node:buffer')` get the full set.
 */

import {
  Buffer,
  NotImplementedError,
  getInspectMaxBytes,
  isAscii,
  isUtf8,
  setInspectMaxBytes,
} from '@riftydev/io';

export { Buffer, type BufferLike, type Encoding } from '@riftydev/io';

const g = globalThis as typeof globalThis & {
  Blob?: unknown;
  File?: unknown;
  atob?: unknown;
  btoa?: unknown;
};

/**
 * `node:buffer.resolveObjectURL(id)` — Node resolves a `blob:` URL minted by its
 * OWN `URL.createObjectURL` blob registry. rifty owns no such cross-realm
 * registry (the browser's `URL.createObjectURL` is opaque and not introspectable),
 * so this is a loud gap rather than a silent `undefined` lie (Fidelity).
 */
function resolveObjectURL(_id: string): never {
  throw new NotImplementedError('buffer.resolveObjectURL');
}

// Module object built with a live `INSPECT_MAX_BYTES` getter/setter over io's
// shared cell, so `require('node:buffer').INSPECT_MAX_BYTES = N` actually drives
// the inspector's `<Buffer …>` truncation (Node parity), not a dead constant.
const nodeBuffer = {
  Buffer,
  // Browser-native re-exports (present in both the Worker realm and Node ≥18).
  Blob: g.Blob,
  File: g.File,
  atob: g.atob,
  btoa: g.btoa,
  // `SlowBuffer(size)` is Node's deprecated never-pooled allocator; we don't
  // pool, so it's exactly `allocUnsafeSlow` (no `this`, safe as a bare ref).
  SlowBuffer: Buffer.allocUnsafeSlow,
  isUtf8,
  isAscii,
  resolveObjectURL,
} as Record<string, unknown>;

Object.defineProperty(nodeBuffer, 'INSPECT_MAX_BYTES', {
  enumerable: true,
  configurable: true,
  get: getInspectMaxBytes,
  set: setInspectMaxBytes,
});

export default nodeBuffer;
