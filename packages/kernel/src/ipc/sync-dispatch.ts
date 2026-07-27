/**
 * Parent-side sync RPC dispatcher (ADR-0011 phase 3, ADR-0084 #17).
 *
 * The dispatcher runs in the realm that owns the kernel — typically the
 * playground main thread (or the orchestrator Worker when nested kernels
 * land). It watches a {@link SabRing}'s request slot, dispatches incoming
 * frames to registered handlers, and writes the (possibly async) reply
 * back into the ring.
 *
 * Event-driven via `Atomics.waitAsync` (ADR-0084 #17, overturning ADR-0011's
 * busy-poll): `waitAsync` is legal on the owning realm (unlike `Atomics.wait`,
 * which would throw / block) — it never blocks, returning a Promise that
 * settles on `Atomics.notify`. Each attached ring arms a waitAsync on its
 * REQ_STATE slot; the caller's {@link SabRing.writeRequest} notify wakes it
 * sub-ms with no tick. A single global backstop timer (50-100 ms) re-pumps
 * every ring to recover any missed notify / recursive-attach window. When
 * `Atomics.waitAsync` is absent (older runtime), the dispatcher falls back to
 * the legacy `setInterval(pollIntervalMs)` busy-poll verbatim.
 *
 * A single shared dispatcher serves every kernel-spawned Worker (see
 * `spawn-worker.ts` lazy singleton); the one global backstop timer iterates
 * all attached rings, so timer count is O(1) regardless of live children.
 * Recursive-safe: the `'execSync'` handler may itself spawn a worker whose
 * ring attaches to the same dispatcher — the in-flight per-ring guard
 * prevents re-dispatching the already-in-progress request, and re-arm waits
 * until the reply is written.
 */

import type { SabRing } from './sab-ring.ts';
import {
  SyncRpcProtocolMismatchError,
  type SyncRpcReply,
  type SyncRpcRequest,
  decodeRequest,
  encodeBinaryReply,
  encodeReply,
} from './sync-rpc.ts';

// Capture host timers at module load — BEFORE a worker realm's installTimerGlobals
// can replace the globals with runtime-js's keepalive-counted wrappers. The
// backstop is pure infra (ADR-0152 §5: rifty's own infra timers must never enter
// the keepalive count), so it MUST arm on the host timer directly — else a nested
// child (depth-2) whose parent realm wrapped setInterval would have its event-loop
// drain pinned by the backstop. Mirrors timers.ts / event-loop-keepalive.ts.
const hostSetInterval = globalThis.setInterval.bind(globalThis);
const hostClearInterval = globalThis.clearInterval.bind(globalThis);

/**
 * Handler signature for a registered RPC method. Returning a thenable
 * defers the reply until the promise settles; rejections become
 * `{ok:false, error}` replies.
 */
export interface SyncRpcCallerContext {
  readonly callerPid?: number;
}

export type SyncRpcHandler<T = unknown> = (
  payload: unknown,
  context?: SyncRpcCallerContext,
) => T | Promise<T>;

/** Options accepted by {@link SyncRpcDispatcher}. */
export interface SyncRpcDispatcherOptions {
  /**
   * Backstop interval in milliseconds (ADR-0084 #17 — meaning changed). In
   * event-driven mode (`Atomics.waitAsync` present, the default) the primary
   * wake is the caller's `Atomics.notify`, so this is ONLY the missed-notify /
   * recursive-attach recovery window — clamped to {@link BACKSTOP_MIN_MS}..
   * {@link BACKSTOP_MAX_MS}. When `waitAsync` is absent the dispatcher falls
   * back to the legacy busy-poll and this is the literal poll interval.
   * Defaults to {@link DEFAULT_BACKSTOP_MS}.
   */
  readonly pollIntervalMs?: number;
}

/** ADR-0084 #17: backstop window bounds in event-driven mode. */
const BACKSTOP_MIN_MS = 50;
const BACKSTOP_MAX_MS = 100;
const DEFAULT_BACKSTOP_MS = 50;

/**
 * `Atomics.waitAsync` ships in ES2024; lib target is ES2023. Narrow structural
 * probe so older runtimes (or stubbed-out tests) fall back to busy-poll.
 */
function hasWaitAsync(): boolean {
  return typeof (Atomics as unknown as { waitAsync?: unknown }).waitAsync === 'function';
}

/**
 * Single-realm dispatcher that owns the parent side of one or more
 * {@link SabRing}s. Register handlers with {@link register}, then
 * {@link attach} a ring to start watching it.
 *
 * The same dispatcher instance can serve many rings — useful when the
 * kernel spawns several children that share the parent's handler table.
 *
 * Event-driven (ADR-0084 #17): each ring arms an `Atomics.waitAsync` on its
 * REQ_STATE slot; a single global backstop timer re-pumps every ring to cover
 * missed-notify / recursive-attach windows, so timer count stays O(1). When
 * `Atomics.waitAsync` is unavailable the dispatcher falls back to the legacy
 * `setInterval(pollIntervalMs)` busy-poll (the timer then iterates every ring).
 */
export class SyncRpcDispatcher {
  private readonly handlers = new Map<string, SyncRpcHandler>();
  private readonly pollIntervalMs: number;
  private readonly attachments = new Set<SabRing>();
  private readonly callerContexts = new WeakMap<SabRing, SyncRpcCallerContext>();
  private timer: ReturnType<typeof setInterval> | null = null;
  /** ADR-0084 #17: event-driven when `Atomics.waitAsync` exists; else busy-poll. */
  private readonly eventDriven: boolean;
  /** Backstop window (ms) in event-driven mode; legacy poll interval otherwise. */
  private readonly backstopMs: number;
  /**
   * Per-ring arming generation (ADR-0084 #17). `waitAsync` has no cancel token;
   * detach bumps the ring's generation so a promise that settles after detach
   * (or after the ring was re-attached) is a no-op instead of pumping a
   * detached/stale ring.
   */
  private readonly armGeneration = new WeakMap<SabRing, number>();
  /**
   * Rings with a live (parked or sync-pending) waitAsync arm (ADR-0084 #17).
   * Prevents a double-arm: a sync handler's reply-writer calls {@link rearm}
   * from inside `pumpOnce`, then `onArmSettled`'s tail would arm again — the
   * guard makes the second a no-op, so each ring holds at most one arm.
   */
  private readonly pendingArm = new WeakSet<SabRing>();
  /**
   * Per-ring guard: when a handler is awaiting an async result we must not
   * read another request from the same ring (and we can't anyway — the
   * client won't send one until it sees the reply). The flag covers the
   * window between handler dispatch and reply write.
   */
  private readonly inFlight = new WeakSet<SabRing>();

  constructor(opts: SyncRpcDispatcherOptions = {}) {
    this.eventDriven = hasWaitAsync();
    const requested = opts.pollIntervalMs ?? DEFAULT_BACKSTOP_MS;
    // Event-driven: clamp to the backstop window (a 1 ms backstop would defeat
    // the point). Busy-poll fallback: honour the requested interval verbatim.
    this.backstopMs = this.eventDriven
      ? Math.min(BACKSTOP_MAX_MS, Math.max(BACKSTOP_MIN_MS, requested))
      : requested;
    this.pollIntervalMs = this.backstopMs;
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

  /** Test-only / introspection helper: how many rings are attached. */
  getAttachmentCount(): number {
    return this.attachments.size;
  }

  /**
   * Test-only / introspection helper: how many backstop timers are alive.
   * Always 0 or 1 — a single global timer backs every attached ring
   * (the literal `setInterval`, unchanged by ADR-0084 #17).
   */
  getActiveTimerCount(): number {
    return this.timer === null ? 0 : 1;
  }

  /**
   * Start watching `ring`'s request slot. Safe to call multiple times for
   * the same ring (idempotent — only the first call installs the timer and
   * arms the waitAsync). Pair every {@link attach} with a {@link detach} on
   * worker exit so neither the timer nor a parked promise keeps the realm
   * alive past the ring.
   */
  attach(ring: SabRing, context: SyncRpcCallerContext = {}): SyncRpcCallerContext {
    const current = this.callerContexts.get(ring);
    if (current !== undefined) return current;
    const trustedContext = Object.freeze({ ...context });
    this.attachments.add(ring);
    this.callerContexts.set(ring, trustedContext);
    this.ensureTimer();
    if (this.eventDriven) this.arm(ring);
    return trustedContext;
  }

  /** Stop watching `ring`. Safe to call when not attached (no-op). */
  detach(ring: SabRing): void {
    if (!this.attachments.delete(ring)) return;
    this.callerContexts.delete(ring);
    this.inFlight.delete(ring);
    // Bump the generation so the still-parked waitAsync promise no-ops on settle,
    // and drop the arm guard so a later re-attach can arm fresh.
    this.armGeneration.set(ring, (this.armGeneration.get(ring) ?? 0) + 1);
    this.pendingArm.delete(ring);
    if (this.attachments.size === 0) this.stopTimer();
  }

  /** Detach every ring. Useful for shutdown / test cleanup. */
  detachAll(): void {
    for (const ring of [...this.attachments]) {
      this.inFlight.delete(ring);
      this.callerContexts.delete(ring);
      this.armGeneration.set(ring, (this.armGeneration.get(ring) ?? 0) + 1);
      this.pendingArm.delete(ring);
    }
    this.attachments.clear();
    this.stopTimer();
  }

  private ensureTimer(): void {
    if (this.timer !== null) return;
    const timer = hostSetInterval(() => {
      // Backstop: re-pump every ring to recover any missed notify / recursive-
      // attach window (and the sole liveness mechanism in busy-poll fallback).
      // Snapshot so a handler that detaches its own ring doesn't trip the iterator.
      for (const ring of [...this.attachments]) this.pumpOnce(ring);
    }, this.pollIntervalMs);
    // Don't keep Node alive purely for the dispatcher; the kernel's exit path
    // is the source of truth. `unref` is Node-only, hence the feature-detect.
    const maybeUnref = (timer as unknown as { unref?: () => void }).unref;
    if (typeof maybeUnref === 'function') maybeUnref.call(timer);
    this.timer = timer;
  }

  /**
   * Arm an `Atomics.waitAsync` on `ring`'s REQ_STATE (ADR-0084 #17). The
   * caller's `writeRequest` notify resolves it sub-ms; on resolve we pump and
   * re-arm. The synchronous `'not-equal'` branch covers a request that landed
   * before arming (no lost wake). Re-arm after an async handler is deferred to
   * {@link rearm} (called once the reply is written) so we never spin on an
   * in-flight ring.
   */
  private arm(ring: SabRing): void {
    if (!this.attachments.has(ring)) return;
    if (this.pendingArm.has(ring)) return; // already armed — never double-arm
    this.pendingArm.add(ring);
    const generation = this.armGeneration.get(ring) ?? 0;
    const result = ring.armRequest(this.backstopMs);
    if (result.async === false) {
      // 'not-equal' → a request is already pending (or the slot is mid-write);
      // 'ok'/'timed-out' can't occur synchronously. Pump + re-arm immediately.
      this.onArmSettled(ring, generation);
      return;
    }
    result.value.then(() => this.onArmSettled(ring, generation));
  }

  /**
   * Common post-arm handler: drop if the ring was detached / re-attached
   * since arming (cancel-on-detach), else pump and re-arm. When the pump
   * leaves an async handler in flight, {@link rearm} re-arms after the reply
   * lands; otherwise re-arm here so the next request is observed.
   */
  private onArmSettled(ring: SabRing, generation: number): void {
    // A stale settle (detach/re-attach bumped the generation) must NOT clear the
    // guard of the new arm — drop it untouched. Cancel-on-detach: also drop.
    if ((this.armGeneration.get(ring) ?? 0) !== generation) return;
    if (!this.attachments.has(ring)) return;
    // This arm has settled; clear the guard so the next arm (here or via the
    // sync handler's reply-writer rearm) is allowed exactly once.
    this.pendingArm.delete(ring);
    this.pumpOnce(ring);
    if (!this.inFlight.has(ring)) this.arm(ring);
  }

  /**
   * Re-arm a ring after its reply is written (ADR-0084 #17). Called from the
   * reply-writers once {@link inFlight} clears, so an async (`execSync`)
   * handler that returns to the event loop while still working does not cause
   * a premature re-arm / spin.
   */
  private rearm(ring: SabRing): void {
    if (!this.eventDriven) return;
    this.arm(ring);
  }

  private stopTimer(): void {
    if (this.timer === null) return;
    hostClearInterval(this.timer);
    this.timer = null;
  }

  /**
   * One poll cycle: read a request if present, dispatch, write the reply.
   * Public for tests that want to drive the dispatcher deterministically
   * instead of waiting on the timer.
   */
  pumpOnce(ring: SabRing): void {
    if (this.inFlight.has(ring)) return;
    let bytes: Uint8Array | null;
    try {
      bytes = ring.readRequest();
    } catch (err) {
      // ADR-0032: a version-mismatched request must NOT be decoded. Echo
      // the caller's version back in the reply so the caller can still
      // parse the error frame. State is already cleared inside readRequest.
      if (err instanceof SyncRpcProtocolMismatchError) {
        this.inFlight.add(ring);
        this.writeVersionedError(ring, err.got, err);
        return;
      }
      throw err;
    }
    if (bytes === null) return;
    this.inFlight.add(ring);
    let req: SyncRpcRequest;
    try {
      req = decodeRequest(bytes);
    } catch (err) {
      this.writeError(ring, err, '<decodeRequest>');
      return;
    }
    const handler = this.handlers.get(req.method);
    if (!handler) {
      this.writeError(
        ring,
        Object.assign(new Error(`SyncRpcDispatcher: no handler for '${req.method}'`), {
          code: 'ERPCNOHANDLER',
        }),
        req.method,
      );
      return;
    }
    let result: unknown;
    try {
      result = handler(req.payload, this.callerContexts.get(ring) ?? {});
    } catch (err) {
      this.writeError(ring, err, req.method);
      return;
    }
    if (isThenable(result)) {
      result.then(
        (value) => this.writeValue(ring, value, req.method),
        (err: unknown) => this.writeError(ring, err, req.method),
      );
      return;
    }
    this.writeValue(ring, result, req.method);
  }

  private writeValue(ring: SabRing, value: unknown, method: string): void {
    try {
      // ADR-0084 #23: a Uint8Array value (execSync stdout) rides a binary
      // frame — byte-exact, no JSON/TextDecoder round-trip. Everything else
      // is a JSON frame.
      const frame =
        value instanceof Uint8Array
          ? encodeBinaryReply(value)
          : encodeReply({ ok: true, value } satisfies SyncRpcReply);
      ring.writeReply(frame);
      this.inFlight.delete(ring);
      this.rearm(ring);
    } catch (err) {
      // writeReply rejects when a previous reply is unread or the payload
      // exceeds capacity — both programmer errors here; surface as an error
      // reply that fits, since the happy-path reply already failed to land.
      this.writeError(ring, err, method);
    }
  }

  private writeError(ring: SabRing, err: unknown, method: string): void {
    const reply: SyncRpcReply = { ok: false, error: errorToShape(err) };
    try {
      ring.writeReply(encodeReply(reply));
    } catch (dropErr) {
      // Even the error reply can't land (e.g. the reply slot is already
      // occupied — a ring protocol violation). The caller will block/time out
      // on `waitReply`; a silent drop here erased the ONLY evidence of the
      // primal violation in the CI wedge flakes, so name it loudly. Not a
      // throw: this runs from a timer/microtask in the responder realm and
      // must not kill the realm serving every other ring.
      console.error(
        `SyncRpcDispatcher: reply for '${method}' DROPPED — ${String(dropErr)} (handler outcome: ${String(err)})`,
      );
    } finally {
      this.inFlight.delete(ring);
      this.rearm(ring);
    }
  }

  /** ADR-0032: write an error reply with an explicit version stamp so a
   * mismatched caller can still decode the failure frame. */
  private writeVersionedError(ring: SabRing, callerVersion: number, err: unknown): void {
    const reply: SyncRpcReply = { ok: false, error: errorToShape(err) };
    try {
      ring.writeReplyWithVersion(encodeReply(reply), callerVersion);
    } catch (dropErr) {
      // Sibling of writeError's drop path — same loud-not-silent contract.
      console.error(
        `SyncRpcDispatcher: versioned error reply DROPPED — ${String(dropErr)} (original: ${String(err)})`,
      );
    } finally {
      this.inFlight.delete(ring);
      this.rearm(ring);
    }
  }
}

function isThenable<T>(v: unknown): v is PromiseLike<T> {
  if (v === null || (typeof v !== 'object' && typeof v !== 'function')) return false;
  return typeof (v as { then?: unknown }).then === 'function';
}

function errorToShape(err: unknown): NonNullable<SyncRpcReply['error']> {
  if (err instanceof Error) {
    const e = err as Error & { code?: unknown; errno?: unknown; syscall?: unknown; path?: unknown };
    const code = typeof e.code === 'string' ? e.code : undefined;
    const errno = typeof e.errno === 'number' ? e.errno : undefined;
    const syscall = typeof e.syscall === 'string' ? e.syscall : undefined;
    const path = typeof e.path === 'string' ? e.path : undefined;
    return {
      name: err.name,
      message: err.message,
      ...(code !== undefined && { code }),
      ...(errno !== undefined && { errno }),
      ...(syscall !== undefined && { syscall }),
      ...(path !== undefined && { path }),
    };
  }
  return { name: 'Error', message: String(err) };
}
