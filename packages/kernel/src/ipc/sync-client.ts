/**
 * In-Worker sync RPC client (ADR-0011 phase 3).
 *
 * Counterpart of {@link SyncRpcDispatcher}. Lives inside a kernel-spawned
 * Worker realm and provides the `call(method, payload)` primitive used by
 * Node-style synchronous APIs (`execSync`, `readFileSync`, ...).
 *
 * Throws {@link NotImplementedError} when constructed outside a kernel
 * Worker: calling sync APIs from the page realm freezes the UI, so we
 * surface that at construction rather than fall through to the in-realm path.
 */

import { NotImplementedError } from '@riftydev/io';
import type { SabRing } from './sab-ring.ts';
import { type SyncRpcReply, decodeReply, encodeBinaryRequest, encodeRequest } from './sync-rpc.ts';

/** Options accepted by {@link SyncRpcClient}. */
export interface SyncRpcClientOptions {
  /**
   * Default timeout (ms) for {@link SyncRpcClient.call}; rejects with
   * {@link RingTimeoutError} on expiry. Defaults to blocking indefinitely —
   * the caller surfaces timeouts when they matter.
   */
  readonly defaultTimeoutMs?: number;
}

/**
 * Synchronous RPC client. Construct one per Worker realm; `call()` blocks
 * the calling Worker via `Atomics.wait` until the parent dispatcher replies.
 *
 * Construction throws {@link NotImplementedError} outside a kernel-spawned
 * Worker — sync APIs on the main thread freeze the page, which ADR-0011
 * exists to prevent.
 */
export class SyncRpcClient {
  private readonly ring: SabRing;
  private readonly defaultTimeoutMs: number | undefined;
  /**
   * Forensic trail: the last method sent on this ring and whether its
   * exchange completed. A wedged ring ("previous reply is unread") is a
   * SECONDARY symptom — the primal violation is whatever abandoned the
   * PREVIOUS exchange; without this trail the CI flake was undiagnosable.
   */
  private lastMethod: string | null = null;
  private lastCompleted = false;

  constructor(ring: SabRing, opts: SyncRpcClientOptions = {}) {
    if (!isWorkerRealm()) {
      throw new NotImplementedError(
        'SyncRpcClient',
        'called from main realm — only valid inside a kernel-spawned Worker',
      );
    }
    this.ring = ring;
    this.defaultTimeoutMs = opts.defaultTimeoutMs;
  }

  /**
   * Send the request frame, block on the reply, and return its `value`
   * (or throw a reconstructed `Error` when `ok=false`).
   *
   * The cast to `T` mirrors `fetch().then(r => r.json() as T)`: the wire
   * format carries no type info, so the caller asserts the shape.
   */
  call<T>(method: string, payload: unknown, timeoutMs?: number): T {
    return this.exchange(method, () => encodeRequest({ method, payload }), timeoutMs);
  }

  /** Send an ADR-0366 binary request through the same claimed ring lifecycle. */
  callBinary<T>(method: string, payload: Uint8Array, timeoutMs?: number): T {
    return this.exchange(method, () => encodeBinaryRequest(method, payload), timeoutMs);
  }

  private exchange<T>(
    method: string,
    encode: () => Uint8Array,
    timeoutMs?: number,
  ): T {
    // Trail captured BEFORE this exchange mutates it — the wedge context is
    // the PREVIOUS call, not the current one.
    const prevMethod = this.lastMethod;
    const prevCompleted = this.lastCompleted;
    let replyBytes: Uint8Array;
    try {
      const request = encode();
      this.ring.writeRequest(request);
      this.lastMethod = method;
      this.lastCompleted = false;
      const effectiveTimeout = timeoutMs ?? this.defaultTimeoutMs;
      replyBytes = this.ring.waitReply(effectiveTimeout);
    } catch (err) {
      throw withCallContext(err, method, prevMethod, prevCompleted);
    }
    this.lastCompleted = true;
    let reply: SyncRpcReply;
    try {
      reply = decodeReply(replyBytes);
    } catch (err) {
      throw withCallContext(err, method, prevMethod, prevCompleted);
    }
    if (reply.ok) {
      return reply.value as T;
    }
    const errInfo = reply.error ?? { name: 'Error', message: 'unknown error' };
    const err = new Error(errInfo.message);
    err.name = errInfo.name;
    // Re-attach all ErrnoException fields when present (child CLI reads owner fs over sync-RPC, ADR-0150).
    // Object.assign so they land as own enumerable properties, matching Node's ErrnoException.
    const extras: Record<string, string | number> = {};
    if (errInfo.code !== undefined) extras.code = errInfo.code;
    if (errInfo.errno !== undefined) extras.errno = errInfo.errno;
    if (errInfo.syscall !== undefined) extras.syscall = errInfo.syscall;
    if (errInfo.path !== undefined) extras.path = errInfo.path;
    Object.assign(err, extras);
    throw err;
  }
}

/**
 * Augment a ring/decode error with the call it interrupted and the previous
 * call on this ring (same Error OBJECT — class and `code` survive for
 * callers that branch on them). The wedge errors are secondary symptoms;
 * this trail points at the exchange that abandoned the ring.
 */
function withCallContext(
  err: unknown,
  method: string,
  prevMethod: string | null,
  prevCompleted: boolean,
): unknown {
  if (!(err instanceof Error)) return err;
  const prev =
    prevMethod === null
      ? ''
      : ` (previous call on this ring: '${prevMethod}' (${prevCompleted ? 'completed' : 'failed'}))`;
  err.message = `sync-rpc call '${method}' failed: ${err.message}${prev}`;
  return err;
}

/**
 * Best-effort detection of a Dedicated/Shared Worker realm. Mirrors the
 * predicate in `worker-entry.ts`.
 */
function isWorkerRealm(): boolean {
  const g = globalThis as unknown as {
    WorkerGlobalScope?: unknown;
    postMessage?: unknown;
    window?: unknown;
  };
  if (typeof g.WorkerGlobalScope === 'undefined') return false;
  if (typeof g.postMessage !== 'function') return false;
  if (typeof g.window !== 'undefined') return false;
  return true;
}
