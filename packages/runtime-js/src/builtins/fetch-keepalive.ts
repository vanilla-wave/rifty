/**
 * Event-loop keepalive for detached `fetch()` in a run-to-completion child realm
 * (keepalive gap-d). The realm reaps on keepalive drain (refCount→0, ADR-0152);
 * the host worker `fetch` is the realm's sole real network-egress primitive
 * (`node:http.request` to an external host delegates to it; `https`/`net.connect`
 * are loud NotImplementedError) yet held no ref — so `fetch(u).then(r => r.text())
 * .then(write)` detached after top-level was dropped silently (realm drained
 * before the body arrived).
 *
 * Fix: install a keepalive-aware `fetch` wrapper in the child-realm bootstrap
 * (mirror of `installTimerGlobals`). `keepaliveRef()` on dispatch; release once
 * the response BODY is consumed — Node keeps the socket refed until the body is
 * read, so releasing at headers (fetch resolve) would let the realm reap mid
 * `.text()` (race-dependent). Symmetric with `loader.import` ref-on-start /
 * unref-on-settle, extended across the body read.
 *
 * Honest scope (Fidelity): counts the global `fetch` boundary through public
 * Body consumption. Native WebAssembly streaming is a realm-wide loud gap;
 * `http.request` external hosts route through `fetch`; loopback is in-process;
 * `https`/`net.connect` loud-throw. A never-consumed Response holds the realm to
 * the drain cap (loud) — matching Node keeping an undrained socket alive.
 */

import { NotImplementedError } from '@riftydev/io';
import { ref as keepaliveRef, unref as keepaliveUnref } from '../internal/event-loop-keepalive.ts';

/** Body-mixin consumers — reading any of them (or the `body` stream) drains the body. */
const BODY_CONSUMERS = ['arrayBuffer', 'blob', 'bytes', 'formData', 'json', 'text'] as const;

interface FetchTarget {
  fetch?: typeof fetch;
  WebAssembly?: Pick<typeof WebAssembly, 'compileStreaming' | 'instantiateStreaming'>;
}

const WEBASSEMBLY_STREAMING_APIS = ['compileStreaming', 'instantiateStreaming'] as const;

/**
 * Wrap `target.fetch` so an in-flight request keeps the keepalive loop alive
 * until its body is consumed. Idempotent-safe per target. The Body wrapper is a
 * no-op when the realm has no `fetch` (honest: nothing to count); WebAssembly
 * streaming stays a realm-wide loud gap because native body reads escape it.
 */
export function installFetchKeepalive(target: FetchTarget = globalThis as FetchTarget): void {
  installWebAssemblyStreamingCeilings(target.WebAssembly);
  const hostFetch = target.fetch;
  if (typeof hostFetch !== 'function') return;
  const boundFetch = hostFetch.bind(target) as typeof fetch;

  const keepaliveFetch = ((...args: Parameters<typeof fetch>): Promise<Response> => {
    keepaliveRef();
    let released = false;
    const release = (): void => {
      if (released) return;
      released = true;
      keepaliveUnref();
    };

    let promise: Promise<Response>;
    try {
      promise = boundFetch(...args);
    } catch (err) {
      release(); // synchronous throw (e.g. invalid input) — never leak the ref
      throw err;
    }

    // Settle observer on a SEPARATE branch (NOT returned to the caller) so the
    // user's own chain + rejection semantics are untouched; the reject handler
    // consumes its own reason, so the wrapper never raises a second unhandled one.
    promise.then(
      (response) => trackBody(response, release),
      () => release(),
    );
    return promise;
  }) as typeof fetch;

  target.fetch = keepaliveFetch;
}

/** Preserve effective property + name/length/own descriptors; close the realm loudly. */
function installWebAssemblyStreamingCeilings(namespace: FetchTarget['WebAssembly']): void {
  if (namespace === undefined) return;

  for (const name of WEBASSEMBLY_STREAMING_APIS) {
    const original = namespace[name];
    if (typeof original !== 'function') continue;
    const feature = `WebAssembly.${name}`;
    const ceiling = new Proxy(original, {
      apply() {
        return Promise.reject(new NotImplementedError(feature));
      },
    });
    const descriptor = findPropertyDescriptor(namespace, name);
    Object.defineProperty(namespace, name, {
      configurable: descriptor?.configurable ?? true,
      enumerable: descriptor?.enumerable ?? false,
      value: ceiling,
      writable: descriptor !== undefined && 'writable' in descriptor ? descriptor.writable : true,
    });
  }
}

function findPropertyDescriptor(target: object, key: PropertyKey): PropertyDescriptor | undefined {
  let owner: object | null = target;
  while (owner !== null) {
    const descriptor = Object.getOwnPropertyDescriptor(owner, key);
    if (descriptor !== undefined) return descriptor;
    owner = Object.getPrototypeOf(owner) as object | null;
  }
  return undefined;
}

/** Hold the ref until the response body is drained (or release now if there is none). */
function trackBody(response: Response, release: () => void): void {
  // No body (204 / 304 / HEAD / opaque) → nothing more to await.
  if (response.body === null) {
    release();
    return;
  }
  // The body is consumed via exactly ONE of a Body-mixin method or the `body`
  // stream directly (consuming one disturbs the other) — cover both; `release`
  // is idempotent so the double-cover is safe.
  overrideConsumers(response, release);
  wrapBodyStream(response, release);
}

/** Override `text`/`json`/… on this instance to release once they settle. */
function overrideConsumers(response: Response, release: () => void): void {
  const record = response as unknown as Record<string, unknown>;
  for (const name of BODY_CONSUMERS) {
    const orig = record[name];
    if (typeof orig !== 'function') continue;
    const original = orig as (...a: unknown[]) => unknown;
    record[name] = function patched(this: unknown, ...a: unknown[]): unknown {
      let out: unknown;
      try {
        out = original.apply(this, a);
      } catch (err) {
        release(); // synchronous reject (already-disturbed body)
        throw err;
      }
      return Promise.resolve(out).finally(release);
    };
  }
}

/**
 * Replace the `body` getter with one returning a stream that releases on
 * close/error/cancel. The wrapped stream locks the source LAZILY (first pull),
 * so merely reading `response.body` does not lock it — matching real `fetch`
 * (read ≠ lock), and leaving the Body-mixin methods (which read the internal
 * slot) free to consume the body when the stream is never pulled.
 */
function wrapBodyStream(response: Response, release: () => void): void {
  // TODO(backlog: runtime-js/fetch-keepalive-response-clone-lifecycle)
  const source = response.body;
  if (source === null) return;
  let wrapped: ReadableStream<Uint8Array> | null = null;
  let computed = false;
  Object.defineProperty(response, 'body', {
    configurable: true,
    enumerable: false,
    get(): ReadableStream<Uint8Array> | null {
      if (!computed) {
        computed = true;
        wrapped = trackStream(source, release);
      }
      return wrapped;
    },
  });
}

/** A pass-through stream that releases the keepalive ref exactly once on termination. */
function trackStream(
  source: ReadableStream<Uint8Array>,
  release: () => void,
): ReadableStream<Uint8Array> {
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (reader === null) reader = source.getReader(); // lazy lock — read ≠ lock
      return reader.read().then(
        ({ done, value }) => {
          if (done) {
            controller.close();
            release();
            return;
          }
          controller.enqueue(value);
        },
        (err) => {
          controller.error(err);
          release();
        },
      );
    },
    cancel(reason) {
      release();
      return reader !== null ? reader.cancel(reason) : source.cancel(reason);
    },
  });
}
