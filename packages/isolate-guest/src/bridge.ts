/**
 * Host side of the bridge (ADR-0558): the guest is hostile, so every argument
 * is validated, every failure is a guest-safe `TypeError` (name + message, no
 * host frame or path), and nothing a call or a timer does throws into the
 * embedder's own event loop. Embedder-neutral: the embedder wraps
 * `functions` in its own callback type.
 */
import { randomBytes } from 'node:crypto';
import type { HostFunctions } from './contract.ts';

const MAX_TIMER = 2 ** 31 - 1;

/** Errors `refuse` created: the only ones `guard` lets through. */
const refusals = new WeakSet<object>();

/** A refusal the guest sees: no host stack crosses the boundary. */
function refuse(message: string): never {
  const error = new TypeError(`isolate-host bridge: ${message}`);
  error.stack = `TypeError: ${error.message}`;
  refusals.add(error);
  throw error;
}

const isInt = (v: unknown, min: number, max: number): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;

/** Run `fn`; anything but the bridge's own refusal becomes `<name> failed`, never a host error. */
function guard<A extends unknown[], R>(name: string, fn: (...args: A) => R): (...args: A) => R {
  return (...args) => {
    try {
      return fn(...args);
    } catch (error) {
      // By identity: a hook's own `TypeError('isolate-host bridge: …')` carries host text and stack.
      if (refusals.has(error as object)) throw error;
      return refuse(`${name} failed`);
    }
  };
}

/** What the embedder does with validated calls. */
export interface HostHooks {
  write(fd: 1 | 2, bytes: Uint8Array): void;
  /**
   * Deliver expiry to the guest (`GuestEntry.fire`). Return a promise that settles
   * once the guest ran it: a repeating timer re-arms only then, as Node's
   * interval does (no tick queues behind a running callback). A throw or a
   * rejection ends that timer.
   */
  fire(id: number): unknown;
}

export interface HostBridge {
  /** Install these, and only these, for the guest (plus `timeOrigin`). */
  readonly functions: HostFunctions;
  /** The guest's `performance.timeOrigin`: this bridge's creation, epoch ms. */
  readonly timeOrigin: number;
  /** End of the call: clear every host timer; later `timerStart` arms nothing. */
  close(): void;
}

export function createHostBridge(hooks: HostHooks): HostBridge {
  // The guest's clock starts with its call, as a fresh `node -e` process's does:
  // never the embedder's uptime, and nothing that links one call to another.
  const origin = performance.now();
  const wallOrigin = Date.now();
  // Per id: the armed host timer, or `null` while its expiry is with the guest.
  const timers = new Map<number, NodeJS.Timeout | null>();
  let closed = false;
  const clear = (id: number): void => {
    const timer = timers.get(id);
    if (timer) clearTimeout(timer);
    timers.delete(id);
  };
  const functions: HostFunctions = {
    write: guard('write', (fd: unknown, bytes: unknown) => {
      if (fd !== 1 && fd !== 2) refuse('write: fd must be 1 or 2');
      if (!(bytes instanceof Uint8Array)) refuse('write: bytes must be a Uint8Array');
      hooks.write(fd, bytes);
    }),
    timerStart: guard('timerStart', (id: unknown, ms: unknown, repeat: unknown) => {
      if (!isInt(id, 1, MAX_TIMER)) refuse('timerStart: id must be an integer in 1..2^31-1');
      if (typeof ms !== 'number' || !(ms >= 0 && ms <= MAX_TIMER))
        refuse('timerStart: ms out of range');
      if (typeof repeat !== 'boolean') refuse('timerStart: repeat must be a boolean');
      if (closed) return;
      clear(id);
      const arm = (): void => {
        timers.set(id, setTimeout(tick, ms));
      };
      const tick = (): void => {
        if (!repeat) {
          timers.delete(id);
        } else timers.set(id, null);
        // Re-arm from the callback's end, and only if nothing cleared or re-armed `id` meanwhile.
        const rearm = (): void => {
          if (repeat && !closed && timers.get(id) === null) arm();
        };
        // A rejection (the isolate is gone) ends the timer and never reaches the embedder's loop.
        const end = (): void => {
          if (timers.get(id) === null) timers.delete(id);
        };
        try {
          const delivered = hooks.fire(id);
          const then = (delivered as PromiseLike<unknown> | null | undefined)?.then;
          if (typeof then === 'function') then.call(delivered, rearm, end);
          else rearm();
        } catch {
          // The embedder cannot deliver: this timer has nothing left to do.
          clear(id);
        }
      };
      arm();
    }),
    timerClear: guard('timerClear', (id: unknown) => {
      if (!isInt(id, 1, MAX_TIMER)) refuse('timerClear: id must be an integer in 1..2^31-1');
      clear(id);
    }),
    now: guard('now', () => performance.now() - origin),
    random: guard('random', (n: unknown) => {
      if (!isInt(n, 0, 65536)) refuse('random: length must be an integer in 0..65536');
      return new Uint8Array(randomBytes(n));
    }),
  };
  return {
    functions,
    // The wall clock at creation, as a fresh process's `timeOrigin` is: a long-lived
    // embedder's monotonic clock drifts from the wall clock over its uptime.
    timeOrigin: wallOrigin,
    close() {
      closed = true;
      for (const timer of timers.values()) if (timer) clearTimeout(timer);
      timers.clear();
    },
  };
}

/** The run's exit status from what `GuestEntry.run` resolved with: an integer 0..255, else 1. */
export function exitStatus(value: unknown): number {
  return isInt(value, 0, 255) ? value : 1;
}
