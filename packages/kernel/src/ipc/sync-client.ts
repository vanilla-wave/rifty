/**
 * In-Worker sync RPC client (ADR-0011 phase 3).
 *
 * Counterpart of {@link SyncRpcDispatcher}. Lives inside a kernel-spawned
 * Worker realm and provides the `call(method, payload)` primitive used by
 * `child_process.execSync`, `fs.readFileSync`, and any other Node-style
 * synchronous API the runtime layer surfaces.
 *
 * The class throws loudly via {@link NotImplementedError} when constructed
 * outside a kernel Worker — calling sync APIs from the page realm is the
 * single most likely source of confusion ("`execSync` froze my UI?"), so
 * we surface that case at construction rather than silently falling
 * through to the in-realm fallback.
 */

import { NotImplementedError } from '@rifty/io';
import type { SabRing } from './sab-ring.ts';
import { decodeReply, encodeRequest } from './sync-rpc.ts';

/** Options accepted by {@link SyncRpcClient}. */
export interface SyncRpcClientOptions {
  /**
   * Default timeout in milliseconds for {@link SyncRpcClient.call}. The
   * call rejects with {@link RingTimeoutError} when the dispatcher hasn't
   * replied in time. Defaults to no timeout (block indefinitely) — the
   * caller is responsible for surfacing timeouts when they matter.
   */
  readonly defaultTimeoutMs?: number;
}

/**
 * Synchronous RPC client. Construct one per Worker realm; `call()` blocks
 * the calling Worker via `Atomics.wait` until the parent dispatcher
 * replies.
 *
 * Construction throws {@link NotImplementedError} when the current realm
 * does not look like a kernel-spawned Worker (no `self`, or no `postMessage`
 * with the worker-scope shape). This is a hard rule — calling sync APIs on
 * the main thread would freeze the page, which is exactly what ADR-0011
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
   * Send the request frame, block on the reply, decode it, and return the
   * `value` field (or throw a reconstructed `Error` when `ok=false`).
   *
   * The cast to `T` mirrors a typical `fetch().then(r => r.json() as T)`
   * — JSON doesn't carry type information so the caller asserts the
   * expected shape.
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
 * Best-effort detection that we're running inside a Dedicated/Shared Worker
 * realm. Mirrors the predicate in `worker-entry.ts` — a `WorkerGlobalScope`
 * is present, a `postMessage` exists on the global, and there's no `window`.
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
