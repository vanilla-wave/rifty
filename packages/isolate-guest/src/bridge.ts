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

/** A refusal the guest sees: no host stack crosses the boundary. */
function refuse(message: string): never {
  const error = new TypeError(`isolate-host bridge: ${message}`);
  error.stack = `TypeError: ${error.message}`;
  throw error;
}

const isInt = (v: unknown, min: number, max: number): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;

/** Run `fn`; any unexpected host failure becomes a refusal, never a host stack. */
function guard<A extends unknown[], R>(name: string, fn: (...args: A) => R): (...args: A) => R {
  return (...args) => {
    try {
      return fn(...args);
    } catch (error) {
      if (error instanceof TypeError && error.message.startsWith('isolate-host bridge: '))
        throw error;
      return refuse(`${name} failed`);
    }
  };
}

/** What the embedder does with validated calls. */
export interface HostHooks {
  write(fd: 1 | 2, bytes: Uint8Array): void;
  /** Deliver expiry to the guest (`GuestEntry.fire`); a throw ends that timer. */
  fire(id: number): void;
}

export interface HostBridge {
  /** Install these, and only these, for the guest (plus `timeOrigin`). */
  readonly functions: HostFunctions;
  /** End of the call: clear every host timer; later `timerStart` arms nothing. */
  close(): void;
}

export function createHostBridge(hooks: HostHooks): HostBridge {
  const timers = new Map<number, NodeJS.Timeout>();
  let closed = false;
  const clear = (id: number): void => {
    const timer = timers.get(id);
    if (timer !== undefined) clearTimeout(timer);
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
      const tick = (): void => {
        if (!repeat) timers.delete(id);
        try {
          hooks.fire(id);
        } catch {
          // The guest is gone (e.g. a disposed isolate): nothing to deliver to.
          clear(id);
        }
      };
      timers.set(id, repeat ? setInterval(tick, ms) : setTimeout(tick, ms));
    }),
    timerClear: guard('timerClear', (id: unknown) => {
      if (!isInt(id, 1, MAX_TIMER)) refuse('timerClear: id must be an integer in 1..2^31-1');
      clear(id);
    }),
    now: guard('now', () => performance.now()),
    random: guard('random', (n: unknown) => {
      if (!isInt(n, 0, 65536)) refuse('random: length must be an integer in 0..65536');
      return new Uint8Array(randomBytes(n));
    }),
  };
  return {
    functions,
    close() {
      closed = true;
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    },
  };
}

/** The run's exit status from what `GuestEntry.run` resolved with: an integer 0..255, else 1. */
export function exitStatus(value: unknown): number {
  return isInt(value, 0, 255) ? value : 1;
}
