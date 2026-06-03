/**
 * Public subpath export of selected built-ins for higher-layer packages
 * (net, npm-client, etc.) that need to share types/classes with user code
 * — Buffer, EventEmitter, Readable, etc. Exposed via `@riftydev/runtime-js/builtins`.
 *
 * User code in the runtime should `require('node:buffer')` etc., not import
 * this directly.
 */
export { Buffer } from './buffer.ts';
export { EventEmitter, once } from './events.ts';
export { Readable, Writable, Duplex, Transform, PassThrough } from './stream.ts';
