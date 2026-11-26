/**
 * The one completion path of the async `fs` APIs (callback and `fs.promises`; not
 * `read(0)`, stdin's own path): a Node fs request is a threadpool round trip that
 * completes in a later loop turn. `operation` runs in one host turn (an immediate),
 * its outcome settles in an I/O completion turn — so a chain of fs calls yields to
 * timers, the immediates queued beside a call run before its completion, and those a
 * completion queues run before a timer. The sync exchange behind `operation` is over
 * before the settling turn is queued: two requests never overlap on a sync-RPC ring.
 * The caller captures everything but the data bytes at the call (options, path,
 * position); `operation` reads the bytes when it runs.
 */
import { inFlightIo } from './fs-io-submitted.ts';
import { type PathLike, pathToString } from './fs-path.ts';
import { clearImmediate, queueIoCompletion, setImmediate } from './timers.ts';

const PromisePrimordial = Promise;

export function ioTurn<T>(operation: () => T): Promise<T> {
  return new PromisePrimordial<T>((resolve, reject) => {
    const inFlight = inFlightIo();
    let submitted = true;
    let cancelCompletion: (() => void) | null = null;
    // The process ends first: a submitted operation still runs, nothing settles, no turn is left.
    const end = (): void => {
      inFlight.delete(end);
      clearImmediate(turn);
      cancelCompletion?.();
      if (!submitted) return;
      submitted = false;
      try {
        operation();
      } catch {
        // Its callback would have had it; there is none now.
      }
    };
    inFlight.add(end);
    const turn = setImmediate(() => {
      submitted = false;
      let settle: () => void;
      try {
        const value = operation();
        settle = () => resolve(value);
      } catch (error) {
        settle = () => reject(error);
      }
      cancelCompletion = queueIoCompletion(() => {
        inFlight.delete(end);
        settle();
      });
    });
  });
}

const objectGetPrototypeOf = Object.getPrototypeOf;

/** An options object as Node's callback forms read it: once, at the call (a shallow copy). */
export function optionsAtCall(value: unknown): unknown {
  if (typeof value !== 'object' || value === null) return value;
  const proto = objectGetPrototypeOf(value);
  return proto === Object.prototype || proto === null ? { ...value } : value;
}

/**
 * `sync` as an async fs API: its first `paths` arguments (a `Buffer`/`URL` path as its
 * string) are fixed at the call, as Node validates them there; options and data are read
 * when the operation runs (Node's promise forms read options as they go; the callback
 * forms copy theirs first, `fs-callback.ts`).
 */
export function inTurn<A extends unknown[], R>(sync: (...args: A) => R, paths = 1) {
  return (...args: A): Promise<R> => {
    let captured: A;
    try {
      captured = args.map((value, index) =>
        index < paths && typeof value === 'object' && value !== null
          ? pathToString(value as PathLike)
          : value,
      ) as A;
    } catch (error) {
      return PromisePrimordial.reject(error);
    }
    return ioTurn(() => sync(...captured));
  };
}
