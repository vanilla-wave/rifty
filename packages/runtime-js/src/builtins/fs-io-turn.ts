/**
 * The one completion path of the async `fs` APIs (callback and `fs.promises`; not
 * `read(0)`, stdin's own path), as Node's threadpool round trip. Every call takes two
 * turns: `operation` runs in a host turn (an immediate), its outcome settles in the next
 * I/O completion turn (a Node host's `MessagePort`, its poll phase; elsewhere the immediate
 * queue). So a chain of fs calls yields to timers, the immediates queued beside a call run
 * before its completion, and those a completion queues run before a due timer. Where Node
 * races (a call from a timer, an immediate or the main module: the pool done or not by the
 * next poll) this is Node's later order; one turn where rifty "knows" the turn is not poll
 * was tried and dropped (`backlog/runtime-js/loop-phase-of-current-turn`). The sync exchange
 * behind `operation` is over before the settling turn is queued: two requests never overlap
 * on a sync-RPC ring. The caller parses its arguments at the call as Node's JS layer does
 * (`fs-arguments.ts`); `operation` reads a view's data bytes when it runs (`view-bytes.ts`).
 * A process end (`exit()`, a fatal error) runs the submitted operations, no callback
 * (`fs-io-submitted.ts`; Node joins its pool); `worker.terminate()` and a sandbox stop do not.
 * Cost (PR #468): one extra host turn per call, accepted.
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

/**
 * `sync` as an async fs API whose arguments are a path and primitives (`open`, `close`,
 * `ftruncate`): its first `paths` arguments (a `Buffer`/`URL` path as its string) are fixed at
 * the call, as Node validates them there.
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
