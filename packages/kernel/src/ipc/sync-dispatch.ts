/**
 * Parent-side sync RPC dispatcher (ADR-0011 phase 3).
 *
 * The dispatcher runs in the realm that owns the kernel — typically the
 * playground main thread (or the orchestrator Worker when nested kernels
 * land). It polls a {@link SabRing}'s request slot, dispatches incoming
 * frames to registered handlers, and writes the (possibly async) reply
 * back into the ring.
 *
 * Polling rather than `Atomics.waitAsync` keeps the implementation
 * straightforward: `waitAsync` would block forever on the main thread when
 * no request arrives, and we cannot make the dispatcher block since other
 * kernel work (process exit notifications, GC, etc.) needs to run on the
 * same realm. The poll interval defaults to 1 ms which is well below
 * scheduler granularity — for a synthetic `execSync` benchmark this adds
 * sub-millisecond latency on top of the child's own runtime.
 *
 * The dispatcher is recursive-safe: the handler for `'execSync'` may itself
 * call {@link ProcessManager.spawnWorker} which creates a new ring and
 * attaches a fresh dispatcher. Each dispatcher has its own polling loop;
 * they don't share state.
 */

import type { SabRing } from './sab-ring.ts';
import { type SyncRpcReply, type SyncRpcRequest, decodeRequest, encodeReply } from './sync-rpc.ts';

/**
 * Handler signature for a registered RPC method. Returning a thenable
 * defers the reply until the promise settles; rejections become
 * `{ok:false, error}` replies.
 */
export type SyncRpcHandler<T = unknown> = (payload: unknown) => T | Promise<T>;

/** Options accepted by {@link SyncRpcDispatcher}. */
export interface SyncRpcDispatcherOptions {
  /**
   * Poll interval in milliseconds. The dispatcher checks the SAB ring's
   * request slot every `pollIntervalMs` ticks of `setTimeout`. Defaults
   * to 1 ms — fine for development; the playground may tune this later.
   */
  readonly pollIntervalMs?: number;
}

/**
 * Single-realm dispatcher that owns the parent side of one or more
 * {@link SabRing}s. Register handlers with {@link register}, then
 * {@link attach} a ring to start polling.
 *
 * The same dispatcher instance can serve many rings — useful when the
 * kernel spawns several children that share the parent's handler table.
 */
export class SyncRpcDispatcher {
  private readonly handlers = new Map<string, SyncRpcHandler>();
  private readonly pollIntervalMs: number;
  private readonly attachments = new Map<SabRing, ReturnType<typeof setInterval>>();
  /**
   * Per-ring guard: when a handler is awaiting an async result we must not
   * read another request from the same ring (and we can't anyway — the
   * client won't send one until it sees the reply). The flag covers the
   * window between handler dispatch and reply write.
   */
  private readonly inFlight = new WeakSet<SabRing>();

  constructor(opts: SyncRpcDispatcherOptions = {}) {
    this.pollIntervalMs = opts.pollIntervalMs ?? 1;
  }

  /**
   * Register a handler for `method`. Re-registering the same method
   * replaces the previous handler (idempotent — useful for tests that
   * tear down and recreate the dispatcher).
   */
  register<T = unknown>(method: string, handler: SyncRpcHandler<T>): void {
    this.handlers.set(method, handler as SyncRpcHandler);
  }

  /** Remove a previously-registered handler. No-op if absent. */
  unregister(method: string): void {
    this.handlers.delete(method);
  }

  /**
   * Start polling `ring`'s request slot. Safe to call multiple times for
   * the same ring (idempotent — only the first call installs the timer).
   * Pair every {@link attach} with a {@link detach} on worker exit so the
   * timer doesn't keep the realm alive.
   */
  attach(ring: SabRing): void {
    if (this.attachments.has(ring)) return;
    const timer = setInterval(() => {
      this.pumpOnce(ring);
    }, this.pollIntervalMs);
    // Don't keep Node alive purely for the dispatcher; the kernel's exit
    // path is the source of truth. `unref` is Node-only — the browser
    // `setInterval` return type doesn't expose it, so we feature-detect.
    const maybeUnref = (timer as unknown as { unref?: () => void }).unref;
    if (typeof maybeUnref === 'function') maybeUnref.call(timer);
    this.attachments.set(ring, timer);
  }

  /** Stop polling `ring`. Safe to call when not attached (no-op). */
  detach(ring: SabRing): void {
    const timer = this.attachments.get(ring);
    if (timer === undefined) return;
    clearInterval(timer);
    this.attachments.delete(ring);
  }

  /** Detach every ring. Useful for shutdown / test cleanup. */
  detachAll(): void {
    for (const [ring, timer] of this.attachments) {
      clearInterval(timer);
      this.attachments.delete(ring);
    }
  }

  /**
   * One poll cycle: read a request if present, dispatch, write the reply.
   * Public for tests that want to drive the dispatcher deterministically
   * instead of waiting on the timer.
   */
  pumpOnce(ring: SabRing): void {
    if (this.inFlight.has(ring)) return;
    const bytes = ring.readRequest();
    if (bytes === null) return;
    this.inFlight.add(ring);
    let req: SyncRpcRequest;
    try {
      req = decodeRequest(bytes);
    } catch (err) {
      this.writeError(ring, err);
      return;
    }
    const handler = this.handlers.get(req.method);
    if (!handler) {
      this.writeError(
        ring,
        Object.assign(new Error(`SyncRpcDispatcher: no handler for '${req.method}'`), {
          code: 'ERPCNOHANDLER',
        }),
      );
      return;
    }
    let result: unknown;
    try {
      result = handler(req.payload);
    } catch (err) {
      this.writeError(ring, err);
      return;
    }
    if (isThenable(result)) {
      result.then(
        (value) => this.writeValue(ring, value),
        (err: unknown) => this.writeError(ring, err),
      );
      return;
    }
    this.writeValue(ring, result);
  }

  private writeValue(ring: SabRing, value: unknown): void {
    const reply: SyncRpcReply = { ok: true, value };
    try {
      ring.writeReply(encodeReply(reply));
      this.inFlight.delete(ring);
    } catch (err) {
      // The ring rejects writeReply when a previous reply is unread, or
      // when the payload exceeds capacity. Both are programmer errors at
      // this layer — surface as an error reply that fits, since the
      // happy-path reply already failed to land.
      this.writeError(ring, err);
    }
  }

  private writeError(ring: SabRing, err: unknown): void {
    const reply: SyncRpcReply = { ok: false, error: errorToShape(err) };
    try {
      ring.writeReply(encodeReply(reply));
    } catch {
      // If even the error reply can't be written (e.g. ring already has a
      // pending reply), there's nothing useful to do — drop it. The caller
      // will time out on `waitReply` and surface that as a `RingTimeoutError`.
    } finally {
      this.inFlight.delete(ring);
    }
  }
}

function isThenable<T>(v: unknown): v is PromiseLike<T> {
  if (v === null || (typeof v !== 'object' && typeof v !== 'function')) return false;
  return typeof (v as { then?: unknown }).then === 'function';
}

function errorToShape(err: unknown): { name: string; message: string; code?: string } {
  if (err instanceof Error) {
    const withCode = err as Error & { code?: unknown };
    const code = typeof withCode.code === 'string' ? withCode.code : undefined;
    return code === undefined
      ? { name: err.name, message: err.message }
      : { name: err.name, message: err.message, code };
  }
  return { name: 'Error', message: String(err) };
}
