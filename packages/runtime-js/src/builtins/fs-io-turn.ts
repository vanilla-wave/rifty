/**
 * The one completion path of every async `fs` API (callback and `fs.promises`): a
 * Node fs request is a threadpool round trip that completes in a later loop turn.
 * `operation` runs in one host turn, its outcome settles in the next — so a chain of
 * fs calls yields to timers, and the immediates queued beside a call (before or after
 * it) run before its completion, as Node's check phase precedes the next poll. The
 * sync exchange behind `operation` is over before the settling turn is queued: two
 * requests never overlap on a sync-RPC ring.
 */
import { inFlightIo } from './fs-io-submitted.ts';
import { clearImmediate, setImmediate } from './timers.ts';

const PromisePrimordial = Promise;

export function ioTurn<T>(operation: () => T): Promise<T> {
  return new PromisePrimordial<T>((resolve, reject) => {
    const inFlight = inFlightIo();
    let submitted = true;
    // The process ends first: a submitted operation still runs, nothing settles, no turn is left.
    const end = (): void => {
      inFlight.delete(end);
      clearImmediate(turn);
      if (!submitted) return;
      submitted = false;
      try {
        operation();
      } catch {
        // Its callback would have had it; there is none now.
      }
    };
    inFlight.add(end);
    let turn = setImmediate(() => {
      submitted = false;
      let settle: () => void;
      try {
        const value = operation();
        settle = () => resolve(value);
      } catch (error) {
        settle = () => reject(error);
      }
      turn = setImmediate(() => {
        inFlight.delete(end);
        settle();
      });
    });
  });
}
