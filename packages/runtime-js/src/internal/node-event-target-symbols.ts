/**
 * Node's `kResistStopPropagation` where the realm's `EventTarget` is Node's own `event_target.js`
 * (the isolate guest, ADR-0579), bound by that host before guest code. Browser hosts' `EventTarget`
 * is the host's, which has no such option: unbound, a listener there is a plain one
 * (backlog runtime-js/stream-core-abort-listeners-host-event-target).
 */
let kResistStopPropagation: symbol | undefined;

export function bindNodeEventTargetSymbols(symbols: { readonly kResistStopPropagation: symbol }): void {
  kResistStopPropagation = symbols.kResistStopPropagation;
}

/** `{ __proto__: null, once: true, [kResistStopPropagation]: true }` as Node's internal listeners pass it. */
export function resistingOnceOptions(): AddEventListenerOptions {
  const options = { __proto__: null, once: true } as unknown as Record<PropertyKey, unknown>;
  if (kResistStopPropagation !== undefined) options[kResistStopPropagation] = true;
  return options as AddEventListenerOptions;
}
