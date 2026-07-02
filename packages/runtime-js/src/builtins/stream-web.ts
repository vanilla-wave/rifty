/**
 * `node:stream/web` — Node's implementation of this module IS the WHATWG
 * Streams API, so we re-export the host (Chromium) WHATWG globals: each named
 * export is `=== globalThis.<Name>` where the platform provides it. No
 * reimplementation (ADR-0154 leaves the surface unclaimed; this claims it as a
 * pure re-export over the platform globals).
 *
 * Fidelity (no-silent-stub): a genuinely-absent member is NOT exported as
 * `undefined` (which would lie that the constructor exists and is `undefined`).
 * It is installed as a getter that throws `NotImplementedError('stream/web.<Name>')`
 * on access — a loud throw at use, never a silent `undefined`-export.
 */

import { NotImplementedError } from '@riftydev/io';

/**
 * The WHATWG constructors Node's `node:stream/web` exposes (the acceptance
 * set). Each maps to the same-named platform global.
 */
const WHATWG_NAMES = [
  'ReadableStream',
  'WritableStream',
  'TransformStream',
  'ByteLengthQueuingStrategy',
  'CountQueuingStrategy',
  'ReadableStreamDefaultReader',
  'ReadableStreamBYOBReader',
  'ReadableStreamDefaultController',
  'ReadableByteStreamController',
  'WritableStreamDefaultWriter',
  'WritableStreamDefaultController',
  'TransformStreamDefaultController',
  'TextEncoderStream',
  'TextDecoderStream',
] as const;

const streamWebModule: Record<string, unknown> = {};
for (const name of WHATWG_NAMES) {
  const value = (globalThis as Record<string, unknown>)[name];
  if (value !== undefined) {
    // Present: re-export the platform global by identity (=== globalThis.<Name>).
    streamWebModule[name] = value;
  } else {
    // Absent in this host build: loud throw at access, never an undefined export.
    Object.defineProperty(streamWebModule, name, {
      enumerable: true,
      configurable: true,
      get(): never {
        throw new NotImplementedError(`stream/web.${name}`);
      },
    });
  }
}

export default streamWebModule;
