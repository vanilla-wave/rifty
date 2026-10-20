/**
 * Pre-check every native structured-clone entry of a realm with
 * `assertCloneable` (clone-marks.ts): `structuredClone`, realm `postMessage`,
 * `MessagePort#`/`Worker#`/`BroadcastChannel#postMessage`. Wrapped once per
 * realm; names, lengths and descriptors stay native (ADR-0447 transfer wrappers
 * in message-port-ref.ts are untouched and run after this check).
 */

import { assertCloneable } from './clone-marks.ts';
import { ownerOf, wrapMethod } from './message-port-ref.ts';

const INSTALLED = Symbol.for('rifty.runtime-js.clone-admission.v1');

export function installCloneAdmission(): void {
  const realm = globalThis as typeof globalThis & { [INSTALLED]?: true };
  if (realm[INSTALLED] === true) return;
  Object.defineProperty(realm, INSTALLED, { value: true });
  const admit = (
    native: (this: unknown, ...args: unknown[]) => unknown,
    receiver: unknown,
    args: unknown[],
  ): unknown => {
    assertCloneable(args[0]);
    return Reflect.apply(native, receiver, args);
  };
  for (const Ctor of [realm.MessagePort, realm.Worker, realm.BroadcastChannel]) {
    if (typeof Ctor === 'function') wrapMethod(Ctor.prototype, 'postMessage', admit);
  }
  for (const key of ['postMessage', 'structuredClone'] as const) {
    const owner = ownerOf(realm, key);
    if (owner !== null) wrapMethod(owner, key, admit);
  }
}
