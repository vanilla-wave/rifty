/**
 * Node-CJS realm-compat shims for kernel-spawned Worker realms.
 *
 * Separate from the `process` shim ({@link ./install-process.ts}): these patch
 * the *realm globals* a Node-built CJS bundle expects, independent of any
 * `process` shape. Installed by `installNodeRuntime` — which the host's
 * `kernel-worker-entry` registers as the kernel pre-entry hook
 * (`setKernelPreEntryHook`; the kernel ships no default) — and gated to NODE
 * worker realms (a raw WASI guest skips all three). So every Node worker realm —
 * owner shell, dev-server child, node-entry CLI, AND the worker_threads pthread
 * children Rolldown's `@emnapi/*` WASI binding spawns — is shaped before the
 * entry evaluates.
 *
 * Three shims, all forced by running real Rolldown-in-browser:
 *   - `global === globalThis` — Node parity; `@emnapi/*` references bare `global`
 *     and otherwise dies "global is not defined", hanging the bundler pool.
 *   - writable `self` — emnapi's `wasi-worker.mjs` does
 *     `Object.assign(globalThis, { self: globalThis, … })`; in a real
 *     `WorkerGlobalScope` `self` is a getter-only accessor, so that assignment
 *     THROWS. We shadow it with an own writable property (same value).
 *   - shared-memory-tolerant `TextDecoder.decode` — older Chromium REJECTS
 *     decoding a SharedArrayBuffer-backed view ("must not be shared"), which
 *     threaded WASI modules hand it straight from shared wasm memory. We copy a
 *     shared-backed input into a private buffer first. Patched UNCONDITIONALLY:
 *     the copy is a cheap no-op where the realm already accepts shared views,
 *     which is far safer than a feature-detect probe (a tiny shared decode) that
 *     would false-negative and skip the patch the emnapi guest actually needs.
 */

/** Install `global === globalThis` (Node realm-global parity). Never clobbers a
 * pre-existing `global` (a host that already shaped it wins). */
export function installGlobalAlias(): void {
  if ((globalThis as unknown as { global?: unknown }).global === undefined) {
    (globalThis as unknown as { global: typeof globalThis }).global = globalThis;
  }
}

/** Shadow a getter-only `WorkerGlobalScope.self` with an own writable property
 * (value unchanged: `self === globalThis`) so emnapi's `globalThis.self = …`
 * is a harmless no-op instead of a throw. */
export function installWritableSelf(): void {
  try {
    Object.defineProperty(globalThis, 'self', {
      value: globalThis,
      writable: true,
      configurable: true,
      enumerable: false,
    });
  } catch {
    /* `self` non-configurable in this realm — leave it */
  }
}

/**
 * Patch `Dec.prototype.decode` to copy a shared-backed input into a private
 * buffer before decoding (same bytes, same result). Idempotent (keyed on a
 * marker on the patched function). Returns whether it patched.
 *
 * `Dec` is injectable for tests; production passes the realm's `TextDecoder`.
 */
export function installSharedMemoryTolerantTextDecoder(
  Dec: typeof TextDecoder | undefined = (globalThis as { TextDecoder?: typeof TextDecoder })
    .TextDecoder,
): boolean {
  if (typeof Dec !== 'function') return false;
  const proto = Dec.prototype as { decode?: (input?: unknown, opts?: unknown) => string };
  const orig = proto.decode;
  if (typeof orig !== 'function' || (orig as { __riftyShared?: boolean }).__riftyShared) {
    return false;
  }
  const patched = function (this: TextDecoder, input?: unknown, opts?: unknown): string {
    // Copy a shared-backed view into a PRIVATE buffer before decoding. Without
    // the copy the realm that rejects shared views throws here and crashes the
    // emnapi pthread worker (the bug this shim exists to fix).
    if (ArrayBuffer.isView(input) && input.buffer instanceof SharedArrayBuffer) {
      const copy = new Uint8Array(input.byteLength);
      copy.set(new Uint8Array(input.buffer, input.byteOffset, input.byteLength));
      return orig.call(this, copy, opts);
    }
    if (input instanceof SharedArrayBuffer) {
      return orig.call(this, new Uint8Array(input).slice(), opts);
    }
    return orig.call(this, input, opts);
  };
  (patched as { __riftyShared?: boolean }).__riftyShared = true;
  proto.decode = patched;
  return true;
}

/**
 * Install all three realm-compat shims. Called by the kernel pre-entry hook
 * (see {@link ./install-process.ts} and the host `kernel-worker-entry` chunk)
 * before the user entry evaluates.
 */
export function installWorkerRealmCompat(): void {
  installGlobalAlias();
  installWritableSelf();
  installSharedMemoryTolerantTextDecoder();
}
