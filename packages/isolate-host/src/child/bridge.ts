/**
 * The host functions the isolate can call (ADR-0557 §6). The guest is hostile:
 * every argument is validated, every failure is a guest-safe `TypeError`
 * (name + message, no host frame or path), and nothing a call does can throw
 * into the child's own event loop.
 */
import { randomBytes } from 'node:crypto';

const MAX_TIMER = 2 ** 31 - 1;

/** A refusal the guest sees: no child stack crosses the boundary. */
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

/** stdout/stderr bytes kept up to the cap, copied into one growable buffer per fd (memory ~ cap). */
export class OutputBudget {
  #kept = 0;
  #truncated = false;
  readonly #pending = {
    1: { buf: new Uint8Array(0), len: 0 },
    2: { buf: new Uint8Array(0), len: 0 },
  };
  constructor(readonly cap: number) {}

  get truncated(): boolean {
    return this.#truncated;
  }

  /** Accept a guest write; true when new bytes or the truncation flip await a flush. */
  write(fd: 1 | 2, bytes: Uint8Array): boolean {
    const room = this.cap - this.#kept;
    const flipped = bytes.byteLength > room && !this.#truncated;
    if (flipped) this.#truncated = true;
    const take = Math.min(room, bytes.byteLength);
    if (take <= 0) return flipped;
    const slot = this.#pending[fd];
    if (slot.len + take > slot.buf.byteLength) {
      const size = Math.max(slot.len + take, Math.min(this.cap, slot.buf.byteLength * 2 || 4096));
      const grown = new Uint8Array(size);
      grown.set(slot.buf.subarray(0, slot.len));
      slot.buf = grown;
    }
    slot.buf.set(bytes.subarray(0, take), slot.len);
    slot.len += take;
    this.#kept += take;
    return true;
  }

  /** At most one chunk per fd. */
  drain(): [1 | 2, Uint8Array][] {
    const out: [1 | 2, Uint8Array][] = [];
    for (const fd of [1, 2] as const) {
      const slot = this.#pending[fd];
      if (slot.len > 0) out.push([fd, slot.buf.slice(0, slot.len)]);
      slot.len = 0;
    }
    return out;
  }
}

export interface BridgeHooks {
  readonly output: OutputBudget;
  outputPending(): void;
  fire(id: number): void;
}

export function createBridge(hooks: BridgeHooks) {
  const timers = new Map<number, NodeJS.Timeout>();
  const clear = (id: number): void => {
    const timer = timers.get(id);
    if (timer !== undefined) clearTimeout(timer);
    timers.delete(id);
  };
  return {
    write: guard('write', (fd: unknown, bytes: unknown) => {
      if (fd !== 1 && fd !== 2) refuse('write: fd must be 1 or 2');
      if (!(bytes instanceof Uint8Array)) refuse('write: bytes must be a Uint8Array');
      if (hooks.output.write(fd, bytes)) hooks.outputPending();
    }),
    timerStart: guard('timerStart', (id: unknown, ms: unknown, repeat: unknown) => {
      if (!isInt(id, 1, MAX_TIMER)) refuse('timerStart: id must be an integer in 1..2^31-1');
      if (typeof ms !== 'number' || !(ms >= 0 && ms <= MAX_TIMER))
        refuse('timerStart: ms out of range');
      if (typeof repeat !== 'boolean') refuse('timerStart: repeat must be a boolean');
      clear(id);
      const tick = (): void => {
        if (!repeat) timers.delete(id);
        hooks.fire(id);
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
}
