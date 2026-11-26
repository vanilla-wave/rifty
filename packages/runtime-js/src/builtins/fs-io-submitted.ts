/**
 * fs requests in flight (`fs-io-turn.ts`), each as its process-end step. A leaf with a
 * realm slot: the process end (`process-lifecycle-events.ts`, maybe another bundle's
 * copy) reaches them.
 */
const IN_FLIGHT = Symbol.for('rifty.runtime-js.fs-io-turn.in-flight.v1');

export function inFlightIo(): Set<() => void> {
  const realm = globalThis as typeof globalThis & { [IN_FLIGHT]?: Set<() => void> };
  if (realm[IN_FLIGHT] === undefined) {
    Object.defineProperty(realm, IN_FLIGHT, { value: new Set(), configurable: false });
  }
  return realm[IN_FLIGHT] as Set<() => void>;
}

/**
 * The process ends (`exit()`, a fatal error): Node joins its threadpool, so every
 * submitted request completes and no callback runs. Only what is in flight now: an
 * operation cannot submit another, nothing loops.
 */
export function completeSubmittedIo(): void {
  for (const end of [...inFlightIo()]) end();
}
