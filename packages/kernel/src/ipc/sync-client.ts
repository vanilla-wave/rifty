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
import { decodeReply, encodeRequest } from './sync-rpc.ts';

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
    const req = encodeRequest({ method, payload });
    this.ring.writeRequest(req);
    const effectiveTimeout = timeoutMs ?? this.defaultTimeoutMs;
    const replyBytes = this.ring.waitReply(effectiveTimeout);
    const reply = decodeReply(replyBytes);
    if (reply.ok) {
      return reply.value as T;
    }
    const errInfo = reply.error ?? { name: 'Error', message: 'unknown error' };
    const err = new Error(errInfo.message);
    err.name = errInfo.name;
    if (errInfo.code !== undefined) {
      (err as Error & { code?: string }).code = errInfo.code;
    }
    throw err;
  }
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
